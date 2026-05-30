import { describe, expect, it } from 'vitest';
import type { ConfigNode } from '../config/agent-config-walker.js';
import type { AgentConfigMcpClient } from '../mcp/agent-config-client.js';
import { loadCommandProcedure } from './loader.js';

function commandNode(name: string, body: string): ConfigNode {
  return {
    kind: 'command',
    name,
    absPath: `/repo/.event4u-agent/commands/${name}.md`,
    relPath: `.event4u-agent/commands/${name}.md`,
    sourceRoot: '.event4u-agent',
    frontmatter: {},
    body,
  };
}

/** Minimal stub matching the AgentConfigMcpClient surface the loader uses. */
function mcpStub(reply: { text: string; isError: boolean } | Error): AgentConfigMcpClient {
  return {
    commandRead: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  } as unknown as AgentConfigMcpClient;
}

describe('loadCommandProcedure', () => {
  const localNodes = [commandNode('commit', 'local commit body')];

  it('prefers the MCP source when it returns a body', async () => {
    const loaded = await loadCommandProcedure('commit', {
      mcp: mcpStub({ text: 'mcp commit body', isError: false }),
      localNodes,
    });
    expect(loaded).toEqual({ name: 'commit', source: 'mcp', body: 'mcp commit body' });
  });

  it('falls back to local when MCP errors', async () => {
    const loaded = await loadCommandProcedure('commit', {
      mcp: mcpStub(new Error('server down')),
      localNodes,
    });
    expect(loaded).toMatchObject({ source: 'local', body: 'local commit body' });
  });

  it('falls back to local when MCP returns isError or empty', async () => {
    const onError = await loadCommandProcedure('commit', {
      mcp: mcpStub({ text: 'x', isError: true }),
      localNodes,
    });
    expect(onError.source).toBe('local');
    const onEmpty = await loadCommandProcedure('commit', {
      mcp: mcpStub({ text: '   ', isError: false }),
      localNodes,
    });
    expect(onEmpty.source).toBe('local');
  });

  it('uses local directly when no MCP client is provided', async () => {
    const loaded = await loadCommandProcedure('commit', { localNodes });
    expect(loaded.source).toBe('local');
  });

  it('reports missing when neither source has the command', async () => {
    const loaded = await loadCommandProcedure('unknown', { localNodes });
    expect(loaded).toEqual({ name: 'unknown', source: 'missing', body: '' });
  });
});
