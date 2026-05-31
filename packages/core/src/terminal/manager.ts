import { OutputRingBuffer, type RingBufferOptions } from './ring-buffer.js';
import { fakeTerminalFactory } from './pty.js';
import { WaitingForInputTracker, type WaitingTrackerOptions } from './waiting-input.js';
import type {
  PendingInput,
  ReplaySlice,
  SpawnOptions,
  Terminal,
  TerminalEvent,
  TerminalFactory,
  TerminalStatus,
} from './types.js';

/**
 * TerminalSessionManager (T-902).
 *
 * One PTY per command in the sidecar; every IDE surface is a thin renderer of
 * the one ordered stream (`tmux`/`screen` model). The manager owns the session
 * map, the per-session ring buffer + waiting-for-input tracker, the FIFO stdin
 * path with first-write-wins arbitration per {@link PendingInput.inputRequestId},
 * and the subscriber fan-out with atomic replay-then-attach for reconnect.
 *
 * Pure core: no real timers, no I/O of its own. The Terminal is injected (Fake
 * in tests; the native node-pty adapter behind the T-901 flag in production).
 * `now` / `idFactory` are injected for deterministic tests, matching the chat
 * store. Council guards folded in: a subscriber that throws is dropped, never
 * breaking the fan-out (backpressure floor); a transport disconnect
 * (`unsubscribe`) never kills the PTY — only `dispose` does; output after exit
 * is buffered but never re-opens a `done` session.
 */

export interface TerminalSession {
  commandId: string;
  command: string;
  cwd?: string;
  status: TerminalStatus;
  startedAt: string;
  startedAtMs: number;
  endedAt?: string;
  exitCode?: number;
  signal?: number;
  pendingInput: PendingInput | null;
  /** Surface that answered the current/last pending input (first-write-wins). */
  lastInputWinner?: { inputRequestId: string; surfaceId: string };
  readonly buffer: OutputRingBuffer;
  readonly terminal: Terminal;
  readonly tracker: WaitingForInputTracker;
  readonly subscribers: Map<string, Subscriber>;
}

interface Subscriber {
  subscriptionId: string;
  surfaceId: string;
  deliver: (event: TerminalEvent) => void;
}

export interface StartInput extends SpawnOptions {
  /** Caller-supplied command id; generated when omitted. */
  commandId?: string;
}

export interface WriteInput {
  commandId: string;
  surfaceId: string;
  data: string;
  /**
   * The pending request being answered. Omit for a raw write (no active prompt);
   * raw writes are serialised FIFO and never arbitrated.
   */
  inputRequestId?: string;
}

export type WriteResult =
  | { accepted: true }
  | {
      accepted: false;
      reason: 'no-session' | 'session-done' | 'already-submitted' | 'stale-request';
      winningSurfaceId?: string;
    };

export interface SubscribeInput {
  commandId: string;
  surfaceId: string;
  /** Replay from this seq (default 0 = full snapshot). */
  replayFromSeq?: number;
  deliver: (event: TerminalEvent) => void;
}

export interface SubscribeResult {
  subscriptionId: string;
  status: TerminalStatus;
  pendingInput: PendingInput | null;
  replay: ReplaySlice;
}

export interface TerminalManagerOptions {
  terminalFactory?: TerminalFactory;
  now?: () => string;
  nowMs?: () => number;
  idFactory?: () => string;
  ringBuffer?: RingBufferOptions;
  waiting?: WaitingTrackerOptions;
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly terminalFactory: TerminalFactory;
  private readonly now: () => string;
  private readonly nowMs: () => number;
  private readonly idFactory: () => string;
  private readonly ringBufferOptions: RingBufferOptions;
  private readonly waitingOptions: WaitingTrackerOptions;
  private idCounter = 0;

  constructor(options: TerminalManagerOptions = {}) {
    this.terminalFactory = options.terminalFactory ?? fakeTerminalFactory;
    this.now = options.now ?? (() => new Date().toISOString());
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => `t-${++this.idCounter}`);
    this.ringBufferOptions = options.ringBuffer ?? {};
    this.waitingOptions = options.waiting ?? {};
  }

  /** Spawn a command's PTY and begin streaming. Returns the live session. */
  start(input: StartInput): TerminalSession {
    const commandId = input.commandId ?? this.idFactory();
    if (this.sessions.has(commandId)) {
      throw new Error(`terminal session already exists: ${commandId}`);
    }
    const terminal = this.terminalFactory({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      cols: input.cols,
      rows: input.rows,
    });
    const session: TerminalSession = {
      commandId,
      command: input.command,
      cwd: input.cwd,
      status: 'running',
      startedAt: this.now(),
      startedAtMs: this.nowMs(),
      pendingInput: null,
      buffer: new OutputRingBuffer({ now: this.now, ...this.ringBufferOptions }),
      terminal,
      tracker: new WaitingForInputTracker(this.waitingOptions),
      subscribers: new Map(),
    };
    this.sessions.set(commandId, session);

    terminal.onData((data) => this.handleData(session, data));
    terminal.onExit((exit) => this.handleExit(session, exit.exitCode, exit.signal));
    terminal.onReadIdle?.(() => this.handleReadIdle(session));

    return session;
  }

  private handleData(session: TerminalSession, data: string): void {
    const chunk = session.buffer.push(data);
    this.broadcast(session, { kind: 'output', commandId: session.commandId, chunk });
    // Output after exit is buffered (so a reconnecting surface still sees it)
    // but never re-opens a done session.
    if (session.status === 'done') return;
    const before = session.tracker.state;
    const after = session.tracker.onOutput(data, this.nowMs());
    if (after !== before) this.applyWaitingState(session);
  }

  private handleReadIdle(session: TerminalSession): void {
    if (session.status === 'done') return;
    const before = session.tracker.state;
    const after = session.tracker.onReadIdle();
    if (after !== before) this.applyWaitingState(session);
  }

  /**
   * Confirm a tentative waiting state via the idle timeout (strategy (c)). The
   * sidecar calls this on an interval; tests call it directly with a clock.
   */
  poll(commandId: string, atMs?: number): TerminalStatus | undefined {
    const session = this.sessions.get(commandId);
    if (!session || session.status === 'done') return session?.status;
    const before = session.tracker.state;
    const after = session.tracker.poll(atMs ?? this.nowMs());
    if (after !== before) this.applyWaitingState(session);
    return session.status;
  }

  /** Map the tracker state onto session status + broadcast the right events. */
  private applyWaitingState(session: TerminalSession): void {
    const tracker = session.tracker;
    if (tracker.state === 'confirmed') {
      if (!session.pendingInput) {
        session.pendingInput = {
          inputRequestId: this.idFactory(),
          prompt: tracker.lastPromptText,
          at: this.now(),
        };
        this.setStatus(session, 'waiting-input');
        this.broadcast(session, {
          kind: 'inputRequested',
          commandId: session.commandId,
          pending: session.pendingInput,
        });
      }
    } else if (tracker.state === 'idle' && session.status === 'waiting-input') {
      // Output resumed before an answer — withdraw the pending request.
      session.pendingInput = null;
      this.setStatus(session, 'running');
    }
  }

  /**
   * Write to a session's stdin. Raw writes (no `inputRequestId`) are always
   * accepted and serialised FIFO. A write answering a pending request is
   * arbitrated first-write-wins: the first surface to answer that
   * `inputRequestId` wins; later answers are rejected with the winner's id and
   * the loser gets an `inputConflict` event.
   */
  write(input: WriteInput): WriteResult {
    const session = this.sessions.get(input.commandId);
    if (!session) return { accepted: false, reason: 'no-session' };
    if (session.status === 'done') return { accepted: false, reason: 'session-done' };

    if (input.inputRequestId !== undefined) {
      const pending = session.pendingInput;
      if (!pending || pending.inputRequestId !== input.inputRequestId) {
        // The request was already answered or never existed → first-write-wins lost.
        const winner = session.lastInputWinner;
        if (winner && winner.inputRequestId === input.inputRequestId) {
          this.broadcast(session, {
            kind: 'inputConflict',
            commandId: session.commandId,
            inputRequestId: input.inputRequestId,
            winningSurfaceId: winner.surfaceId,
            losingSurfaceId: input.surfaceId,
          });
          return {
            accepted: false,
            reason: 'already-submitted',
            winningSurfaceId: winner.surfaceId,
          };
        }
        return { accepted: false, reason: 'stale-request' };
      }
      // First valid answer wins.
      session.terminal.write(input.data);
      session.lastInputWinner = {
        inputRequestId: pending.inputRequestId,
        surfaceId: input.surfaceId,
      };
      session.pendingInput = null;
      session.tracker.clear();
      this.setStatus(session, 'running');
      return { accepted: true };
    }

    // Raw write — no active prompt arbitration.
    session.terminal.write(input.data);
    return { accepted: true };
  }

  /** Resize a session's PTY. */
  resize(commandId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(commandId);
    if (!session || session.status === 'done') return false;
    session.terminal.resize(cols, rows);
    return true;
  }

  /**
   * Attach a subscriber, atomically: the replay snapshot is computed and the
   * subscriber registered in one synchronous call (JS is single-threaded, so no
   * live event can interleave between the two), guaranteeing no gap between
   * replay and live delivery.
   */
  subscribe(input: SubscribeInput): SubscribeResult | undefined {
    const session = this.sessions.get(input.commandId);
    if (!session) return undefined;
    const replay = session.buffer.since(input.replayFromSeq ?? 0);
    const subscriptionId = this.idFactory();
    session.subscribers.set(subscriptionId, {
      subscriptionId,
      surfaceId: input.surfaceId,
      deliver: input.deliver,
    });
    return {
      subscriptionId,
      status: session.status,
      pendingInput: session.pendingInput,
      replay,
    };
  }

  /** Detach a subscriber. Does NOT kill the PTY (transport disconnect ≠ death). */
  unsubscribe(commandId: string, subscriptionId: string): boolean {
    return this.sessions.get(commandId)?.subscribers.delete(subscriptionId) ?? false;
  }

  /** Replay convenience for a polling client. */
  snapshotSince(commandId: string, fromSeq: number): ReplaySlice | undefined {
    return this.sessions.get(commandId)?.buffer.since(fromSeq);
  }

  get(commandId: string): TerminalSession | undefined {
    return this.sessions.get(commandId);
  }

  list(): TerminalSession[] {
    return [...this.sessions.values()];
  }

  /** Terminate and forget a session (kills the PTY). */
  dispose(commandId: string): boolean {
    const session = this.sessions.get(commandId);
    if (!session) return false;
    if (session.status !== 'done') session.terminal.kill();
    this.sessions.delete(commandId);
    return true;
  }

  disposeAll(): void {
    for (const commandId of [...this.sessions.keys()]) this.dispose(commandId);
  }

  private handleExit(session: TerminalSession, exitCode: number, signal?: number): void {
    if (session.status === 'done') return;
    session.status = 'done';
    session.exitCode = exitCode;
    session.signal = signal;
    session.endedAt = this.now();
    session.pendingInput = null;
    session.tracker.clear();
    const durationMs = this.nowMs() - session.startedAtMs;
    this.broadcast(session, { kind: 'status', commandId: session.commandId, status: 'done' });
    this.broadcast(session, {
      kind: 'exit',
      commandId: session.commandId,
      exitCode,
      signal,
      durationMs,
    });
  }

  private setStatus(session: TerminalSession, status: TerminalStatus): void {
    if (session.status === status) return;
    session.status = status;
    this.broadcast(session, { kind: 'status', commandId: session.commandId, status });
  }

  private broadcast(session: TerminalSession, event: TerminalEvent): void {
    for (const sub of [...session.subscribers.values()]) {
      try {
        sub.deliver(event);
      } catch {
        // Backpressure floor: a faulty subscriber is dropped, never breaks fan-out.
        session.subscribers.delete(sub.subscriptionId);
      }
    }
  }
}
