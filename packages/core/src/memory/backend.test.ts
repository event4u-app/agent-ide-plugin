import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalMemoryBackend,
  RoutingMemoryBackend,
  filterRecords,
  parseMcpRecords,
  type MemoryBackend,
} from './backend.js';
import { LocalMemoryStore, type MemoryRecord } from './local.js';

function rec(name: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  return { name, description: name, type: 'user', body: name, ...over };
}

describe('filterRecords', () => {
  const all = [
    rec('auth-pref', { description: 'login flow', type: 'feedback' }),
    rec('tabs', { description: 'indent', body: 'tabs not spaces' }),
    rec('db', { description: 'database', type: 'project' }),
  ];

  it('filters by case-insensitive substring across fields', () => {
    expect(filterRecords(all, { query: 'LOGIN' }).map((r) => r.name)).toEqual(['auth-pref']);
    expect(filterRecords(all, { query: 'spaces' }).map((r) => r.name)).toEqual(['tabs']);
  });

  it('filters by type and applies a limit', () => {
    expect(filterRecords(all, { types: ['project'] }).map((r) => r.name)).toEqual(['db']);
    expect(filterRecords(all, { limit: 2 })).toHaveLength(2);
  });
});

describe('parseMcpRecords', () => {
  it('parses a bare JSON array', () => {
    const out = parseMcpRecords('[{"name":"a","description":"d"}]');
    expect(out).toEqual([{ name: 'a', description: 'd', type: 'user', body: '' }]);
  });

  it('parses a {memories:[...]} envelope', () => {
    expect(parseMcpRecords('{"memories":[{"name":"a"}]}')).toHaveLength(1);
  });

  it('returns [] on non-JSON or wrong shape', () => {
    expect(parseMcpRecords('not json')).toEqual([]);
    expect(parseMcpRecords('{"foo":1}')).toEqual([]);
  });
});

describe('LocalMemoryBackend', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-mb-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and looks up via the local store', async () => {
    const backend = new LocalMemoryBackend(new LocalMemoryStore(join(dir, 'memories')));
    await backend.write(rec('x', { description: 'hello world' }));
    expect((await backend.lookup({ query: 'hello' })).map((r) => r.name)).toEqual(['x']);
  });
});

describe('RoutingMemoryBackend', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-rb-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function localBackend(): LocalMemoryBackend {
    return new LocalMemoryBackend(new LocalMemoryStore(join(dir, 'memories')));
  }

  it('prefers the primary on lookup', async () => {
    const primary: MemoryBackend = {
      lookup: async () => [rec('from-mcp')],
      write: async () => undefined,
    };
    const routing = new RoutingMemoryBackend(primary, localBackend());
    expect((await routing.lookup({})).map((r) => r.name)).toEqual(['from-mcp']);
  });

  it('falls back to local when the primary lookup throws', async () => {
    const local = localBackend();
    await local.write(rec('local-only'));
    const primary: MemoryBackend = {
      lookup: async () => {
        throw new Error('mcp unreachable');
      },
      write: async () => undefined,
    };
    const routing = new RoutingMemoryBackend(primary, local);
    expect((await routing.lookup({})).map((r) => r.name)).toEqual(['local-only']);
  });

  it('mirrors writes locally even when the primary write fails', async () => {
    const local = localBackend();
    const primary: MemoryBackend = {
      lookup: async () => [],
      write: async () => {
        throw new Error('mcp write failed');
      },
    };
    const routing = new RoutingMemoryBackend(primary, local);
    await routing.write(rec('mirrored'));
    expect(await local.lookup({ query: 'mirrored' })).toHaveLength(1);
  });
});
