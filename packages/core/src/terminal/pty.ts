import type { SpawnOptions, Terminal, TerminalExit } from './types.js';

/**
 * PTY adapters (T-901).
 *
 * The real binding is `node-pty` — a NATIVE module, off the default dependency
 * graph by project law (no-native-deps; the CI matrix runs node 20 too). So,
 * exactly as Phase 8 did for ONNX embeddings: ship a {@link Terminal} interface
 * + a deterministic {@link FakeTerminal} that every unit test drives, and load
 * the real binding via a dynamic `import()` of a STRING-VARIABLE specifier
 * (tsc never resolves it → no TS2307) gated behind an env flag. The native
 * adapter (`NodePtyTerminal`) stays integration-gated; T-901 — the real
 * binding + 6-arch prebuilds — is the deferred follow-up.
 *
 * Council guard (codex + gemini, 2026-05-31): the Fake is CHUNK-based, never
 * line-oriented. Tests can emit split ANSI, `\r` without `\n`, prompts without
 * a trailing newline, and output AFTER exit — the races a real shell produces.
 * `onExit` is the absolute final lifecycle signal.
 */

/** Env flag that opts into the real native PTY. Absent ⇒ Fake-only (tests, CI). */
export const PTY_ENABLE_ENV = 'EVENT4U_ENABLE_PTY';

type DataListener = (data: string) => void;
type ExitListener = (exit: TerminalExit) => void;
type IdleListener = () => void;

/**
 * Scriptable in-memory {@link Terminal}. Drive it from tests via {@link emit},
 * {@link emitReadIdle}, and {@link emitExit}; inspect {@link writes},
 * {@link resizes}, {@link killed}.
 */
export class FakeTerminal implements Terminal {
  readonly options: SpawnOptions;
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  killSignal: string | undefined;
  exited = false;

  private dataListeners: DataListener[] = [];
  private exitListeners: ExitListener[] = [];
  private idleListeners: IdleListener[] = [];

  constructor(options: SpawnOptions = { command: 'fake' }) {
    this.options = options;
  }

  onData(listener: DataListener): void {
    this.dataListeners.push(listener);
  }
  onExit(listener: ExitListener): void {
    this.exitListeners.push(listener);
  }
  onReadIdle(listener: IdleListener): void {
    this.idleListeners.push(listener);
  }

  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(signal?: string): void {
    if (this.killed) return;
    this.killed = true;
    this.killSignal = signal;
    if (!this.exited) this.emitExit({ exitCode: signal ? 1 : 0, signal: signal ? 15 : undefined });
  }

  // --- test drivers ---

  /**
   * Emit a raw output chunk. Permitted even AFTER exit so tests can exercise the
   * output-after-exit race the manager must tolerate.
   */
  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  /** Emit the PTY read-idle hint (waiting-for-input strategy (b)). */
  emitReadIdle(): void {
    for (const listener of this.idleListeners) listener();
  }

  /** Emit the single terminal exit. Calling twice throws (catches double-exit). */
  emitExit(exit: TerminalExit = { exitCode: 0 }): void {
    if (this.exited) throw new Error('FakeTerminal: exit emitted twice');
    this.exited = true;
    for (const listener of this.exitListeners) listener(exit);
  }
}

/** Default factory used in tests / CI — always a {@link FakeTerminal}. */
export function fakeTerminalFactory(options: SpawnOptions): Terminal {
  return new FakeTerminal(options);
}

/** Minimal local view of a node-pty `IPty` — full types ship with T-901. */
interface NativePty {
  onData(listener: (data: string) => void): void;
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/**
 * Load a real `node-pty`-backed {@link Terminal}. Rejects with a clear message
 * unless {@link PTY_ENABLE_ENV} is set AND the native module resolves — keeping
 * the native path off every default unit run. This is the visible T-901
 * boundary; the prebuild matrix + real-shell integration tests land with it.
 */
export async function loadNodePtyTerminal(options: SpawnOptions): Promise<Terminal> {
  if (!process.env[PTY_ENABLE_ENV]) {
    throw new Error(
      `Native PTY disabled. Set ${PTY_ENABLE_ENV}=1 to enable node-pty, or use FakeTerminal in tests.`,
    );
  }
  // Non-literal specifier so the type-checker does not resolve the absent
  // native package (same pattern as TransformersEmbedder in context/embedder.ts).
  const spec = 'node-pty';
  // The native surface is loosely typed on purpose — the real shapes ship with
  // the integration-gated T-901 binding, not the pure-core slice.
  let pty: { spawn: (file: string, args: string[], opts: Record<string, unknown>) => NativePty };
  try {
    pty = (await import(spec)) as unknown as typeof pty;
  } catch (cause) {
    throw new Error(`node-pty is not installed (native, off the default graph): ${String(cause)}`);
  }
  const proc = pty.spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    name: 'xterm-color',
  });
  return {
    onData: (listener) => proc.onData(listener),
    onExit: (listener) => proc.onExit((e) => listener({ exitCode: e.exitCode, signal: e.signal })),
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
  };
}
