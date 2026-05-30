import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../config/agent-settings.js';
import { FakeTransport, type FakeResult } from './fake-transport.js';
import { McpManager, type TransportFactory } from './manager.js';
import type { JsonRpcRequest } from './protocol.js';

function server(id: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { id, command: 'noop', args: [], env: {}, enabled: true, ...overrides };
}

function goodResponder(toolName: string) {
  return (req: JsonRpcRequest): FakeResult => {
    if (req.method === 'initialize') return { result: {} };
    if (req.method === 'tools/list') return { result: { tools: [{ name: toolName }] } };
    if (req.method === 'tools/call') return { result: { content: [{ type: 'text', text: 'ok' }] } };
    return { result: {} };
  };
}

describe('McpManager', () => {
  it('connects every enabled server and aggregates their tools', async () => {
    const factory: TransportFactory = (config) =>
      new FakeTransport({ respond: goodResponder(`${config.id}_tool`) });
    const manager = new McpManager({ transportFactory: factory });
    const { registry, results } = await manager.connectAll([server('a'), server('b')]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(
      registry
        .tools()
        .map((t) => t.id)
        .sort(),
    ).toEqual(['a:a_tool', 'b:b_tool']);
    await manager.dispose();
  });

  it('is fail-open: a server that fails to init is skipped, others connect', async () => {
    const factory: TransportFactory = (config) => {
      if (config.id === 'bad') return new FakeTransport({ startError: new Error('spawn ENOENT') });
      return new FakeTransport({ respond: goodResponder('ok_tool') });
    };
    const manager = new McpManager({ transportFactory: factory });
    const { registry, results } = await manager.connectAll([server('bad'), server('good')]);

    const bad = results.find((r) => r.id === 'bad');
    const good = results.find((r) => r.id === 'good');
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toMatch(/spawn ENOENT/);
    expect(good?.ok).toBe(true);
    expect(registry.serverIds).toEqual(['good']);
    await manager.dispose();
  });

  it('skips disabled servers without spawning', async () => {
    let spawned = 0;
    const factory: TransportFactory = () => {
      spawned += 1;
      return new FakeTransport({ respond: goodResponder('t') });
    };
    const manager = new McpManager({ transportFactory: factory });
    const { results } = await manager.connectAll([server('off', { enabled: false })]);
    expect(spawned).toBe(0);
    expect(results[0]).toMatchObject({ id: 'off', ok: false, error: 'disabled' });
  });

  it('a hung init does not block other servers (bounded by init timeout)', async () => {
    const factory: TransportFactory = (config) =>
      config.id === 'hang'
        ? new FakeTransport({ respond: () => 'never' })
        : new FakeTransport({ respond: goodResponder('t') });
    const manager = new McpManager({ transportFactory: factory });
    const { results } = await manager.connectAll([
      server('hang', { init_timeout_ms: 10 }),
      server('live'),
    ]);
    expect(results.find((r) => r.id === 'hang')?.ok).toBe(false);
    expect(results.find((r) => r.id === 'live')?.ok).toBe(true);
    await manager.dispose();
  });

  it('exposes a live client by id for typed consumers', async () => {
    const factory: TransportFactory = () => new FakeTransport({ respond: goodResponder('t') });
    const manager = new McpManager({ transportFactory: factory });
    await manager.connectAll([server('agent-config')]);
    expect(manager.client('agent-config')).toBeDefined();
    expect(manager.client('missing')).toBeUndefined();
    await manager.dispose();
  });
});
