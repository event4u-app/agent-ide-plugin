import { describe, expect, it } from 'vitest';
import { McpClient } from './client.js';
import { FakeTransport, type FakeResult } from './fake-transport.js';
import type { JsonRpcRequest } from './protocol.js';
import { McpRegistryError, McpToolRegistry, prefixToolId } from './registry.js';

function responderFor(callText: string) {
  return (req: JsonRpcRequest): FakeResult => {
    if (req.method === 'initialize') return { result: {} };
    if (req.method === 'tools/call')
      return { result: { content: [{ type: 'text', text: callText }] } };
    return { result: {} };
  };
}

async function connectedClient(callText: string): Promise<McpClient> {
  const client = new McpClient(new FakeTransport({ respond: responderFor(callText) }));
  await client.connect();
  return client;
}

describe('McpToolRegistry', () => {
  it('prefixes tools with the server id and maps to tool definitions', async () => {
    const registry = new McpToolRegistry();
    registry.register('github', await connectedClient('a'), [
      { name: 'search', description: 'find issues', inputSchema: { type: 'object' } },
    ]);
    registry.register('fs', await connectedClient('b'), [
      { name: 'search', description: 'find files', inputSchema: {} },
    ]);

    expect(
      registry
        .tools()
        .map((t) => t.id)
        .sort(),
    ).toEqual(['fs:search', 'github:search']);
    const defs = registry.toolDefinitions();
    const gh = defs.find((d) => d.name === 'github:search');
    expect(gh).toEqual({
      name: 'github:search',
      description: 'find issues',
      input_schema: { type: 'object' },
    });
  });

  it('routes a call to the owning server by prefix', async () => {
    const registry = new McpToolRegistry();
    registry.register('github', await connectedClient('from-github'), [{ name: 'search' }]);
    registry.register('fs', await connectedClient('from-fs'), [{ name: 'search' }]);

    const res = await registry.callToolText('fs:search', {});
    expect(res.text).toBe('from-fs');
    expect(res.isError).toBe(false);
  });

  it('rejects a server id containing the separator', async () => {
    const registry = new McpToolRegistry();
    await expect(async () =>
      registry.register('bad:id', await connectedClient('x'), [{ name: 't' }]),
    ).rejects.toThrow(McpRegistryError);
  });

  it('throws on an unknown server or tool', async () => {
    const registry = new McpToolRegistry();
    registry.register('github', await connectedClient('x'), [{ name: 'search' }]);
    await expect(registry.callTool('nope:search', {})).rejects.toThrow(/no MCP server/);
    await expect(registry.callTool('github:missing', {})).rejects.toThrow(/has no tool/);
    await expect(registry.callTool('badshape', {})).rejects.toThrow(/server.*tool.*-shaped/);
  });

  it('unregister drops the server tools', async () => {
    const registry = new McpToolRegistry();
    registry.register('github', await connectedClient('x'), [{ name: 'search' }]);
    expect(registry.serverIds).toEqual(['github']);
    registry.unregister('github');
    expect(registry.tools()).toEqual([]);
  });

  it('prefixToolId builds the canonical id', () => {
    expect(prefixToolId('github', 'search')).toBe('github:search');
  });
});
