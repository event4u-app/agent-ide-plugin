import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FakeTerminal } from '../terminal/pty.js';
import { TerminalSessionManager } from '../terminal/manager.js';
import {
  MAX_TAIL_CHARS,
  MAX_TAIL_LINES,
  RunShellTool,
  resolveCwdInside,
  type RunShellScheduler,
} from './run-shell.js';

const ROOT = '/ws';

/**
 * Start a command and hand back the manager + the Fake terminal the manager
 * created, so the test can drive output/exit. `run` does all manager
 * interaction synchronously inside the promise executor, so the session
 * already exists the instant `run` returns its promise.
 */
function startRun(
  args: Parameters<RunShellTool['run']>[0],
  opts?: { signal?: AbortSignal; scheduler?: RunShellScheduler },
): {
  manager: TerminalSessionManager;
  result: ReturnType<RunShellTool['run']>;
  fake: FakeTerminal;
  commandId: string;
} {
  const manager = new TerminalSessionManager();
  const tool = new RunShellTool({
    manager,
    workspaceRoot: ROOT,
    ...(opts?.scheduler ? { scheduler: opts.scheduler } : {}),
  });
  const result = tool.run(args, opts?.signal);
  const session = manager.list()[0]!;
  return { manager, result, fake: session.terminal as FakeTerminal, commandId: session.commandId };
}

describe('resolveCwdInside', () => {
  it('defaults to the workspace root', () => {
    expect(resolveCwdInside(ROOT)).toBe(ROOT);
  });

  it('resolves a relative path inside the root', () => {
    // Compare against the platform-native resolve (Windows uses a drive + `\`).
    expect(resolveCwdInside(ROOT, 'packages/core')).toBe(resolve(ROOT, 'packages/core'));
  });

  it('refuses a path that escapes the root', () => {
    expect(() => resolveCwdInside(ROOT, '../escape')).toThrow(/escapes the workspace root/);
  });
});

describe('RunShellTool.run', () => {
  it('streams output and resolves on a clean exit', async () => {
    const { result, fake } = startRun({ command: 'echo', args: ['hi'] });
    fake.emit('hello\n');
    fake.emit('world\n');
    fake.emitExit({ exitCode: 0 });
    const r = await result;
    expect(r.status).toBe('exited');
    expect(r.exitCode).toBe(0);
    expect(r.outputTail).toBe('hello\nworld');
    expect(r.truncated).toBe(false);
    expect(r.totalBytes).toBe('hello\nworld\n'.length);
  });

  it('reports a non-zero exit code (not ok)', async () => {
    const { result, fake } = startRun({ command: 'false' });
    fake.emitExit({ exitCode: 1 });
    const r = await result;
    expect(r.status).toBe('exited');
    expect(r.exitCode).toBe(1);
  });

  it('carries the terminating signal', async () => {
    const { result, fake } = startRun({ command: 'sleep' });
    fake.emitExit({ exitCode: 1, signal: 15 });
    const r = await result;
    expect(r.signal).toBe(15);
  });

  it('LEAVES a naturally-exited session in the manager (D1 scrollback)', async () => {
    const { manager, result, fake, commandId } = startRun({ command: 'echo' });
    fake.emitExit({ exitCode: 0 });
    await result;
    expect(manager.get(commandId)).toBeDefined();
    expect(manager.get(commandId)?.status).toBe('done');
  });

  it('fails fast and KILLS the session when the command waits for input (B1)', async () => {
    const { manager, result, fake, commandId } = startRun({
      command: 'apt',
      args: ['install', 'x'],
    });
    // Drive the manager into a confirmed waiting-for-input state.
    fake.emit('Do you want to continue? [Y/n] ');
    fake.emitReadIdle();
    manager.poll(commandId, 10_000);
    const r = await result;
    expect(r.status).toBe('needs-input');
    // Disposed → kill path; a later exit from the kill must not double-resolve.
    expect(manager.get(commandId)).toBeUndefined();
    expect(fake.killed).toBe(true);
  });

  it('settles exactly once when exit follows the input-kill', async () => {
    const { result, fake, manager, commandId } = startRun({ command: 'apt' });
    fake.emit('Continue? [Y/n] ');
    fake.emitReadIdle();
    manager.poll(commandId, 10_000);
    const r = await result;
    expect(r.status).toBe('needs-input');
    // The kill already emitted exit synchronously; emitting again would throw on
    // the Fake, proving the session was disposed and our guard held.
    expect(fake.exited).toBe(true);
  });

  it('aborts when the signal is already aborted before start', async () => {
    const controller = new AbortController();
    controller.abort();
    const manager = new TerminalSessionManager();
    const tool = new RunShellTool({ manager, workspaceRoot: ROOT });
    const r = await tool.run({ command: 'echo' }, controller.signal);
    expect(r.status).toBe('aborted');
    // The session was started then disposed synchronously on the aborted signal.
    expect(manager.list()).toHaveLength(0);
  });

  it('aborts mid-run and kills the session', async () => {
    const controller = new AbortController();
    const { manager, result, fake, commandId } = startRun(
      { command: 'sleep', args: ['100'] },
      { signal: controller.signal },
    );
    fake.emit('starting\n');
    controller.abort();
    const r = await result;
    expect(r.status).toBe('aborted');
    expect(r.outputTail).toBe('starting');
    expect(manager.get(commandId)).toBeUndefined();
  });

  it('times out via the injected scheduler and kills the session', async () => {
    let fire: (() => void) | undefined;
    const scheduler: RunShellScheduler = {
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
    };
    const { manager, result, commandId } = startRun(
      { command: 'sleep', args: ['100'], timeoutMs: 5_000 },
      { scheduler },
    );
    expect(fire).toBeDefined();
    fire!();
    const r = await result;
    expect(r.status).toBe('timeout');
    expect(manager.get(commandId)).toBeUndefined();
  });

  it('truncates the tail to the last MAX_TAIL_LINES lines', async () => {
    const { result, fake } = startRun({ command: 'seq' });
    for (let i = 0; i < MAX_TAIL_LINES + 50; i++) fake.emit(`line-${i}\n`);
    fake.emitExit({ exitCode: 0 });
    const r = await result;
    expect(r.truncated).toBe(true);
    const lines = r.outputTail.split('\n');
    expect(lines.length).toBe(MAX_TAIL_LINES);
    expect(lines.at(-1)).toBe(`line-${MAX_TAIL_LINES + 49}`);
    expect(lines[0]).toBe(`line-50`);
  });

  it('truncates the tail to the last MAX_TAIL_CHARS chars', async () => {
    const { result, fake } = startRun({ command: 'cat' });
    fake.emit('x'.repeat(MAX_TAIL_CHARS + 500));
    fake.emitExit({ exitCode: 0 });
    const r = await result;
    expect(r.truncated).toBe(true);
    expect(r.outputTail.length).toBe(MAX_TAIL_CHARS);
  });

  it('rejects a cwd that escapes the workspace root', async () => {
    const manager = new TerminalSessionManager();
    const tool = new RunShellTool({ manager, workspaceRoot: ROOT });
    expect(() => tool.run({ command: 'echo', cwd: '../../etc' })).toThrow(
      /escapes the workspace root/,
    );
    // No session was started.
    expect(manager.list()).toHaveLength(0);
  });
});
