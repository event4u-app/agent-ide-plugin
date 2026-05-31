/**
 * Phase 9 — Live PTY terminal, pure-core types (T-901 interface / T-902 / T-903 / T-905).
 *
 * A running shell command lives in the sidecar as a single PTY whose output is
 * an ordered, append-only chunk stream (`tmux`/`screen` model — every IDE
 * surface is a thin renderer of the one stream). The core owns: the
 * {@link Terminal} interface + a deterministic Fake (the real `node-pty`
 * binding is native and stays deferred per the no-native-deps law), the
 * dual-capped {@link OutputRingBuffer} with seq-based replay, the
 * {@link TerminalSessionManager} (FIFO input + first-write-wins arbitration +
 * reconnect/replay), and the waiting-for-input detection state machine. The
 * xterm.js renderers, the VS Code Pseudoterminal bridge, the JetBrains mirror,
 * and the real PTY binding stay IDE-/native-gated.
 *
 * Design ratified by AI council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-31,
 * UNANIMOUS on all four decisions): interface + Fake + gated dynamic import for
 * node-pty (Phase-8 ONNX playbook); server→client push modelled as a long-lived
 * `terminal.subscribe` STREAMING request over the existing NDJSON envelope (no
 * new notification concept — ADR-003 stays intact); RingBuffer dual cap
 * (UTF-8 bytes + `\n` lines) with monotonic per-chunk seq and explicit loss
 * metadata (`droppedChunks` / `droppedBytes` / `firstSeqAvailable` /
 * `restartRequired`); input arbitration is first-write-wins per
 * {@link PendingInput.inputRequestId} (claim-mode for REPLs deferred to v1.5).
 *
 * Council scope guards folded in: chunks store RAW bytes (the renderer's
 * xterm.js wants the ANSI codes) but the waiting-for-input heuristic runs over
 * an ANSI-stripped view; the heuristic is a tentative UI hint, idle-timeout (or
 * the PTY read-idle hook) is what CONFIRMS; no terminal-screen model lives in
 * core.
 */

/** Lifecycle of one command's PTY session (PLAN.md §8.9.2). */
export type TerminalStatus = 'pending' | 'running' | 'waiting-input' | 'done';

/**
 * One chunk of PTY output. A PTY merges stdout and stderr into a single ordered
 * byte stream, so there is no per-stream split here. `data` is raw (ANSI codes
 * intact); `seq` is monotonic per session.
 */
export interface OutputChunk {
  /** Monotonic per-session sequence number, assigned on push. */
  seq: number;
  /** Raw output bytes, decoded as a UTF-8 string (ANSI escapes preserved). */
  data: string;
  /** ISO-8601 UTC stamp of when the chunk was buffered. */
  at: string;
}

/**
 * Result of replaying a session from a given seq. When `restartRequired` is
 * true the requested seq fell behind the buffer window (it was evicted), so the
 * client must cold-boot its renderer from `chunks` rather than append.
 */
export interface ReplaySlice {
  chunks: OutputChunk[];
  /** Chunks evicted from the buffer over its lifetime (capacity pressure). */
  droppedChunks: number;
  /** Bytes evicted from the buffer over its lifetime. */
  droppedBytes: number;
  /** seq of the oldest chunk still retained (== nextSeq when the buffer is empty). */
  firstSeqAvailable: number;
  /** seq the next pushed chunk will receive. */
  nextSeq: number;
  /** The caller's `fromSeq` was below `firstSeqAvailable` → renderer must reset. */
  restartRequired: boolean;
}

/** A discrete input request the session is currently blocked on. */
export interface PendingInput {
  /** Stable id — first-write-wins is scoped to THIS request, not the session. */
  inputRequestId: string;
  /** The (ANSI-stripped) prompt text the heuristic matched, for the UI banner. */
  prompt: string;
  /** When the request was raised. */
  at: string;
}

/** Spawn parameters for a PTY-backed command. */
export interface SpawnOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/** Exit signal payload. `signal` is set for signal-terminated processes. */
export interface TerminalExit {
  exitCode: number;
  signal?: number;
}

/**
 * The sidecar-side PTY handle. The real implementation wraps a `node-pty` IPty
 * (native, gated dynamic import — see {@link loadNodePtyTerminal}); all unit
 * tests drive {@link FakeTerminal}. Contract: `onExit` is the ABSOLUTE final
 * signal; any `onData` emitted after exit is a tolerated race the manager still
 * buffers but never lets re-open the session.
 */
export interface Terminal {
  /** Subscribe to raw output chunks. */
  onData(listener: (data: string) => void): void;
  /** Subscribe to the single terminal exit. */
  onExit(listener: (exit: TerminalExit) => void): void;
  /**
   * Optional PTY read-idle hook (waiting-for-input strategy (b)): fires when the
   * child is blocked in `read()` with no recent output. The Fake emits it on
   * demand; the real node-pty adapter maps it best-effort. Absence is fine —
   * the idle-timeout strategy (c) still confirms.
   */
  onReadIdle?(listener: () => void): void;
  /** Write to the child's stdin. The manager serialises writes (FIFO). */
  write(data: string): void;
  /** Resize the PTY — required from day one so TUI tools work once rendered. */
  resize(cols: number, rows: number): void;
  /** Terminate the child. */
  kill(signal?: string): void;
}

/** Factory the manager uses to create a PTY per command (injected in tests). */
export type TerminalFactory = (options: SpawnOptions) => Terminal;

// --- broadcast event union (mirrors the `terminal.*` protocol stream) -------

/** A live output chunk for a session. */
export interface TerminalOutputEvent {
  kind: 'output';
  commandId: string;
  chunk: OutputChunk;
}

/** A status transition for a session. */
export interface TerminalStatusEvent {
  kind: 'status';
  commandId: string;
  status: TerminalStatus;
}

/** The session is (confirmed) waiting for input. */
export interface TerminalInputRequestedEvent {
  kind: 'inputRequested';
  commandId: string;
  pending: PendingInput;
}

/** A surface's input write was rejected because another surface answered first. */
export interface TerminalInputConflictEvent {
  kind: 'inputConflict';
  commandId: string;
  inputRequestId: string;
  /** The surface whose write was accepted. */
  winningSurfaceId: string;
  /** The surface being told it lost. */
  losingSurfaceId: string;
}

/** The session ended. */
export interface TerminalExitEvent {
  kind: 'exit';
  commandId: string;
  exitCode: number;
  signal?: number;
  durationMs: number;
}

/** A session-level error (spawn failure, adapter fault). */
export interface TerminalErrorEvent {
  kind: 'error';
  commandId: string;
  message: string;
}

/** Everything a subscriber can receive on the live stream. */
export type TerminalEvent =
  | TerminalOutputEvent
  | TerminalStatusEvent
  | TerminalInputRequestedEvent
  | TerminalInputConflictEvent
  | TerminalExitEvent
  | TerminalErrorEvent;
