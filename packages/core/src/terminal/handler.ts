import type {
  Envelope,
  TerminalEvent as WireTerminalEvent,
  TerminalInputRequest,
  TerminalInputResponse,
  TerminalResizeRequest,
  TerminalResizeResponse,
  TerminalSubscribeRequest,
  TerminalSubscribeResponse,
} from '@event4u-agent/protocol';
import type { EnvelopeSink } from '../chat/handler.js';
import type { TerminalSessionManager } from './manager.js';
import type { TerminalEvent } from './types.js';

/**
 * Live-terminal RPC handler (T-PRD03 / Phase 9 T-903, T-904/906/907/908 core).
 *
 * Wires the three already-shipped terminal protocol methods onto the
 * already-shipped {@link TerminalSessionManager} so the sidecar answers them
 * instead of falling to `handler_error`:
 *  - `terminalSubscribe` — long-lived STREAMING request. Mirrors the
 *    `chatSend`/`agentTurn` contract: emits `done:false` envelopes via the
 *    injected {@link EnvelopeSink} and RETURNS the terminal `done:true`
 *    envelope; the dispatcher owns exactly-once terminal emission.
 *  - `terminalInput` / `terminalResize` — plain request/response.
 *
 * Pure core: the manager injects a {@link import('./types.js').Terminal} (the
 * deterministic Fake in tests/CI; the env-gated native `node-pty` adapter and
 * the spawn path that POPULATES the manager — a future `run_shell` agent tool —
 * stay native-/IDE-gated, out of this slice). The xterm.js renderers in both
 * IDEs are the deferred render half.
 *
 * Design ratified by AI council (codex-cli + gemini-cli, 2026-06-01, UNANIMOUS
 * A1/B1/C1/D1/E/F/G):
 *  - A1 — the `exit` {@link TerminalEvent} IS the terminal `done:true` envelope
 *    (the protocol's universal session-EOF); no new wire payload. It is NEVER
 *    also emitted as a `done:false` event (trap: double-exit emission).
 *  - C1 — the {@link TerminalSubscribeResponse} replay envelope is emitted
 *    SYNCHRONOUSLY right after `subscribe()` (which registers `deliver` + snaps
 *    the replay atomically), so it always precedes any live event (single
 *    JS thread → no interleave).
 *  - B1 — an already-`done` session (its `exit` fired before this subscriber
 *    attached, so `deliver` will never see it) resolves immediately with a
 *    terminal `exit` SYNTHESISED from the session (trap: already-done hang).
 *  - D1 — subscribing to an unknown `commandId` is a request error
 *    (`terminal_no_session`), not a lifecycle event.
 *  - `error` {@link TerminalEvent}s do NOT terminate — only `exit` does (trap:
 *    error-to-exit mapping); `deliver` never throws so the manager's
 *    backpressure floor never silently drops us mid-stream (trap: drop-off
 *    hang); resolution is guarded by an idempotent finaliser (trap:
 *    resolve-twice across dispose/exit races).
 */

/** Thrown for a terminal request the manager cannot serve; carries a wire `code`. */
export class TerminalRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TerminalRequestError';
  }
}

export interface TerminalHandlerDeps {
  /** The session manager this handler exposes; populated by the spawn path. */
  manager: TerminalSessionManager;
}

export class TerminalHandler {
  constructor(private readonly deps: TerminalHandlerDeps) {}

  /**
   * Attach to a session and stream its events. Emits the replay snapshot then
   * live events as `done:false`; resolves with the terminal `exit` envelope
   * (`done:true`) when the session ends. Throws {@link TerminalRequestError}
   * (`terminal_no_session`) when `commandId` is unknown.
   */
  handleSubscribe(
    messageId: string,
    req: TerminalSubscribeRequest,
    emit: EnvelopeSink,
  ): Promise<Envelope> {
    let settle!: (envelope: Envelope) => void;
    const done = new Promise<Envelope>((resolve) => {
      settle = resolve;
    });

    let settled = false;
    const finalize = (event: WireTerminalEvent): void => {
      if (settled) return;
      settled = true;
      settle({ messageId, messageType: 'terminalSubscribe', data: event, done: true });
    };

    const deliver = (event: TerminalEvent): void => {
      if (settled) return;
      // `exit` is the single terminal `done:true` (A1) — never also `done:false`.
      if (event.kind === 'exit') {
        finalize(event);
        return;
      }
      try {
        emit({ messageId, messageType: 'terminalSubscribe', data: event, done: false });
      } catch {
        // A throwing sink must not let the manager drop us before `exit` (it
        // drops subscribers whose `deliver` throws) — swallow so the stream
        // still resolves on the session's terminal event.
      }
    };

    // subscribe() registers `deliver` AND snapshots the replay in one sync call
    // → no gap between replay and live delivery.
    const result = this.deps.manager.subscribe({
      commandId: req.commandId,
      surfaceId: req.surfaceId,
      replayFromSeq: req.replayFromSeq,
      deliver,
    });
    if (!result) {
      throw new TerminalRequestError(
        'terminal_no_session',
        `No terminal session is registered for "${req.commandId}".`,
      );
    }

    // First envelope: the replay + current state (C1), before any live event.
    const first: TerminalSubscribeResponse = {
      subscriptionId: result.subscriptionId,
      status: result.status,
      pendingInput: result.pendingInput,
      replay: result.replay,
    };
    emit({ messageId, messageType: 'terminalSubscribe', data: first, done: false });

    // Already exited before we attached → the `exit` event will never reach
    // `deliver`; synthesise the terminal from the session so the stream closes.
    if (result.status === 'done') {
      finalize(this.synthesizeExit(req.commandId));
    }

    return done;
  }

  /**
   * Write to a session's stdin (raw, or answering a pending input request).
   * First-write-wins arbitration + rejection reason come straight from the
   * manager.
   */
  handleInput(req: TerminalInputRequest): TerminalInputResponse {
    const result = this.deps.manager.write({
      commandId: req.commandId,
      surfaceId: req.surfaceId,
      data: req.data,
      ...(req.inputRequestId !== undefined ? { inputRequestId: req.inputRequestId } : {}),
    });
    if (result.accepted) return { accepted: true };
    return {
      accepted: false,
      reason: result.reason,
      ...(result.winningSurfaceId !== undefined
        ? { winningSurfaceId: result.winningSurfaceId }
        : {}),
    };
  }

  /** Resize a session's PTY. `ack:false` for an unknown or already-done session. */
  handleResize(req: TerminalResizeRequest): TerminalResizeResponse {
    return { ack: this.deps.manager.resize(req.commandId, req.cols, req.rows) };
  }

  /** Release every live session/PTY (dispatcher shutdown, F). */
  dispose(): void {
    this.deps.manager.disposeAll();
  }

  /**
   * Build the terminal `exit` event for a session that already ended before a
   * subscriber attached. Duration is derived from the two ISO stamps (one
   * `now` clock → no cross-clock mixing); both default safely when the session
   * was already forgotten.
   */
  private synthesizeExit(commandId: string): WireTerminalEvent {
    const session = this.deps.manager.get(commandId);
    const durationMs =
      session?.endedAt !== undefined
        ? Math.max(0, Date.parse(session.endedAt) - Date.parse(session.startedAt))
        : 0;
    return {
      kind: 'exit',
      commandId,
      exitCode: session?.exitCode ?? 0,
      ...(session?.signal !== undefined ? { signal: session.signal } : {}),
      durationMs,
    };
  }
}
