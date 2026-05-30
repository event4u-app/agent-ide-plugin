import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { join } from 'node:path';

/**
 * T-1106 — lifecycle hook runner.
 *
 * Mirrors agent-config's hook contract: shell scripts under
 * `agents/runtime/hooks/` fire at session lifecycle points, receive
 * environment variables, and signal via exit code — `0` = ok, `2` = block
 * (the agent should halt the lifecycle step), any other non-zero = error. A
 * missing script is a silent no-op so consumers opt in by simply creating the
 * file.
 *
 * The process spawn is an injectable seam ({@link ProcessRunner}) so unit
 * tests run deterministically without a real shell — important because the CI
 * matrix includes Windows, which has no `bash` on PATH.
 */

export type HookName = 'sessionStart' | 'sessionEnd' | 'Stop';

export const HOOK_NAMES: readonly HookName[] = ['sessionStart', 'sessionEnd', 'Stop'];

export type HookDecision = 'ok' | 'block' | 'error' | 'skipped';

export interface HookOutcome {
  name: HookName;
  /** False when no script existed (no-op). */
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  decision: HookDecision;
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number },
) => Promise<ProcessResult>;

export interface RunHookOptions {
  /** Directory holding the hook scripts. Defaults to `<cwd>/agents/runtime/hooks`. */
  hooksDir?: string;
  /** Working directory for the hook. */
  cwd?: string;
  /** Extra environment, merged over `process.env` and the hook marker. */
  env?: Record<string, string>;
  /** Optional stdin payload (agent-config passes a JSON envelope on some hooks). */
  input?: string;
  /** Kill the hook after this many ms. Default 10s. */
  timeoutMs?: number;
  /** Override the spawn for tests. */
  runner?: ProcessRunner;
  /** Override the existence check for tests. */
  exists?: (path: string) => Promise<boolean>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function defaultHooksDir(cwd: string): string {
  return join(cwd, 'agents', 'runtime', 'hooks');
}

/** Run one lifecycle hook. Never throws — a failure is reported as `error`. */
export async function runHook(name: HookName, opts: RunHookOptions = {}): Promise<HookOutcome> {
  const cwd = opts.cwd ?? process.cwd();
  const hooksDir = opts.hooksDir ?? defaultHooksDir(cwd);
  const scriptPath = join(hooksDir, `${name}.sh`);
  const exists = opts.exists ?? fileExists;

  if (!(await exists(scriptPath))) {
    return { name, ran: false, exitCode: null, stdout: '', stderr: '', decision: 'skipped' };
  }

  const env = {
    ...process.env,
    ...opts.env,
    EVENT4U_AGENT_HOOK: name,
  } as Record<string, string>;
  const runner = opts.runner ?? nodeProcessRunner;

  try {
    const result = await runner('bash', [scriptPath], {
      cwd,
      env,
      input: opts.input,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return {
      name,
      ran: true,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      decision: classify(result),
    };
  } catch (err) {
    return {
      name,
      ran: true,
      exitCode: null,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      decision: 'error',
    };
  }
}

function classify(result: ProcessResult): HookDecision {
  if (result.timedOut) return 'error';
  if (result.code === 0) return 'ok';
  if (result.code === 2) return 'block';
  return 'error';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Default {@link ProcessRunner} backed by `child_process.spawn`. */
export const nodeProcessRunner: ProcessRunner = (command, args, opts) =>
  new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
