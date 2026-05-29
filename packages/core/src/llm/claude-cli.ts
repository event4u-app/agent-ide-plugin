import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LlmRequest, LlmStreamEvent, LlmUsage } from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';

/**
 * T-406 — Claude Code CLI backend.
 *
 * Spawns `claude -p --output-format=stream-json --input-format=stream-json`
 * as a subprocess. No PTY. Naive `spawn` pipe per the council-tight Sprint-4
 * scope. Interactive prompts hang or fail — the wrapper detects "no output
 * for 10s after stdin closed" and aborts with a clear error.
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
    const child = this.spawnFn(
      this.binary,
      ['-p', '--output-format=stream-json', '--input-format=stream-json'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const writeReq = serializeRequest(request);
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
      if (stoppedEarly) {
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
  // Claude Code CLI accepts a JSONL stream of user-turn messages on stdin.
  // For v0 we emit a single line: the assembled user prompt + a meta tag for
  // the model id. The CLI ignores unknown keys — the schema is forward-compat.
  const last = request.messages[request.messages.length - 1];
  const userText =
    last && typeof last.content === 'string'
      ? last.content
      : last
        ? JSON.stringify(last.content)
        : '';
  return `${JSON.stringify({ type: 'user', text: userText, model: request.model })}\n`;
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

export function translate(event: RawCliEvent, usage: LlmUsage): LlmStreamEvent | undefined {
  switch (event.type) {
    case 'text':
    case 'assistant': {
      const text = typeof event.text === 'string' ? event.text : '';
      return text.length > 0 ? { kind: 'text_delta', text } : undefined;
    }
    case 'tool_use': {
      const id = typeof event.id === 'string' ? event.id : 'cli-tool';
      const name = typeof event.name === 'string' ? event.name : '';
      return { kind: 'tool_use_start', id, name };
    }
    case 'tool_use_end': {
      const id = typeof event.id === 'string' ? event.id : 'cli-tool';
      const name = typeof event.name === 'string' ? event.name : '';
      return { kind: 'tool_use_end', id, name, input: event.input };
    }
    case 'thinking': {
      const text = typeof event.text === 'string' ? event.text : '';
      return text.length > 0 ? { kind: 'thinking_delta', text } : undefined;
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
