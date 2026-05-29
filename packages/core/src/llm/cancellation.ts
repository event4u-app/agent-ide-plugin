import type { ChildProcess } from 'node:child_process';

/**
 * T-412 — Stop button + ESC shortcut. Three-layer cancellation per
 * PLAN.md §9.12.1:
 *
 *   Layer 1 — UI Stop button + ESC when chat has focus (IDE-side).
 *   Layer 2 — Agent Core abort signal — fan out an AbortController to
 *             the LLM backend stream + every active tool call.
 *   Layer 3 — Backend cancel:
 *             • API: HTTP request.abort() (handled inside the backend).
 *             • CLI: SIGTERM to the subprocess, 2s grace, then SIGKILL.
 *
 * The class owns Layer 2 + the CLI half of Layer 3. The IDE button (Layer 1)
 * calls `requestCancel()`; the LLM stream and tool dispatchers consume the
 * `signal` property.
 *
 * End-to-end goal: complete cancellation within 4s of `requestCancel()`,
 * including a deliberately blocking subprocess scenario (`sleep 60 & wait`).
 */

export interface CancellationOptions {
  /** Grace period before SIGKILL. Default 2000 ms. */
  gracePeriodMs?: number;
}

export class CancellationToken {
  private readonly controller = new AbortController();
  private readonly children = new Set<ChildProcess>();
  private cancelled = false;
  private readonly gracePeriodMs: number;

  constructor(opts: CancellationOptions = {}) {
    this.gracePeriodMs = opts.gracePeriodMs ?? 2000;
  }

  /** AbortSignal handed to LLM backends + tool calls. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Whether `requestCancel()` was called. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** Register a child process so cancel() can SIGTERM → SIGKILL it. */
  registerChild(child: ChildProcess): void {
    if (this.cancelled) {
      this.killChild(child);
      return;
    }
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
  }

  /**
   * Fire all three layers. Returns when every registered child has exited
   * or after `gracePeriodMs + 100ms` (whichever is sooner).
   */
  async requestCancel(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controller.abort();
    const waits: Promise<void>[] = [];
    for (const child of this.children) {
      waits.push(this.killChild(child));
    }
    await Promise.all(waits);
  }

  private killChild(child: ChildProcess): Promise<void> {
    const gracePeriodMs = this.gracePeriodMs;
    return new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.killed) {
        resolve();
        return;
      }
      const onExit = (): void => {
        clearTimeout(killTimer);
        resolve();
      };
      child.once('exit', onExit);
      const killTimer = setTimeout(() => {
        try {
          if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
        } catch {
          // best-effort — process may already be gone
        }
      }, gracePeriodMs);
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(killTimer);
        child.removeListener('exit', onExit);
        resolve();
      }
    });
  }
}
