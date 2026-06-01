import { describe, expect, it } from 'vitest';
import type { Envelope, TerminalEvent } from '@event4u-agent/protocol';
import { WorkspaceCoordinator } from '../context/workspace-coordinator.js';
import { Dispatcher } from '../server.js';
import { type FakeTerminal, fakeTerminalFactory } from './pty.js';
import { TerminalHandler, TerminalRequestError } from './handler.js';
import { TerminalSessionManager } from './manager.js';
import type { SpawnOptions } from './types.js';

/** Manager wired with a capturable PTY + deterministic clock/ids, plus a handler. */
function makeCtx() {
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
  });
  const handler = new TerminalHandler({ manager: mgr });
  const sent: Envelope[] = [];
  const sink = (e: Envelope): void => {
    sent.push(e);
  };
  return {
    mgr,
    handler,
    terminals,
    sent,
    sink,
    setMs: (v: number) => {
      ms = v;
    },
  };
}

/** Narrow an envelope's `data` to a wire TerminalEvent for assertions. */
const evt = (e: Envelope): TerminalEvent => e.data as TerminalEvent;

describe('TerminalHandler — subscribe streaming', () => {
  it('emits the replay+state response first, then live events, and exit as the terminal done:true', async () => {
    const { mgr, handler, terminals, sent, sink, setMs } = makeCtx();
    mgr.start({ command: 'echo', commandId: 'c1' });
    terminals[0]!.emit('a\n');
    terminals[0]!.emit('b\n');

    const pending = handler.handleSubscribe(
      'm1',
      { commandId: 'c1', surfaceId: 'chat', replayFromSeq: 0 },
      sink,
    );

    // First envelope: the replay + current state (C1), done:false, before any live event.
    expect(sent[0]).toMatchObject({
      messageId: 'm1',
      messageType: 'terminalSubscribe',
      done: false,
    });
    const first = sent[0]!.data as {
      subscriptionId: string;
      status: string;
      replay: { chunks: { data: string }[] };
    };
    expect(first.status).toBe('running');
    expect(first.subscriptionId).toMatch(/^id-/);
    expect(first.replay.chunks.map((c) => c.data)).toEqual(['a\n', 'b\n']);

    // Live output flows as done:false.
    terminals[0]!.emit('c\n');
    expect(sent.some((e) => !e.done && evt(e).kind === 'output')).toBe(true);

    // Exit closes the stream as the terminal done:true — and is NEVER also a done:false event.
    setMs(4200);
    terminals[0]!.emitExit({ exitCode: 0 });
    const terminal = await pending;
    expect(terminal).toMatchObject({ messageId: 'm1', done: true });
    expect(evt(terminal)).toMatchObject({
      kind: 'exit',
      commandId: 'c1',
      exitCode: 0,
      durationMs: 4200,
    });
    expect(sent.some((e) => evt(e).kind === 'exit')).toBe(false);
    // The intermediate `status:done` IS a normal done:false event.
    expect(sent.some((e) => !e.done && evt(e).kind === 'status')).toBe(true);
  });

  it('resolves immediately with a synthesized exit for an already-done session', async () => {
    const { mgr, handler, terminals, sent, sink } = makeCtx();
    mgr.start({ command: 'echo', commandId: 'c1' });
    terminals[0]!.emitExit({ exitCode: 3 }); // exits BEFORE any subscriber attaches

    const terminal = await handler.handleSubscribe(
      'm2',
      { commandId: 'c1', surfaceId: 'ide', replayFromSeq: 0 },
      sink,
    );

    // The replay response still goes first, reporting the done status.
    expect((sent[0]!.data as { status: string }).status).toBe('done');
    // Then a synthesized exit closes the stream.
    expect(terminal.done).toBe(true);
    const exit = evt(terminal);
    expect(exit).toMatchObject({ kind: 'exit', commandId: 'c1', exitCode: 3 });
    expect((exit as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes intermediate events through without terminating on a non-exit event', async () => {
    const { mgr, handler, terminals, sent, sink, setMs } = makeCtx();
    mgr.start({ command: 'setup', commandId: 'c1' });
    const pending = handler.handleSubscribe(
      'm3',
      { commandId: 'c1', surfaceId: 'chat', replayFromSeq: 0 },
      sink,
    );
    terminals[0]!.emit('Password: ');
    setMs(800);
    mgr.poll('c1');
    // inputRequested streamed as done:false; the stream is still OPEN (resolves only on exit).
    expect(sent.some((e) => !e.done && evt(e).kind === 'inputRequested')).toBe(true);

    terminals[0]!.emitExit({ exitCode: 0 });
    const terminal = await pending;
    expect(evt(terminal).kind).toBe('exit'); // not 'inputRequested' — only exit terminates
  });

  it('a throwing sink never drops the subscriber before the exit terminal', async () => {
    const { mgr, handler, terminals } = makeCtx();
    mgr.start({ command: 'echo', commandId: 'c1' });
    const throwingSink = (e: Envelope): void => {
      if (!e.done && evt(e).kind === 'output') throw new Error('renderer crashed');
    };
    const pending = handler.handleSubscribe(
      'm4',
      { commandId: 'c1', surfaceId: 'chat', replayFromSeq: 0 },
      throwingSink,
    );
    terminals[0]!.emit('boom\n'); // the sink throws, but our deliver swallows it
    expect(mgr.get('c1')?.subscribers.size).toBe(1); // NOT dropped by the backpressure floor
    terminals[0]!.emitExit({ exitCode: 0 });
    await expect(pending).resolves.toMatchObject({ done: true });
  });

  it('throws terminal_no_session for an unknown commandId', () => {
    const { handler, sink } = makeCtx();
    let caught: unknown;
    try {
      handler.handleSubscribe(
        'm5',
        { commandId: 'nope', surfaceId: 'chat', replayFromSeq: 0 },
        sink,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TerminalRequestError);
    expect((caught as TerminalRequestError).code).toBe('terminal_no_session');
  });
});

describe('TerminalHandler — input', () => {
  function arriveAtPendingInput() {
    const ctx = makeCtx();
    ctx.mgr.start({ command: 'setup', commandId: 'c1' });
    ctx.terminals[0]!.emit('Continue? (y/n) ');
    ctx.setMs(800);
    ctx.mgr.poll('c1');
    return ctx;
  }

  it('first surface to answer the pending request wins; the second loses with the winner', () => {
    const { mgr, handler, terminals } = arriveAtPendingInput();
    const inputRequestId = mgr.get('c1')!.pendingInput!.inputRequestId;
    expect(
      handler.handleInput({ commandId: 'c1', surfaceId: 'chat', data: 'y\n', inputRequestId }),
    ).toEqual({
      accepted: true,
    });
    expect(terminals[0]!.writes).toEqual(['y\n']);
    expect(
      handler.handleInput({ commandId: 'c1', surfaceId: 'ide', data: 'n\n', inputRequestId }),
    ).toEqual({
      accepted: false,
      reason: 'already-submitted',
      winningSurfaceId: 'chat',
    });
  });

  it('accepts a raw write (no inputRequestId)', () => {
    const { mgr, handler, terminals } = makeCtx();
    mgr.start({ command: 'python', commandId: 'c1' });
    expect(handler.handleInput({ commandId: 'c1', surfaceId: 'chat', data: 'print(1)\n' })).toEqual(
      {
        accepted: true,
      },
    );
    expect(terminals[0]!.writes).toEqual(['print(1)\n']);
  });

  it('rejects a write to an unknown session', () => {
    const { handler } = makeCtx();
    expect(handler.handleInput({ commandId: 'nope', surfaceId: 'chat', data: 'x' })).toEqual({
      accepted: false,
      reason: 'no-session',
    });
  });
});

describe('TerminalHandler — resize / dispose', () => {
  it('acks a resize for a live session and forwards it to the PTY', () => {
    const { mgr, handler, terminals } = makeCtx();
    mgr.start({ command: 'vim', commandId: 'c1' });
    expect(handler.handleResize({ commandId: 'c1', cols: 100, rows: 30 })).toEqual({ ack: true });
    expect(terminals[0]!.resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('does not ack a resize for an unknown session', () => {
    const { handler } = makeCtx();
    expect(handler.handleResize({ commandId: 'nope', cols: 80, rows: 24 })).toEqual({ ack: false });
  });

  it('dispose() releases every live session', () => {
    const { mgr, handler, terminals } = makeCtx();
    mgr.start({ command: 'a', commandId: 'c1' });
    mgr.start({ command: 'b', commandId: 'c2' });
    handler.dispose();
    expect(mgr.list()).toHaveLength(0);
    expect(terminals.every((t) => t.killed)).toBe(true);
  });
});

describe('Dispatcher — terminal routing', () => {
  const request = (messageType: string, data: unknown, messageId = 'r1'): Envelope => ({
    messageId,
    messageType,
    data,
    done: true,
  });

  function terminalDispatcher() {
    const mgr = new TerminalSessionManager();
    const handler = new TerminalHandler({ manager: mgr });
    const dispatcher = new Dispatcher(
      new WorkspaceCoordinator(),
      undefined,
      undefined,
      undefined,
      handler,
    );
    return { dispatcher, mgr };
  }

  it('routes terminalResize to the handler', async () => {
    const { dispatcher, mgr } = terminalDispatcher();
    mgr.start({ command: 'vim', commandId: 'c1' });
    const res = await dispatcher.dispatch(
      request('terminalResize', { commandId: 'c1', cols: 90, rows: 24 }, 't1'),
    );
    expect(res.messageType).toBe('terminalResize');
    expect(res.messageId).toBe('t1');
    expect(res.data).toEqual({ ack: true });
  });

  it('routes terminalInput to the handler (no-session reason)', async () => {
    const { dispatcher } = terminalDispatcher();
    const res = await dispatcher.dispatch(
      request('terminalInput', { commandId: 'nope', surfaceId: 'chat', data: 'x' }),
    );
    expect(res.data).toEqual({ accepted: false, reason: 'no-session' });
  });

  it('streams a terminalSubscribe turn and returns the exit terminal envelope', async () => {
    const mgr = new TerminalSessionManager();
    const session = mgr.start({ command: 'echo', commandId: 'c1' });
    const handler = new TerminalHandler({ manager: mgr });
    const dispatcher = new Dispatcher(
      new WorkspaceCoordinator(),
      undefined,
      undefined,
      undefined,
      handler,
    );
    const streamed: Envelope[] = [];

    const pending = dispatcher.dispatch(
      request('terminalSubscribe', { commandId: 'c1', surfaceId: 'chat', replayFromSeq: 0 }, 's1'),
      (e) => streamed.push(e),
    );
    // Drive the live terminal to exit.
    (session.terminal as FakeTerminal).emit('done\n');
    (session.terminal as FakeTerminal).emitExit({ exitCode: 0 });

    const terminal = await pending;
    expect(terminal).toMatchObject({
      messageId: 's1',
      messageType: 'terminalSubscribe',
      done: true,
    });
    expect((terminal.data as TerminalEvent).kind).toBe('exit');
    expect(streamed[0]!.done).toBe(false); // the replay response streamed first
    expect(streamed.some((e) => (e.data as TerminalEvent).kind === 'exit')).toBe(false);
  });

  it('returns terminal_not_configured when no terminal handler is wired', async () => {
    const dispatcher = new Dispatcher();
    const res = await dispatcher.dispatch(
      request('terminalResize', { commandId: 'c1', cols: 80, rows: 24 }),
    );
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'terminal_not_configured' });
  });

  it('returns terminal_not_configured for terminalSubscribe with no handler', async () => {
    const dispatcher = new Dispatcher();
    const res = await dispatcher.dispatch(
      request('terminalSubscribe', { commandId: 'c1', surfaceId: 'chat' }),
    );
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'terminal_not_configured' });
  });
});
