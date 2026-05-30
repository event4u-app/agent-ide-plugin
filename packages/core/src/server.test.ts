import { describe, expect, it } from 'vitest';
import type { Envelope } from '@event4u-agent/protocol';
import { NdjsonParser, encodeEnvelope } from '@event4u-agent/shared';
import { Dispatcher } from './server.js';
import { WorkspaceCoordinator, type RootWalker } from './context/workspace-coordinator.js';
import type { RootRegistry } from './context/roots.js';

const request = (messageType: string, data: unknown, messageId = 'r1'): Envelope => ({
  messageId,
  messageType,
  data,
  done: true,
});

describe('Dispatcher', () => {
  const dispatcher = new Dispatcher();

  it('answers ping with pong, preserving messageId', async () => {
    const res = await dispatcher.dispatch(request('ping', {}, 'p42'));
    expect(res.messageId).toBe('p42');
    expect(res.messageType).toBe('ping');
    expect(res.data).toEqual({ result: 'pong' });
    expect(res.done).toBe(true);
  });

  it('echoes the request text', async () => {
    const res = await dispatcher.dispatch(request('echo', { text: 'hi there' }));
    expect(res.data).toEqual({ text: 'hi there' });
  });

  it('returns an error envelope for an unknown method', async () => {
    const res = await dispatcher.dispatch(request('frobnicate', {}));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'unknown_method' });
  });

  it('returns an error envelope when echo payload is invalid', async () => {
    const res = await dispatcher.dispatch(request('echo', { text: 123 }));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'handler_error' });
  });
});

describe('Dispatcher — multi-project methods (T-MR11)', () => {
  function makeDispatcher(): { dispatcher: Dispatcher; coordinator: WorkspaceCoordinator } {
    const coordinator = new WorkspaceCoordinator({
      debounceMs: 0,
      readFile: async () => 'export const x = 1;\n',
      walkerFactory: (registry: RootRegistry): RootWalker => ({
        async walk() {
          return registry.walkable().map((r) => ({ rootId: r.stableId, path: 'src/index.ts' }));
        },
      }),
    });
    return { dispatcher: new Dispatcher(coordinator), coordinator };
  }

  const wsFolder = (stableId: string) => ({
    uri: `/repo/${stableId}`,
    stableId,
    displayName: stableId,
    kind: 'folder',
  });

  it('connect acks with resolved roots and per-root status', async () => {
    const { dispatcher } = makeDispatcher();
    const res = await dispatcher.dispatch(
      request('connect', { workspaceFolders: [wsFolder('A'), wsFolder('B')] }, 'c1'),
    );
    expect(res.messageId).toBe('c1');
    expect(res.data).toMatchObject({ ack: true });
    const data = res.data as { roots: unknown[]; status: { stableId: string }[] };
    expect(data.roots).toHaveLength(2);
    expect(data.status.map((s) => s.stableId).sort()).toEqual(['A', 'B']);
  });

  it('rootStatus reports ready once indexing settles', async () => {
    const { dispatcher, coordinator } = makeDispatcher();
    await dispatcher.dispatch(request('connect', { workspaceFolders: [wsFolder('A')] }, 'c2'));
    await coordinator.whenIdle();

    const res = await dispatcher.dispatch(request('rootStatus', {}, 's1'));
    const data = res.data as { status: { stableId: string; state: string; fileCount: number }[] };
    expect(data.status).toEqual([
      { stableId: 'A', state: 'ready', fileCount: 1, totalFiles: 1, message: null },
    ]);
  });

  it('workspaceFoldersChanged acks a removal delta', async () => {
    const { dispatcher } = makeDispatcher();
    await dispatcher.dispatch(
      request('connect', { workspaceFolders: [wsFolder('A'), wsFolder('B')] }),
    );
    const res = await dispatcher.dispatch(
      request('workspaceFoldersChanged', { removed: ['B'] }, 'd1'),
    );
    expect(res.data).toMatchObject({ ack: true });
    const data = res.data as { status: { stableId: string }[] };
    expect(data.status.map((s) => s.stableId)).toEqual(['A']);
  });

  it('connect defaults an omitted folder list to the empty single-root fallback', async () => {
    const { dispatcher } = makeDispatcher();
    const res = await dispatcher.dispatch(request('connect', {}, 'c3'));
    expect(res.data).toMatchObject({ ack: true, roots: [], status: [] });
  });
});

describe('full wire round-trip (encode -> parse -> dispatch)', () => {
  it('processes a serialized request through the parser', async () => {
    const dispatcher = new Dispatcher();
    const parsed: Envelope[] = [];
    const parser = new NdjsonParser((e) => parsed.push(e));

    parser.push(encodeEnvelope(request('echo', { text: 'wire' }, 'w1')));
    expect(parsed).toHaveLength(1);

    const res = await dispatcher.dispatch(parsed[0]!);
    expect(res.messageId).toBe('w1');
    expect(res.data).toEqual({ text: 'wire' });
  });
});
