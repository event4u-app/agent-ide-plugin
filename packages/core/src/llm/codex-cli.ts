import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LlmRequest, LlmStreamEvent, LlmUsage } from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';
import { readNdjson } from './ndjson.js';

/**
 * T-502 — Codex CLI backend.
 *
 * Spawns `codex exec --json` and pipes the assembled user prompt on stdin.
 * Codex runs its *own* agent loop (its own tools), so this backend treats it
 * as a black-box agent: it surfaces the agent's text + reasoning + final usage
 * and preserves the Codex `thread_id` for follow-up turns. Our tool-calling
 * protocol is not threaded through — Codex manages tools internally.
 *
 * Event shape (codex-cli 0.134.0, verified 2026-05-30):
 *   {"type":"thread.started","thread_id":"…"}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"…"}}
 *   {"type":"turn.completed","usage":{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}}
 *
 * No PTY; naive pipe per the council-tight CLI scope. If Codex produces no
 * output for 10s after stdin closes it is aborted with a clear error.
 */

const NO_OUTPUT_TIMEOUT_MS = 10_000;

export interface CodexCliBackendOptions {
  /** Resolved binary path from T-504 detection. Defaults to `codex`. */
  binary?: string;
  /** Inject a spawn fn for tests. Defaults to node:child_process spawn. */
  spawnFn?: typeof spawn;
  /** Pass `--skip-git-repo-check` (codex refuses non-repo cwd otherwise). */
  skipGitRepoCheck?: boolean;
}

export class CodexCliBackend implements LlmBackend {
  readonly id = 'codex-cli';
  readonly mode = 'cli' as const;
  private readonly binary: string;
  private readonly spawnFn: typeof spawn;
  private readonly skipGitRepoCheck: boolean;
  /** Codex thread id from the last run — preserved for follow-up turns. */
  lastSessionId?: string;

  constructor(opts: CodexCliBackendOptions = {}) {
    this.binary = opts.binary ?? 'codex';
    this.spawnFn = opts.spawnFn ?? spawn;
    this.skipGitRepoCheck = opts.skipGitRepoCheck ?? true;
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const args = ['exec', '--json'];
    if (this.skipGitRepoCheck) args.push('--skip-git-repo-check');
    const child = this.spawnFn(this.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.write(promptFromRequest(request));
    child.stdin.end();

    const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
    let lastOutputAt = Date.now();
    let stoppedEarly = false;
    let emittedStop = false;

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
      for await (const event of readNdjson(child.stdout)) {
        lastOutputAt = Date.now();
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
          this.lastSessionId = event.thread_id;
        }
        const normalized = translateCodex(event, usage);
        if (normalized) {
          if (normalized.kind === 'stop') emittedStop = true;
          yield normalized;
        }
      }
      if (stoppedEarly && !emittedStop) {
        yield signal?.aborted
          ? { kind: 'error', code: 'aborted', message: 'stream aborted by caller' }
          : {
              kind: 'error',
              code: 'no_output',
              message: 'codex CLI produced no output for 10s after stdin closed',
            };
      } else if (!emittedStop) {
        yield { kind: 'stop', reason: 'end_turn', usage };
      }
    } finally {
      clearInterval(watchdog);
      if (!child.killed) child.kill('SIGTERM');
    }
  }
}

/** Assemble the prompt sent to the CLI: the last user-turn text. */
export function promptFromRequest(request: LlmRequest): string {
  const last = request.messages[request.messages.length - 1];
  if (!last) return '\n';
  const text =
    typeof last.content === 'string'
      ? last.content
      : last.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
  return `${text}\n`;
}

export function translateCodex(
  event: Record<string, unknown>,
  usage: LlmUsage,
): LlmStreamEvent | undefined {
  switch (event.type) {
    case 'item.completed':
    case 'item.updated': {
      const item = event.item as { type?: string; text?: string } | undefined;
      if (!item || typeof item.text !== 'string' || item.text.length === 0) return undefined;
      if (item.type === 'reasoning') return { kind: 'thinking_delta', text: item.text };
      if (item.type === 'agent_message') return { kind: 'text_delta', text: item.text };
      return undefined;
    }
    case 'turn.completed': {
      const u = event.usage as Record<string, number> | undefined;
      if (u) {
        if (typeof u.input_tokens === 'number') usage.input_tokens = u.input_tokens;
        if (typeof u.output_tokens === 'number') usage.output_tokens = u.output_tokens;
        if (typeof u.cached_input_tokens === 'number')
          usage.cache_read_input_tokens = u.cached_input_tokens;
        if (typeof u.reasoning_output_tokens === 'number')
          usage.thinking_tokens = u.reasoning_output_tokens;
      }
      return { kind: 'stop', reason: 'end_turn', usage: { ...usage } };
    }
    case 'turn.failed':
    case 'error': {
      const message =
        typeof event.message === 'string'
          ? event.message
          : typeof (event.error as { message?: string })?.message === 'string'
            ? (event.error as { message: string }).message
            : 'codex CLI error';
      return { kind: 'error', code: 'cli_error', message };
    }
    default:
      return undefined;
  }
}

export type { ChildProcessWithoutNullStreams };
