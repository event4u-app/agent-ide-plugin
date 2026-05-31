import { afterEach, describe, expect, it } from 'vitest';
import { FakeTerminal, loadNodePtyTerminal, PTY_ENABLE_ENV } from './pty.js';

describe('FakeTerminal', () => {
  it('delivers emitted output to data listeners', () => {
    const term = new FakeTerminal();
    const seen: string[] = [];
    term.onData((d) => seen.push(d));
    term.emit('hello');
    term.emit('\x1b[32mworld\x1b[0m'); // split ANSI is fine — chunk-based
    expect(seen).toEqual(['hello', '\x1b[32mworld\x1b[0m']);
  });

  it('records writes and resizes', () => {
    const term = new FakeTerminal();
    term.write('y\n');
    term.resize(120, 40);
    expect(term.writes).toEqual(['y\n']);
    expect(term.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('delivers exactly one exit; a second emit throws', () => {
    const term = new FakeTerminal();
    const exits: number[] = [];
    term.onExit((e) => exits.push(e.exitCode));
    term.emitExit({ exitCode: 0 });
    expect(exits).toEqual([0]);
    expect(() => term.emitExit({ exitCode: 1 })).toThrow(/twice/);
  });

  it('tolerates output after exit (the real PTY race)', () => {
    const term = new FakeTerminal();
    const seen: string[] = [];
    term.onData((d) => seen.push(d));
    term.emitExit({ exitCode: 0 });
    term.emit('late chunk'); // must not throw
    expect(seen).toEqual(['late chunk']);
  });

  it('kill() emits exit once and is idempotent', () => {
    const term = new FakeTerminal();
    let exitCount = 0;
    term.onExit(() => exitCount++);
    term.kill('SIGTERM');
    term.kill('SIGKILL'); // already killed → no second exit
    expect(term.killed).toBe(true);
    expect(exitCount).toBe(1);
  });

  it('read-idle hook fires listeners', () => {
    const term = new FakeTerminal();
    let idle = 0;
    term.onReadIdle(() => idle++);
    term.emitReadIdle();
    expect(idle).toBe(1);
  });
});

describe('loadNodePtyTerminal (T-901 boundary)', () => {
  const original = process.env[PTY_ENABLE_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[PTY_ENABLE_ENV];
    else process.env[PTY_ENABLE_ENV] = original;
  });

  it('rejects with a clear message when the native PTY is disabled', async () => {
    delete process.env[PTY_ENABLE_ENV];
    await expect(loadNodePtyTerminal({ command: 'echo' })).rejects.toThrow(/Native PTY disabled/);
  });

  it('rejects when node-pty is not installed even with the flag set', async () => {
    process.env[PTY_ENABLE_ENV] = '1';
    await expect(loadNodePtyTerminal({ command: 'echo' })).rejects.toThrow(
      /node-pty is not installed/,
    );
  });
});
