import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOOK_NAMES,
  defaultHooksDir,
  nodeProcessRunner,
  runHook,
  type ProcessRunner,
} from './runner.js';

describe('runHook (injected runner)', () => {
  const fakeExists = (present: boolean) => async (): Promise<boolean> => present;

  it('skips (no-op) when the script does not exist', async () => {
    const outcome = await runHook('sessionStart', { exists: fakeExists(false) });
    expect(outcome).toMatchObject({ ran: false, decision: 'skipped', exitCode: null });
  });

  it('classifies exit 0 as ok and passes the hook-name env marker', async () => {
    let capturedEnv: Record<string, string> | undefined;
    const runner: ProcessRunner = async (_cmd, _args, opts) => {
      capturedEnv = opts.env;
      return { code: 0, stdout: 'done', stderr: '', timedOut: false };
    };
    const outcome = await runHook('sessionStart', { exists: fakeExists(true), runner });
    expect(outcome.decision).toBe('ok');
    expect(outcome.stdout).toBe('done');
    expect(capturedEnv?.EVENT4U_AGENT_HOOK).toBe('sessionStart');
  });

  it('classifies exit 2 as block', async () => {
    const runner: ProcessRunner = async () => ({
      code: 2,
      stdout: '',
      stderr: 'no',
      timedOut: false,
    });
    const outcome = await runHook('Stop', { exists: fakeExists(true), runner });
    expect(outcome.decision).toBe('block');
  });

  it('classifies other non-zero exits and timeouts as error', async () => {
    const fail: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: '', timedOut: false });
    const timeout: ProcessRunner = async () => ({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    });
    expect((await runHook('Stop', { exists: fakeExists(true), runner: fail })).decision).toBe(
      'error',
    );
    expect((await runHook('Stop', { exists: fakeExists(true), runner: timeout })).decision).toBe(
      'error',
    );
  });

  it('reports a spawn error as error without throwing', async () => {
    const runner: ProcessRunner = async () => {
      throw new Error('ENOENT bash');
    };
    const outcome = await runHook('sessionEnd', { exists: fakeExists(true), runner });
    expect(outcome.decision).toBe('error');
    expect(outcome.stderr).toMatch(/ENOENT/);
  });

  it('defaultHooksDir points at agents/runtime/hooks', () => {
    expect(defaultHooksDir('/repo')).toBe(join('/repo', 'agents', 'runtime', 'hooks'));
  });

  it('lists the three lifecycle hooks', () => {
    expect(HOOK_NAMES).toEqual(['sessionStart', 'sessionEnd', 'Stop']);
  });
});

// Real-bash integration — POSIX only (Windows CI has no bash on PATH).
describe.skipIf(process.platform === 'win32')('runHook (real bash)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-hooks-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a real sessionStart script and captures stdout + the env marker', async () => {
    const script = join(dir, 'sessionStart.sh');
    await writeFile(
      script,
      '#!/usr/bin/env bash\necho "hook=$EVENT4U_AGENT_HOOK"\nexit 0\n',
      'utf8',
    );
    await chmod(script, 0o755);
    const outcome = await runHook('sessionStart', { hooksDir: dir, runner: nodeProcessRunner });
    expect(outcome.decision).toBe('ok');
    expect(outcome.stdout).toContain('hook=sessionStart');
  });

  it('maps a real exit 2 to block', async () => {
    const script = join(dir, 'Stop.sh');
    await writeFile(script, '#!/usr/bin/env bash\nexit 2\n', 'utf8');
    await chmod(script, 0o755);
    const outcome = await runHook('Stop', { hooksDir: dir, runner: nodeProcessRunner });
    expect(outcome.decision).toBe('block');
    expect(outcome.exitCode).toBe(2);
  });
});
