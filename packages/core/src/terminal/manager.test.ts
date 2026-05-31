import { describe, expect, it } from 'vitest';
import { type FakeTerminal, fakeTerminalFactory } from './pty.js';
import { TerminalSessionManager, type TerminalManagerOptions } from './manager.js';
import type { SpawnOptions, TerminalEvent } from './types.js';

/** A manager wired with a deterministic clock + id factory and a capturable PTY. */
function makeManager(overrides: Partial<TerminalManagerOptions> = {}) {
  const terminals: FakeTerminal[] = [];
  let idN = 0;
  let ms = 0;
  const mgr = new TerminalSessionManager({
    terminalFactory: (opts: SpawnOptions) => {
      const t = fakeTerminalFactory(opts) as FakeTerminal;
      terminals.push(t);
      return t;
    },
    now: () => new Date(Date.parse('2026-01-01T00:00:00Z') + idN * 1000).toISOString(),
    nowMs: () => ms,
    idFactory: () => `id-${++idN}`,
    waiting: { idleMs: 800 },
    ...overrides,
  });
  return {
    mgr,
    terminals,
    setMs: (v: number) => {
      ms = v;
    },
  };
}

describe('TerminalSessionManager — lifecycle', () => {
  it('starts a running session with a generated commandId', () => {
    const { mgr, terminals } = makeManager();
    const s = mgr.start({ command: 'git', args: ['status'] });
    expect(s.status).toBe('running');
    expect(s.commandId).toBe('id-1');
    expect(terminals).toHaveLength(1);
  });

  it('rejects a duplicate commandId', () => {
    const { mgr } = makeManager();
    mgr.start({ command: 'echo', commandId: 'c1' });
    expect(() => mgr.start({ command: 'echo', commandId: 'c1' })).toThrow(/already exists/);
  });

  it('buffers output and broadcasts output events to subscribers', () => {
    const { mgr, terminals } = makeManager();
    const s = mgr.start({ command: 'echo', commandId: 'c1' });
    const events: TerminalEvent[] = [];
    mgr.subscribe({ commandId: 'c1', surfaceId: 'chat', deliver: (e) => events.push(e) });
    terminals[0].emit('hello\n');
    expect(s.buffer.snapshot().chunks.map((c) => c.data)).toEqual(['hello\n']);
    expect(events).toEqual([{ kind: 'output', commandId: 'c1', chunk: expect.any(Object) }]);
  });

  it('marks done on exit and broadcasts status + exit with durationMs', () => {
    const { mgr, terminals, setMs } = makeManager();
    mgr.start({ command: 'echo', commandId: 'c1' });
    const events: TerminalEvent[] = [];
    mgr.subscribe({ commandId: 'c1', surfaceId: 'chat', deliver: (e) => events.push(e) });
    setMs(4200);
    terminals[0].emitExit({ exitCode: 0 });
    const s = mgr.get('c1');
    expect(s?.status).toBe('done');
    expect(s?.exitCode).toBe(0);
    const exit = events.find((e) => e.kind === 'exit');
    expect(exit).toMatchObject({ kind: 'exit', exitCode: 0, durationMs: 4200 });
  });

  it('output after exit is buffered but never re-opens a done session', () => {
    const { mgr, terminals } = makeManager();
    const s = mgr.start({ command: 'echo', commandId: 'c1' });
    terminals[0].emitExit({ exitCode: 0 });
    terminals[0].emit('late\n');
    expect(s.status).toBe('done');
    expect(s.buffer.snapshot().chunks.map((c) => c.data)).toEqual(['late\n']);
  });
});

describe('TerminalSessionManager — waiting for input', () => {
  it('confirms waiting-input via idle and emits inputRequested', () => {
    const { mgr, terminals, setMs } = makeManager();
    const s = mgr.start({ command: 'setup', commandId: 'c1' });
    const events: TerminalEvent[] = [];
    mgr.subscribe({ commandId: 'c1', surfaceId: 'chat', deliver: (e) => events.push(e) });

    setMs(0);
    terminals[0].emit('Password: '); // tentative
    expect(s.status).toBe('running');
    setMs(800);
    mgr.poll('c1'); // idle confirms
    expect(s.status).toBe('waiting-input');
    expect(s.pendingInput?.prompt).toBe('Password:');
    expect(events.some((e) => e.kind === 'inputRequested')).toBe(true);
    expect(events.some((e) => e.kind === 'status' && e.status === 'waiting-input')).toBe(true);
  });

  it('withdraws the pending request when output resumes before an answer', () => {
    const { mgr, terminals, setMs } = makeManager();
    const s = mgr.start({ command: 'setup', commandId: 'c1' });
    terminals[0].emit('Password: ');
    setMs(800);
    mgr.poll('c1');
    expect(s.status).toBe('waiting-input');
    terminals[0].emit('Authenticated, continuing'); // resumed
    expect(s.status).toBe('running');
    expect(s.pendingInput).toBeNull();
  });
});

describe('TerminalSessionManager — input arbitration (first-write-wins)', () => {
  function arriveAtPendingInput() {
    const ctx = makeManager();
    ctx.mgr.start({ command: 'setup', commandId: 'c1' });
    ctx.terminals[0].emit('Continue? (y/n) ');
    ctx.setMs(800);
    ctx.mgr.poll('c1');
    return ctx;
  }

  it('first surface to answer the pending request wins and writes to the PTY', () => {
    const { mgr, terminals } = arriveAtPendingInput();
    const reqId = mgr.get('c1')!.pendingInput!.inputRequestId;
    const res = mgr.write({
      commandId: 'c1',
      surfaceId: 'chat',
      data: 'y\n',
      inputRequestId: reqId,
    });
    expect(res.accepted).toBe(true);
    expect(terminals[0].writes).toEqual(['y\n']);
    expect(mgr.get('c1')?.status).toBe('running');
    expect(mgr.get('c1')?.pendingInput).toBeNull();
  });

  it('second surface answering the same request loses and gets a conflict event', () => {
    const { mgr } = arriveAtPendingInput();
    const reqId = mgr.get('c1')!.pendingInput!.inputRequestId;
    const events: TerminalEvent[] = [];
    mgr.subscribe({ commandId: 'c1', surfaceId: 'ide', deliver: (e) => events.push(e) });

    mgr.write({ commandId: 'c1', surfaceId: 'chat', data: 'y\n', inputRequestId: reqId });
    const res = mgr.write({
      commandId: 'c1',
      surfaceId: 'ide',
      data: 'n\n',
      inputRequestId: reqId,
    });

    expect(res).toEqual({
      accepted: false,
      reason: 'already-submitted',
      winningSurfaceId: 'chat',
    });
    expect(events).toContainEqual({
      kind: 'inputConflict',
      commandId: 'c1',
      inputRequestId: reqId,
      winningSurfaceId: 'chat',
      losingSurfaceId: 'ide',
    });
  });

  it('rejects writes to a finished session', () => {
    const { mgr, terminals } = makeManager();
    mgr.start({ command: 'echo', commandId: 'c1' });
    terminals[0].emitExit({ exitCode: 0 });
    expect(mgr.write({ commandId: 'c1', surfaceId: 'chat', data: 'x' })).toEqual({
      accepted: false,
      reason: 'session-done',
    });
  });

  it('rejects writes to an unknown session', () => {
    const { mgr } = makeManager();
    expect(mgr.write({ commandId: 'nope', surfaceId: 'chat', data: 'x' })).toEqual({
      accepted: false,
      reason: 'no-session',
    });
  });

  it('raw writes (no inputRequestId) are accepted and serialised', () => {
    const { mgr, terminals } = makeManager();
    mgr.start({ command: 'python', commandId: 'c1' });
    mgr.write({ commandId: 'c1', surfaceId: 'chat', data: 'print(1)\n' });
    mgr.write({ commandId: 'c1', surfaceId: 'chat', data: 'print(2)\n' });
    expect(terminals[0].writes).toEqual(['print(1)\n', 'print(2)\n']);
  });
});

describe('TerminalSessionManager — subscribe / reconnect', () => {
  it('atomically replays the buffer then attaches for live delivery', () => {
    const { mgr, terminals } = makeManager();
    mgr.start({ command: 'echo', commandId: 'c1' });
    terminals[0].emit('a\n');
    terminals[0].emit('b\n');
    const live: TerminalEvent[] = [];
    const result = mgr.subscribe({
      commandId: 'c1',
      surfaceId: 'chat',
      deliver: (e) => live.push(e),
    });
    expect(result?.replay.chunks.map((c) => c.data)).toEqual(['a\n', 'b\n']);
    expect(result?.status).toBe('running');
    terminals[0].emit('c\n'); // live, after attach
    expect(live).toEqual([{ kind: 'output', commandId: 'c1', chunk: expect.any(Object) }]);
  });

  it('replays from a given seq and flags restartRequired when it was evicted', () => {
    const { mgr, terminals } = makeManager({ ringBuffer: { maxLines: 2 } });
    mgr.start({ command: 'echo', commandId: 'c1' });
    terminals[0].emit('a\n');
    terminals[0].emit('b\n');
    terminals[0].emit('c\n'); // evicts seq 0
    const result = mgr.subscribe({
      commandId: 'c1',
      surfaceId: 'chat',
      replayFromSeq: 0,
      deliver: () => {},
    });
    expect(result?.replay.restartRequired).toBe(true);
    expect(result?.replay.chunks.map((c) => c.data)).toEqual(['b\n', 'c\n']);
  });

  it('unsubscribe detaches without killing the PTY', () => {
    const { mgr, terminals } = makeManager();
    const s = mgr.start({ command: 'echo', commandId: 'c1' });
    const sub = mgr.subscribe({ commandId: 'c1', surfaceId: 'chat', deliver: () => {} })!;
    expect(mgr.unsubscribe('c1', sub.subscriptionId)).toBe(true);
    expect(terminals[0].killed).toBe(false);
    expect(s.status).toBe('running');
  });

  it('a faulty subscriber is dropped without breaking the fan-out', () => {
    const { mgr, terminals } = makeManager();
    mgr.start({ command: 'echo', commandId: 'c1' });
    const good: TerminalEvent[] = [];
    mgr.subscribe({
      commandId: 'c1',
      surfaceId: 'bad',
      deliver: () => {
        throw new Error('renderer crashed');
      },
    });
    mgr.subscribe({ commandId: 'c1', surfaceId: 'good', deliver: (e) => good.push(e) });
    terminals[0].emit('x\n');
    expect(good).toHaveLength(1);
    expect(mgr.get('c1')?.subscribers.size).toBe(1); // bad one dropped
  });
});

describe('TerminalSessionManager — resize / dispose', () => {
  it('resize forwards to the PTY for a live session', () => {
    const { mgr, terminals } = makeManager();
    mgr.start({ command: 'vim', commandId: 'c1' });
    expect(mgr.resize('c1', 100, 30)).toBe(true);
    expect(terminals[0].resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('dispose kills a running PTY and forgets the session', () => {
    const { mgr, terminals } = makeManager();
    mgr.start({ command: 'sleep', commandId: 'c1' });
    expect(mgr.dispose('c1')).toBe(true);
    expect(terminals[0].killed).toBe(true);
    expect(mgr.get('c1')).toBeUndefined();
  });

  it('disposeAll clears every session', () => {
    const { mgr } = makeManager();
    mgr.start({ command: 'a', commandId: 'c1' });
    mgr.start({ command: 'b', commandId: 'c2' });
    mgr.disposeAll();
    expect(mgr.list()).toHaveLength(0);
  });
});
