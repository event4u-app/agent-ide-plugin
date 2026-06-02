import { describe, expect, it, vi } from 'vitest';
import type { ConfigNode } from '../config/agent-config-walker.js';
import { CommandHandler, MAX_COMMAND_LIST_RESULTS, type CommandHandlerDeps } from './handler.js';

function cmd(name: string, opts: { description?: string; body?: string } = {}): ConfigNode {
  return {
    kind: 'command',
    name,
    absPath: `/repo/.augment/commands/${name}.md`,
    relPath: `commands/${name}.md`,
    sourceRoot: '.augment',
    frontmatter: opts.description !== undefined ? { description: opts.description } : {},
    body: opts.body ?? '',
  };
}

const nodesOf =
  (...nodes: ConfigNode[]) =>
  () =>
    Promise.resolve(nodes);

describe('CommandHandler.list', () => {
  it('lists every command alphabetically for an absent/empty query', async () => {
    const h = new CommandHandler({
      loadNodes: nodesOf(cmd('commit', { description: 'Create a commit' }), cmd('ask')),
    });
    const res = await h.list({});
    expect(res.commands.map((c) => c.name)).toEqual(['ask', 'commit']);
    expect(res.total).toBe(2);
    expect(res.commands[1]).toEqual({
      name: 'commit',
      description: 'Create a commit',
      path: '/repo/.augment/commands/commit.md',
    });
  });

  it('ranks fuzzy matches for a query and reports the match count as total', async () => {
    const h = new CommandHandler({
      loadNodes: nodesOf(cmd('commit'), cmd('commit-in-chunks'), cmd('ask')),
    });
    const res = await h.list({ query: 'commit' });
    expect(res.commands.map((c) => c.name)).toEqual(['commit', 'commit-in-chunks']);
    expect(res.total).toBe(2); // 'ask' did not match → excluded from total
  });

  it('falls back to the first heading when frontmatter has no description', async () => {
    const h = new CommandHandler({
      loadNodes: nodesOf(cmd('plan', { body: '# Plan the work\n...' })),
    });
    const res = await h.list({});
    expect(res.commands[0]!.description).toBe('Plan the work');
  });

  it('ignores non-command nodes', async () => {
    const rule: ConfigNode = { ...cmd('a-rule'), kind: 'rule' };
    const h = new CommandHandler({ loadNodes: nodesOf(rule, cmd('commit')) });
    const res = await h.list({});
    expect(res.commands.map((c) => c.name)).toEqual(['commit']);
  });

  it('clamps to the requested limit while total stays the full match count', async () => {
    const h = new CommandHandler({ loadNodes: nodesOf(cmd('a'), cmd('b'), cmd('c')) });
    const res = await h.list({ limit: 2 });
    expect(res.commands).toHaveLength(2);
    expect(res.total).toBe(3);
  });

  it('never returns more than the hard ceiling', async () => {
    const many = Array.from({ length: MAX_COMMAND_LIST_RESULTS + 25 }, (_, i) =>
      cmd(`cmd-${String(i).padStart(3, '0')}`),
    );
    const h = new CommandHandler({ loadNodes: nodesOf(...many) });
    const res = await h.list({});
    expect(res.commands).toHaveLength(MAX_COMMAND_LIST_RESULTS);
    expect(res.total).toBe(MAX_COMMAND_LIST_RESULTS + 25);
  });

  it('fails open to an empty list when the walk throws (does not throw)', async () => {
    const h = new CommandHandler({
      loadNodes: () => Promise.reject(new Error('FS race')),
    });
    const res = await h.list({});
    expect(res.commands).toEqual([]);
    expect(res.total).toBe(0);
  });
});

describe('CommandHandler.read', () => {
  it('returns the local body when MCP is absent', async () => {
    const h = new CommandHandler({
      loadNodes: nodesOf(cmd('commit', { body: '# Commit\nrun it' })),
    });
    const res = await h.read({ name: 'commit' });
    expect(res).toEqual({ name: 'commit', source: 'local', body: '# Commit\nrun it' });
  });

  it('reports missing for an unknown command', async () => {
    const h = new CommandHandler({ loadNodes: nodesOf(cmd('commit')) });
    const res = await h.read({ name: 'nope' });
    expect(res).toEqual({ name: 'nope', source: 'missing', body: '' });
  });

  it('prefers the MCP server body over the local index when connected', async () => {
    const commandRead = vi.fn().mockResolvedValue({ isError: false, text: 'MCP body' });
    const h = new CommandHandler({
      loadNodes: nodesOf(cmd('commit', { body: 'local body' })),
      mcp: { commandRead } as unknown as CommandHandlerDeps['mcp'],
    });
    const res = await h.read({ name: 'commit' });
    expect(res.source).toBe('mcp');
    expect(res.body).toBe('MCP body');
    expect(commandRead).toHaveBeenCalledWith('commit');
  });
});

describe('CommandHandler — walk-once cache', () => {
  it('walks the agent-config tree once across multiple calls', async () => {
    const loadNodes = vi.fn(nodesOf(cmd('commit')));
    const h = new CommandHandler({ loadNodes });
    await h.list({});
    await h.list({ query: 'co' });
    await h.read({ name: 'commit' });
    expect(loadNodes).toHaveBeenCalledTimes(1);
  });
});
