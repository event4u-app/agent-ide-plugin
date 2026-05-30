import { describe, expect, it } from 'vitest';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  contentToText,
  isJsonRpcResponse,
} from './protocol.js';

describe('mcp protocol', () => {
  it('recognises a JSON-RPC response with result', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
  });

  it('recognises a JSON-RPC response with error', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(
      true,
    );
  });

  it('rejects a notification (no id) and a bare object', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(false);
    expect(isJsonRpcResponse({ foo: 'bar' })).toBe(false);
  });

  it('defaults missing tool fields', () => {
    const parsed = ListToolsResultSchema.parse({ tools: [{ name: 'search' }] });
    expect(parsed.tools[0]).toEqual({ name: 'search', description: '', inputSchema: {} });
  });

  it('defaults isError and content on a call result', () => {
    expect(CallToolResultSchema.parse({})).toEqual({ content: [], isError: false });
  });

  it('flattens text blocks and stringifies non-text blocks', () => {
    const text = contentToText([
      { type: 'text', text: 'hello' },
      { type: 'image', data: 'abc' },
      { type: 'text', text: 'world' },
    ]);
    expect(text).toBe('hello\n{"type":"image","data":"abc"}\nworld');
  });
});
