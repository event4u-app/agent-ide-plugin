import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LlmRequest, LlmStreamEvent, LlmUsage } from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';

/**
 * T-406 — Claude Code CLI backend.
 *
 * Spawns
 * `claude -p --verbose --output-format=stream-json --input-format=stream-json`
 * as a subprocess. No PTY. Naive `spawn` pipe per the council-tight Sprint-4
 * scope. Interactive prompts hang or fail — the wrapper detects "no output
 * for 10s after stdin closed" and aborts with a clear error.
 *
 * Verified against `claude` 2.1.x (2026-06-01): print mode rejects
 * `--output-format=stream-json` unless `--verbose` is also passed, the stdin
 * line must be `{type:'user',message:{role:'user',content:<text>}}`, and the
 * assistant text arrives nested under `message.content[]` text blocks — never
 * a top-level `text` field. Earlier revisions guessed all three wrong, so a
 * CLI turn streamed nothing and finished empty.
 */

const NO_OUTPUT_TIMEOUT_MS = 10_000;

export interface ClaudeCliBackendOptions {
  /** Resolved binary path from T-405's detection probe. */
  binary?: string;
  /** Inject a spawn fn for tests. Defaults to node:child_process spawn. */
  spawnFn?: typeof spawn;
}

interface RawCliEvent {
  type: string;
  [key: string]: unknown;
}

export class ClaudeCliBackend implements LlmBackend {
  readonly id = 'claude-cli';
  readonly mode = 'cli' as const;
  private readonly binary: string;
  private readonly spawnFn: typeof spawn;

  constructor(opts: ClaudeCliBackendOptions = {}) {
    this.binary = opts.binary ?? 'claude';
    this.spawnFn = opts.spawnFn ?? spawn;
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const args = ['-p', '--verbose', '--output-format=stream-json', '--input-format=stream-json'];
    if (request.model.length > 0) args.push('--model', request.model);
    const child = this.spawnFn(this.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    // Surface a missing / unspawnable binary (ENOENT) as a clean error instead
    // of an unhandled process-level 'error' event or a silent empty turn.
    let spawnError: { code: string; message: string } | undefined;
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = {
        code: err.code === 'ENOENT' ? 'cli_not_found' : 'cli_spawn_failed',
        message:
          err.code === 'ENOENT'
            ? `claude CLI not found (looked for "${this.binary}" on PATH) — run \`claude login\` or install Claude Code`
            : (err.message ?? 'failed to spawn claude CLI'),
      };
    });

    const writeReq = serializeRequest(request);
    child.stdin.on('error', () => {
      // EPIPE when the binary never came up — the 'error' handler above owns the report.
    });
    child.stdin.write(writeReq);
    child.stdin.end();

    const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
    let stopReason:
      | 'end_turn'
      | 'max_tokens'
      | 'tool_use'
      | 'stop_sequence'
      | 'pause_turn'
      | 'refusal' = 'end_turn';
    let lastOutputAt = Date.now();
    let stoppedEarly = false;

    const watchdog = setInterval(() => {
      if (Date.now() - lastOutputAt > NO_OUTPUT_TIMEOUT_MS) {
        stoppedEarly = true;
        child.kill('SIGTERM');
      }
    }, 1000);

    if (signal) {
      signal.addEventListener('abort', () => {
        stoppedEarly = true;
        child.kill('SIGTERM');
      });
    }

    try {
      for await (const event of readNdjson(child)) {
        lastOutputAt = Date.now();
        const normalized = translate(event, usage);
        if (normalized) {
          if (normalized.kind === 'stop' && 'reason' in normalized) {
            stopReason = normalized.reason;
          }
          yield normalized;
        }
      }
      if (spawnError) {
        yield { kind: 'error', ...spawnError };
      } else if (stoppedEarly) {
        if (signal?.aborted) {
          yield { kind: 'error', code: 'aborted', message: 'stream aborted by caller' };
        } else {
          yield {
            kind: 'error',
            code: 'no_output',
            message:
              'claude CLI produced no output for 10s after stdin closed — interactive input is not supported in MVP',
          };
        }
      } else {
        yield { kind: 'stop', reason: stopReason, usage };
      }
    } finally {
      clearInterval(watchdog);
      if (!child.killed) child.kill('SIGTERM');
    }
  }
}

export function serializeRequest(request: LlmRequest): string {
  // Claude Code CLI's `--input-format=stream-json` expects one JSONL user-turn
  // per line shaped like the Messages API: `{type,message:{role,content}}`.
  // The model is selected via the `--model` flag, not the payload. For v0 we
  // emit a single line carrying the last user message (session resume — full
  // history replay — is deferred).
  const last = request.messages[request.messages.length - 1];
  const content =
    last && typeof last.content === 'string'
      ? last.content
      : last
        ? JSON.stringify(last.content)
        : '';
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

async function* readNdjson(child: ChildProcessWithoutNullStreams): AsyncIterable<RawCliEvent> {
  let buffer = '';
  child.stdout.setEncoding('utf8');
  for await (const chunk of child.stdout as AsyncIterable<string>) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        try {
          yield JSON.parse(line);
        } catch {
          // Malformed line — drop and continue rather than crash the loop.
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim().length > 0) {
    try {
      yield JSON.parse(buffer.trim());
    } catch {
      // ignore trailing garbage
    }
  }
}

interface CliContentBlock {
  type?: string;
  text?: string;
}

/** Concatenate the text of every `{type:'text'}` block in an assistant message. */
function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as CliContentBlock[])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

/**
 * Normalize one real `claude` stream-json line into an {@link LlmStreamEvent}.
 *
 * The 2.1.x wire shape (verified 2026-06-01):
 *  - `system` / `rate_limit_event` / `user` — control + tool-result echoes; ignored.
 *  - `assistant` — `message.content[]`, text under `{type:'text',text}` blocks.
 *  - `result` — terminal; carries the authoritative top-level `usage` + `stop_reason`.
 *  - `error` — surfaced verbatim.
 */
export function translate(event: RawCliEvent, usage: LlmUsage): LlmStreamEvent | undefined {
  switch (event.type) {
    case 'text': {
      // Defensive: older / partial-message shapes carried text at top level.
      const text = typeof event.text === 'string' ? event.text : '';
      return text.length > 0 ? { kind: 'text_delta', text } : undefined;
    }
    case 'assistant': {
      const message = event.message as { content?: unknown } | undefined;
      const text = textFromContent(message?.content ?? event.text);
      return text.length > 0 ? { kind: 'text_delta', text } : undefined;
    }
    case 'result':
    case 'usage': {
      const u = event.usage as Partial<LlmUsage> | undefined;
      if (u?.input_tokens !== undefined) usage.input_tokens = u.input_tokens;
      if (u?.output_tokens !== undefined) usage.output_tokens = u.output_tokens;
      if (u?.cache_creation_input_tokens !== undefined)
        usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
      if (u?.cache_read_input_tokens !== undefined)
        usage.cache_read_input_tokens = u.cache_read_input_tokens;
      const reasonRaw = typeof event.stop_reason === 'string' ? event.stop_reason : 'end_turn';
      const reason = mapStopReason(reasonRaw);
      return { kind: 'stop', reason, usage: { ...usage } };
    }
    case 'error': {
      const message = typeof event.message === 'string' ? event.message : 'CLI error';
      const code = typeof event.code === 'string' ? event.code : 'cli_error';
      return { kind: 'error', code, message };
    }
    default:
      // system, rate_limit_event, user (tool-result echo), thinking, tool_use — ignored.
      return undefined;
  }
}

function mapStopReason(
  reason: string,
): 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'pause_turn' | 'refusal' {
  switch (reason) {
    case 'max_tokens':
    case 'tool_use':
    case 'stop_sequence':
    case 'pause_turn':
    case 'refusal':
    case 'end_turn':
      return reason;
    default:
      return 'end_turn';
  }
}
