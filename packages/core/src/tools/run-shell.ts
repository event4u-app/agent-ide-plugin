import { relative, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '@event4u-agent/protocol';
import type { TerminalSessionManager } from '../terminal/manager.js';
import type { TerminalEvent } from '../terminal/types.js';

/**
 * `run_shell` agent tool (T-902/T-906) — the spawn path that POPULATES the
 * {@link TerminalSessionManager}.
 *
 * The terminal manager, ring buffer, waiting-for-input detection, and the
 * `terminalSubscribe` handler all shipped ahead of this (PR #41) but nothing
 * ever called `manager.start()`. This tool is that caller: the agentic chat
 * turn runs a command through the SAME manager the IDE terminal panel
 * subscribes to, so a chat-spawned command streams into the panel live and
 * end-to-end. The native `node-pty` binding stays env-gated (`EVENT4U_ENABLE_PTY`)
 * and the xterm.js render is the IDE last-mile — both out of this slice; with
 * the default Fake terminal the tool is fully unit-testable.
 *
 * Design ratified by AI council (codex-cli + gemini-cli, 2026-06-01, UNANIMOUS
 * A1/B1/C1/D1/F):
 *  - A1 — the SHARED manager is injected (chat-spawned sessions are visible to
 *    `terminalSubscribe`), NOT a private one.
 *  - B1 — the agent has no stdin channel, so a command that blocks on input
 *    fails fast: on `inputRequested` the session is killed and the model is told
 *    to make the command non-interactive. The turn abort signal and an optional
 *    `timeoutMs` cap also terminate it. The promise settles EXACTLY ONCE.
 *  - C1 — the full stream lives in the panel / ring buffer; the model gets a
 *    bounded TAIL (last {@link MAX_TAIL_LINES} lines / {@link MAX_TAIL_CHARS}
 *    chars) accumulated INDEPENDENTLY of ring-buffer eviction, plus the total
 *    byte count + a `truncated` flag.
 *  - D1 — a naturally-exited session is LEFT in the manager (the panel keeps
 *    scrollback; the dispatcher disposes all sessions on disconnect). Only a
 *    kill path (inputRequested / abort / timeout) disposes it.
 *  - F — `mutates: true` + `requires_approval`: a shell command is at least as
 *    dangerous as a file write, so it reuses the default-deny gate and is
 *    filtered out of read-only agent modes (wired by the registry entry).
 */

/** Tail bound for the tool_result fed back to the model (council C1). */
export const MAX_TAIL_LINES = 200;
export const MAX_TAIL_CHARS = 8000;

export const RunShellArgsSchema = z.object({
  /** The program to spawn (not a shell string — `args` are passed verbatim). */
  command: z.string().min(1),
  /** Arguments passed to `command`. */
  args: z.array(z.string()).optional(),
  /** Workspace-relative working directory (defaults to the workspace root). */
  cwd: z.string().optional(),
  /** Hard wall-clock cap; the session is killed when it elapses. */
  timeoutMs: z.number().int().positive().optional(),
});
export type RunShellArgs = z.infer<typeof RunShellArgsSchema>;

export const runShellToolDefinition: ToolDefinition = {
  name: 'run_shell',
  description:
    'Run a NON-INTERACTIVE shell command in the workspace and return its output. Provide the program in `command` and its flags in `args` — never a shell pipeline string. Interactive prompts are NOT supported: pass every input via flags (e.g. `--yes`), or the command is killed and you must retry non-interactively. Output streams to the IDE terminal panel; you receive a bounded tail. The IDE asks the user to approve before the command runs.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Program to run (e.g. "npm").' },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments (e.g. ["run", "test"]).',
      },
      cwd: { type: 'string', description: 'Workspace-relative working directory.' },
      timeoutMs: { type: 'number', description: 'Kill the command after this many ms.' },
    },
    required: ['command'],
  },
};

/** Why the run finished. Only `exited` with code 0 is a success. */
export type RunShellStatus = 'exited' | 'needs-input' | 'aborted' | 'timeout' | 'error';

export interface RunShellResult {
  /** Manager session id — the IDE panel subscribes to this to mirror the run. */
  commandId: string;
  status: RunShellStatus;
  /** Set when `status === 'exited'`. */
  exitCode?: number;
  /** Set when the process was signal-terminated. */
  signal?: number;
  /** Last {@link MAX_TAIL_LINES} lines / {@link MAX_TAIL_CHARS} chars of output. */
  outputTail: string;
  /** Total output bytes seen (UTF-16 length), before tail truncation. */
  totalBytes: number;
  /** True when `outputTail` is a truncated tail of a larger stream. */
  truncated: boolean;
  /** Present for `status === 'error'`. */
  message?: string;
}

/** Minimal timer surface, injected so the timeout path is deterministic in tests. */
export interface RunShellScheduler {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const defaultScheduler: RunShellScheduler = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RunShellToolOptions {
  manager: TerminalSessionManager;
  workspaceRoot: string;
  /** Surface id used for the manager subscription (default `agent`). */
  surfaceId?: string;
  /** Injected timer (default global setTimeout/clearTimeout). */
  scheduler?: RunShellScheduler;
}

/**
 * Resolve a workspace-relative path, refusing anything that escapes the root.
 * Mirrors {@link import('./write-files.js').WriteFilesTool} path discipline.
 */
export function resolveCwdInside(workspaceRoot: string, input?: string): string {
  if (!input) return workspaceRoot;
  const abs = resolve(workspaceRoot, input);
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith('..') || rel === '..') {
    throw new Error(`cwd "${input}" escapes the workspace root`);
  }
  return abs;
}

export class RunShellTool {
  private readonly manager: TerminalSessionManager;
  private readonly workspaceRoot: string;
  private readonly surfaceId: string;
  private readonly scheduler: RunShellScheduler;

  constructor(opts: RunShellToolOptions) {
    this.manager = opts.manager;
    this.workspaceRoot = opts.workspaceRoot;
    this.surfaceId = opts.surfaceId ?? 'agent';
    this.scheduler = opts.scheduler ?? defaultScheduler;
  }

  /**
   * Spawn the command in the shared manager and resolve when it reaches a
   * terminal state. All manager interaction (start + subscribe + listener
   * attach) happens synchronously inside the promise executor, so the session
   * exists the moment `run` is called — no start/subscribe gap (a test can
   * grab `manager.list()` and drive the Fake terminal right after calling).
   */
  run(args: RunShellArgs, signal?: AbortSignal): Promise<RunShellResult> {
    const cwd = resolveCwdInside(this.workspaceRoot, args.cwd);

    return new Promise<RunShellResult>((resolveResult) => {
      const session = this.manager.start({
        command: args.command,
        ...(args.args ? { args: args.args } : {}),
        cwd,
      });
      const { commandId } = session;

      // Tail accumulator — kept independent of the manager ring buffer so a
      // verbose command that evicts the buffer head still yields the true tail.
      const lines: string[] = [];
      let pending = '';
      let totalBytes = 0;
      let truncated = false;

      const appendOutput = (data: string): void => {
        totalBytes += data.length;
        pending += data;
        const parts = pending.split('\n');
        pending = parts.pop() ?? '';
        for (const line of parts) pushLine(line);
      };
      const pushLine = (line: string): void => {
        lines.push(line);
        if (lines.length > MAX_TAIL_LINES) {
          lines.shift();
          truncated = true;
        }
      };
      const buildTail = (): string => {
        const flushed = pending.length > 0 ? [...lines, pending] : lines;
        let tail = flushed.join('\n');
        if (tail.length > MAX_TAIL_CHARS) {
          tail = tail.slice(tail.length - MAX_TAIL_CHARS);
          truncated = true;
        }
        return tail;
      };

      // --- single-resolution machinery (council B1: settle EXACTLY once) ------
      let settled = false;
      let timer: unknown;
      const settle = (
        outcome: Omit<RunShellResult, 'commandId' | 'outputTail' | 'totalBytes' | 'truncated'>,
        kill: boolean,
      ): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) this.scheduler.clearTimer(timer);
        signal?.removeEventListener('abort', onAbort);
        if (subscriptionId !== undefined) this.manager.unsubscribe(commandId, subscriptionId);
        // D1: leave a naturally-exited session for panel scrollback; only a kill
        // path (input/abort/timeout/error) disposes it.
        if (kill) this.manager.dispose(commandId);
        resolveResult({
          commandId,
          outputTail: buildTail(),
          totalBytes,
          truncated,
          ...outcome,
        });
      };

      const deliver = (event: TerminalEvent): void => {
        switch (event.kind) {
          case 'output':
            appendOutput(event.chunk.data);
            return;
          case 'exit':
            // Natural EOF — the absolute final signal. Leave the session (D1).
            settle(
              {
                status: 'exited',
                exitCode: event.exitCode,
                ...(event.signal !== undefined ? { signal: event.signal } : {}),
              },
              false,
            );
            return;
          case 'inputRequested':
            // The agent has no stdin channel — fail fast (B1) and kill so the
            // PTY does not hang. A later `exit` from the kill is swallowed by the
            // settled guard.
            settle({ status: 'needs-input' }, true);
            return;
          case 'error':
            settle({ status: 'error', message: event.message }, true);
            return;
          default:
            // status / inputConflict are not terminal for the agent's purposes.
            return;
        }
      };

      const onAbort = (): void => settle({ status: 'aborted' }, true);

      // Subscribe BEFORE wiring abort/timeout so any buffered replay is folded.
      const sub = this.manager.subscribe({
        commandId,
        surfaceId: this.surfaceId,
        replayFromSeq: 0,
        deliver,
      });
      const subscriptionId = sub?.subscriptionId;
      for (const chunk of sub?.replay.chunks ?? []) appendOutput(chunk.data);
      // A session that was already `done` at subscribe time (e.g. a synchronous
      // Fake that exited instantly) emits no live `exit` — settle from status.
      if (sub && sub.status === 'done') {
        const done = this.manager.get(commandId);
        settle(
          {
            status: 'exited',
            exitCode: done?.exitCode ?? 0,
            ...(done?.signal !== undefined ? { signal: done.signal } : {}),
          },
          false,
        );
        return;
      }

      if (signal?.aborted) {
        settle({ status: 'aborted' }, true);
        return;
      }
      signal?.addEventListener('abort', onAbort);

      if (args.timeoutMs !== undefined) {
        timer = this.scheduler.setTimer(() => settle({ status: 'timeout' }, true), args.timeoutMs);
      }
    });
  }
}
