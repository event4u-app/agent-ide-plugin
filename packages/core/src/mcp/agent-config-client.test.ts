import { describe, expect, it } from 'vitest';
import {
  AGENT_CONFIG_SERVER_ID,
  AgentConfigMcpClient,
  DEFAULT_AGENT_CONFIG_SERVER,
} from './agent-config-client.js';
import { McpClient } from './client.js';
import { FakeTransport, type FakeResult } from './fake-transport.js';
import type { JsonRpcRequest } from './protocol.js';

/** Echoes the tool name + arguments back as text so tests assert routing. */
function echoResponder(req: JsonRpcRequest): FakeResult {
  if (req.method === 'initialize') return { result: {} };
  if (req.method === 'tools/call') {
    const params = req.params as { name: string; arguments: unknown };
    if (params.name === 'broken') {
      return { result: { content: [{ type: 'text', text: 'nope' }], isError: true } };
    }
    return {
      result: {
        content: [{ type: 'text', text: `${params.name}:${JSON.stringify(params.arguments)}` }],
      },
    };
  }
  return { result: {} };
}

async function connect(): Promise<AgentConfigMcpClient> {
  const client = new McpClient(new FakeTransport({ respond: echoResponder }));
  await client.connect();
  return new AgentConfigMcpClient(client);
}

describe('AgentConfigMcpClient', () => {
  it('ships a default server config under the conventional id', () => {
    expect(DEFAULT_AGENT_CONFIG_SERVER.id).toBe(AGENT_CONFIG_SERVER_ID);
    expect(DEFAULT_AGENT_CONFIG_SERVER.command).toBe('npx');
    expect(DEFAULT_AGENT_CONFIG_SERVER.args).toContain('@event4u/agent-config');
  });

  it('routes each named tool to the right MCP tool with its args', async () => {
    const ac = await connect();
    expect((await ac.memoryLookup({ query: 'auth', limit: 3 })).text).toBe(
      'memory_lookup:{"query":"auth","limit":3}',
    );
    expect((await ac.skillRead('laravel')).text).toBe('skill_read:{"name":"laravel"}');
    expect((await ac.commandRead('commit')).text).toBe('command_read:{"name":"commit"}');
    expect((await ac.listSkills()).text).toBe('list_skills:{}');
    expect((await ac.chatHistoryRead()).text).toBe('chat_history_read:{}');
  });

  it('surfaces a tool isError flag', async () => {
    const client = new McpClient(new FakeTransport({ respond: echoResponder }));
    await client.connect();
    // Drive a tool the responder marks as error by name.
    const raw = await client.callTool('broken', {});
    expect(raw.isError).toBe(true);
  });
});
