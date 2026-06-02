import { describe, expect, it, vi } from 'vitest';
import type { ConfigKind, ConfigNode } from './agent-config-walker.js';
import { ConfigHandler, MAX_CONFIG_LIST_RESULTS } from './handler.js';

function node(
  kind: ConfigKind,
  name: string,
  opts: { description?: string; body?: string; fmName?: string } = {},
): ConfigNode {
  const frontmatter: Record<string, unknown> = {};
  if (opts.description !== undefined) frontmatter.description = opts.description;
  if (opts.fmName !== undefined) frontmatter.name = opts.fmName;
  return {
    kind,
    name,
    absPath: `/repo/.event4u-agent/${kind}s/${name}.md`,
    relPath: `${kind}s/${name}.md`,
    sourceRoot: '.event4u-agent',
    frontmatter,
    body: opts.body ?? '',
  };
}

// The walker sorts by kind then name; the handler relies on that order.
const nodesOf =
  (...nodes: ConfigNode[]) =>
  () =>
    Promise.resolve(nodes);

describe('ConfigHandler.list', () => {
  it('lists every kind grouped skill→rule→command for an absent kind filter', async () => {
    const h = new ConfigHandler({
      loadNodes: nodesOf(
        node('command', 'commit', { description: 'Create a commit' }),
        node('rule', 'scope-control', { description: 'Stay in scope' }),
        node('skill', 'laravel', { description: 'Write Laravel PHP' }),
      ),
    });
    const res = await h.list({});
    expect(res.items).toEqual([
      {
        kind: 'skill',
        name: 'laravel',
        description: 'Write Laravel PHP',
        path: res.items[0]!.path,
      },
      {
        kind: 'rule',
        name: 'scope-control',
        description: 'Stay in scope',
        path: res.items[1]!.path,
      },
      { kind: 'command', name: 'commit', description: 'Create a commit', path: res.items[2]!.path },
    ]);
    expect(res.total).toBe(3);
  });

  it('filters to a single kind when requested, and total reflects that kind only', async () => {
    // Fed in walker order (sorted by kind then name) — the handler preserves it.
    const h = new ConfigHandler({
      loadNodes: nodesOf(
        node('command', 'commit'),
        node('rule', 'scope-control'),
        node('skill', 'eloquent'),
        node('skill', 'laravel'),
      ),
    });
    const res = await h.list({ kind: 'skill' });
    expect(res.items.map((i) => i.name)).toEqual(['eloquent', 'laravel']);
    expect(res.items.every((i) => i.kind === 'skill')).toBe(true);
    expect(res.total).toBe(2);
  });

  it('falls back to the first heading when frontmatter has no description', async () => {
    const h = new ConfigHandler({
      loadNodes: nodesOf(node('skill', 'plan', { body: '# Plan the work\n...' })),
    });
    const res = await h.list({});
    expect(res.items[0]!.description).toBe('Plan the work');
  });

  it('leaves description empty when neither frontmatter nor a heading exists', async () => {
    const h = new ConfigHandler({
      loadNodes: nodesOf(node('rule', 'bare', { body: 'no heading' })),
    });
    const res = await h.list({});
    expect(res.items[0]!.description).toBe('');
  });

  it('prefers a non-empty frontmatter name over the file slug', async () => {
    const h = new ConfigHandler({
      loadNodes: nodesOf(node('skill', 'laravel-slug', { fmName: 'laravel' })),
    });
    const res = await h.list({});
    expect(res.items[0]!.name).toBe('laravel');
  });

  it('carries the absolute path for IDE click-through', async () => {
    const h = new ConfigHandler({ loadNodes: nodesOf(node('skill', 'laravel')) });
    const res = await h.list({});
    expect(res.items[0]!.path).toBe('/repo/.event4u-agent/skills/laravel.md');
  });

  it('clamps to the requested limit while total stays the full count', async () => {
    const h = new ConfigHandler({
      loadNodes: nodesOf(node('skill', 'a'), node('skill', 'b'), node('rule', 'c')),
    });
    const res = await h.list({ limit: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(3);
  });

  it('never returns more than the hard ceiling', async () => {
    const many = Array.from({ length: MAX_CONFIG_LIST_RESULTS + 25 }, (_, i) =>
      node('skill', `skill-${String(i).padStart(3, '0')}`),
    );
    const h = new ConfigHandler({ loadNodes: nodesOf(...many) });
    const res = await h.list({});
    expect(res.items).toHaveLength(MAX_CONFIG_LIST_RESULTS);
    expect(res.total).toBe(MAX_CONFIG_LIST_RESULTS + 25);
  });

  it('fails open to an empty list when the walk throws (does not throw)', async () => {
    const h = new ConfigHandler({
      loadNodes: () => Promise.reject(new Error('FS race')),
    });
    const res = await h.list({});
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });
});

describe('ConfigHandler — walk-once cache', () => {
  it('walks the agent-config tree once across multiple calls', async () => {
    const loadNodes = vi.fn(nodesOf(node('skill', 'laravel'), node('rule', 'scope-control')));
    const h = new ConfigHandler({ loadNodes });
    await h.list({});
    await h.list({ kind: 'skill' });
    await h.list({ kind: 'rule' });
    expect(loadNodes).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed walk (retries next call)', async () => {
    const loadNodes = vi
      .fn<() => Promise<readonly ConfigNode[]>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce([node('skill', 'laravel')]);
    const h = new ConfigHandler({ loadNodes });
    expect((await h.list({})).items).toEqual([]);
    expect((await h.list({})).items.map((i) => i.name)).toEqual(['laravel']);
    expect(loadNodes).toHaveBeenCalledTimes(2);
  });
});
