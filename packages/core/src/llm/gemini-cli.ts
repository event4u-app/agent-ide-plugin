import { spawn } from 'node:child_process';
import type { LlmRequest, LlmStreamEvent, LlmUsage } from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';
import { promptFromRequest } from './codex-cli.js';
import { readNdjson } from './ndjson.js';

/**
 * T-503 — Gemini CLI backend.
 *
 * Spawns `gemini --output-format stream-json` and pipes the user prompt on
 * stdin. Like Codex, Gemini runs its own agent loop, so this backend surfaces
 * the assistant text + final usage and preserves `session_id`. OAuth consent
 * must be granted once interactively; T-504 detection surfaces an
 * "authorise" hint when the auth probe fails.
 *
 * Event shape (gemini-cli 0.41.2, verified 2026-05-30):
 *   {"type":"init","session_id":"…","model":"…"}
 *   {"type":"message","role":"assistant","content":"…","delta":true}
 *   {"type":"result","status":"success","stats":{input_tokens,output_tokens,cached,…}}
 *
 * `--skip-trust` is passed so the headless run does not block on the
 * trusted-folder prompt.
 */

const NO_OUTPUT_TIMEOUT_MS = 10_000;

export interface GeminiCliBackendOptions {
  /** Resolved binary path from T-504 detection. Defaults to `gemini`. */
  binary?: string;
  /** Inject a spawn fn for tests. Defaults to node:child_process spawn. */
  spawnFn?: typeof spawn;
  /** Pass `--skip-trust` for headless runs (default true). */
  skipTrust?: boolean;
}

export class GeminiCliBackend implements LlmBackend {
  readonly id = 'gemini-cli';
  readonly mode = 'cli' as const;
  private readonly binary: string;
  private readonly spawnFn: typeof spawn;
  private readonly skipTrust: boolean;
  /** Gemini session id from the last run — preserved for follow-up turns. */
  lastSessionId?: string;

  constructor(opts: GeminiCliBackendOptions = {}) {
    this.binary = opts.binary ?? 'gemini';
    this.spawnFn = opts.spawnFn ?? spawn;
    this.skipTrust = opts.skipTrust ?? true;
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const args = ['--output-format', 'stream-json'];
    if (this.skipTrust) args.push('--skip-trust');
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
        if (event.type === 'init' && typeof event.session_id === 'string') {
          this.lastSessionId = event.session_id;
        }
        const normalized = translateGemini(event, usage);
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
              message: 'gemini CLI produced no output for 10s after stdin closed',
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

export function translateGemini(
  event: Record<string, unknown>,
  usage: LlmUsage,
): LlmStreamEvent | undefined {
  switch (event.type) {
    case 'message': {
      if (event.role !== 'assistant') return undefined;
      const content = typeof event.content === 'string' ? event.content : '';
      return content.length > 0 ? { kind: 'text_delta', text: content } : undefined;
    }
    case 'result': {
      const stats = event.stats as Record<string, number> | undefined;
      if (stats) {
        if (typeof stats.input_tokens === 'number') usage.input_tokens = stats.input_tokens;
        if (typeof stats.output_tokens === 'number') usage.output_tokens = stats.output_tokens;
        if (typeof stats.cached === 'number') usage.cache_read_input_tokens = stats.cached;
      }
      if (event.status === 'success') {
        return { kind: 'stop', reason: 'end_turn', usage: { ...usage } };
      }
      const message = typeof event.error === 'string' ? event.error : 'gemini CLI error';
      return { kind: 'error', code: 'cli_error', message };
    }
    case 'error': {
      const message = typeof event.message === 'string' ? event.message : 'gemini CLI error';
      return { kind: 'error', code: 'cli_error', message };
    }
    default:
      return undefined;
  }
}
