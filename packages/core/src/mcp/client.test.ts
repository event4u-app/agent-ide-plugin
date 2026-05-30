import { describe, expect, it } from 'vitest';
import { McpClient, McpClientError } from './client.js';
import { FakeTransport, type FakeResult } from './fake-transport.js';
import type { JsonRpcRequest } from './protocol.js';

/** A responder covering the three methods the client drives. */
function standardResponder(req: JsonRpcRequest): FakeResult {
  switch (req.method) {
    case 'initialize':
      return { result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } } };
    case 'tools/list':
      return {
        result: {
          tools: [
            { name: 'search', description: 'search things', inputSchema: { type: 'object' } },
            { name: 'fetch' },
          ],
        },
      };
    case 'tools/call':
      return { result: { content: [{ type: 'text', text: 'ok' }] } };
    default:
      return { error: { code: -32601, message: `method not found: ${req.method}` } };
  }
}

describe('McpClient', () => {
  it('runs the initialize handshake and sends the initialized notification', async () => {
    const transport = new FakeTransport({ respond: standardResponder });
    const client = new McpClient(transport);
    const init = await client.connect();
    expect(init.serverInfo?.name).toBe('fake');
    expect(client.isInitialized).toBe(true);
    expect(transport.notifications.map((n) => n.method)).toContain('notifications/initialized');
  });

  it('lists tools and applies schema defaults', async () => {
    const transport = new FakeTransport({ respond: standardResponder });
    const client = new McpClient(transport);
    await client.connect();
    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[1]).toEqual({ name: 'fetch', description: '', inputSchema: {} });
  });

  it('calls a tool and returns parsed content', async () => {
    const transport = new FakeTransport({ respond: standardResponder });
    const client = new McpClient(transport);
    await client.connect();
    const result = await client.callTool('search', { q: 'x' });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    const callReq = transport.sent.find((r) => r.method === 'tools/call');
    expect(callReq?.params).toEqual({ name: 'search', arguments: { q: 'x' } });
  });

  it('surfaces a JSON-RPC error as McpClientError', async () => {
    const transport = new FakeTransport({
      respond: (req) =>
        req.method === 'initialize' ? { result: {} } : { error: { code: -32000, message: 'boom' } },
    });
    const client = new McpClient(transport);
    await client.connect();
    await expect(client.listTools()).rejects.toThrow(/boom/);
  });

  it('times out a hung request without pinning the loop', async () => {
    const transport = new FakeTransport({
      respond: (req) => (req.method === 'initialize' ? { result: {} } : 'never'),
    });
    const client = new McpClient(transport, { requestTimeoutMs: 10 });
    await client.connect();
    await expect(client.listTools()).rejects.toThrow(/timed out/);
  });

  it('times out a hung initialize', async () => {
    const transport = new FakeTransport({ respond: () => 'never' });
    const client = new McpClient(transport, { initTimeoutMs: 10 });
    await expect(client.connect()).rejects.toThrow(/timed out/);
  });

  it('rejects in-flight requests when the transport dies', async () => {
    const transport = new FakeTransport({
      respond: (req) => (req.method === 'initialize' ? { result: {} } : 'never'),
    });
    const client = new McpClient(transport, { requestTimeoutMs: 5000 });
    await client.connect();
    const pending = client.listTools();
    transport.simulateExit(new Error('server crashed'));
    await expect(pending).rejects.toThrow(/server crashed/);
    expect(client.isInitialized).toBe(false);
  });

  it('refuses requests after close', async () => {
    const transport = new FakeTransport({ respond: standardResponder });
    const client = new McpClient(transport);
    await client.connect();
    await client.close();
    await expect(client.listTools()).rejects.toThrow(McpClientError);
  });
});
