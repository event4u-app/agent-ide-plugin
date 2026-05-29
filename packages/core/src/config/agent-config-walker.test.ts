import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentConfigWalkError,
  DEFAULT_SOURCE_ROOTS,
  indexByKind,
  splitFrontmatter,
  walkAgentConfig,
  type ConfigNode,
} from './agent-config-walker.js';

let root: string;

async function fixtureFile(rel: string, content: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'event4u-walker-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('splitFrontmatter', () => {
  it('returns empty frontmatter when no fence is present', () => {
    const { frontmatter, body } = splitFrontmatter('Just markdown.\nNo frontmatter.');
    expect(frontmatter).toEqual({});
    expect(body).toBe('Just markdown.\nNo frontmatter.');
  });

  it('parses a simple frontmatter block', () => {
    const text = `---
name: commit
description: One-line description.
---
# Commit
Body text.`;
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toEqual({ name: 'commit', description: 'One-line description.' });
    expect(body).toBe('# Commit\nBody text.');
  });

  it('parses lists and nested fields', () => {
    const text = `---
trust:
  level: core
keywords: [git, vcs]
---
Body.`;
    const { frontmatter } = splitFrontmatter(text);
    expect((frontmatter.trust as Record<string, unknown>).level).toBe('core');
    expect(frontmatter.keywords).toEqual(['git', 'vcs']);
  });

  it('treats `---` without closing fence as no frontmatter', () => {
    const text = `---\nname: oops\nbody continues without closing fence\n`;
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });

  it('handles BOM-prefixed files', () => {
    const text = '﻿---\nname: bom\n---\nbody';
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toEqual({ name: 'bom' });
    expect(body).toBe('body');
  });

  it('throws on malformed YAML inside frontmatter', () => {
    const text = `---\nname: : :\n---\nbody`;
    expect(() => splitFrontmatter(text, 'fixture.md')).toThrow(AgentConfigWalkError);
  });

  it('throws when frontmatter is an array', () => {
    const text = `---\n- one\n- two\n---\nbody`;
    expect(() => splitFrontmatter(text)).toThrow(/must be a mapping/);
  });

  it('empty frontmatter block produces empty object', () => {
    const text = `---\n---\nbody`;
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe('body');
  });
});

describe('walkAgentConfig', () => {
  it('returns [] when no source roots exist', async () => {
    expect(await walkAgentConfig(root)).toEqual([]);
  });

  it('finds skills, rules, and commands in a single root', async () => {
    await fixtureFile('.agent-src/skills/test-skill.md', `---\nname: test-skill\n---\nA skill.`);
    await fixtureFile('.agent-src/rules/test-rule.md', `---\nname: test-rule\n---\nA rule.`);
    await fixtureFile('.agent-src/commands/test-cmd.md', `---\nname: test-cmd\n---\nA command.`);

    const nodes = await walkAgentConfig(root);
    expect(nodes).toHaveLength(3);
    const byKind = indexByKind(nodes);
    expect(byKind.skill.map((n) => n.name)).toEqual(['test-skill']);
    expect(byKind.rule.map((n) => n.name)).toEqual(['test-rule']);
    expect(byKind.command.map((n) => n.name)).toEqual(['test-cmd']);
    for (const n of nodes) {
      expect(n.sourceRoot).toBe('.agent-src');
      expect(n.relPath.startsWith('.agent-src/')).toBe(true);
    }
  });

  it('honours source-root priority — earlier roots shadow later ones', async () => {
    await fixtureFile(
      '.event4u-agent/commands/commit.md',
      `---\nname: commit\nsource: override\n---\nOverride body.`,
    );
    await fixtureFile(
      '.augment/commands/commit.md',
      `---\nname: commit\nsource: middle\n---\nMiddle body.`,
    );
    await fixtureFile(
      '.agent-src/commands/commit.md',
      `---\nname: commit\nsource: bottom\n---\nBottom body.`,
    );

    const nodes = await walkAgentConfig(root);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.frontmatter.source).toBe('override');
    expect(nodes[0]?.sourceRoot).toBe('.event4u-agent');
    expect(nodes[0]?.body).toBe('Override body.');
  });

  it('walks nested skill directories (SKILL.md pattern)', async () => {
    await fixtureFile(
      '.augment/skills/my-skill/SKILL.md',
      `---\nname: my-skill\n---\nNested skill body.`,
    );
    const nodes = await walkAgentConfig(root);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe('my-skill');
    expect(nodes[0]?.kind).toBe('skill');
  });

  it('skips files without a .md extension', async () => {
    await fixtureFile('.agent-src/skills/notes.txt', 'should be ignored');
    await fixtureFile('.agent-src/skills/real.md', '---\nname: real\n---\nbody');
    const nodes = await walkAgentConfig(root);
    expect(nodes.map((n: ConfigNode) => n.name)).toEqual(['real']);
  });

  it('accepts files without frontmatter (empty object)', async () => {
    await fixtureFile('.agent-src/rules/no-fm.md', 'Just body, no fence.\n');
    const nodes = await walkAgentConfig(root);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.frontmatter).toEqual({});
    expect(nodes[0]?.body).toBe('Just body, no fence.\n');
  });

  it('returns nodes in stable sort order (kind, then name)', async () => {
    await fixtureFile('.agent-src/skills/zeta.md', '---\nname: zeta\n---\n');
    await fixtureFile('.agent-src/skills/alpha.md', '---\nname: alpha\n---\n');
    await fixtureFile('.agent-src/rules/beta.md', '---\nname: beta\n---\n');
    const nodes = await walkAgentConfig(root);
    expect(nodes.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'rule:beta',
      'skill:alpha',
      'skill:zeta',
    ]);
  });

  it('honours custom sourceRoots override (e.g. test fixture root)', async () => {
    await fixtureFile('.event4u-agent/commands/only-event4u.md', '---\nname: only-event4u\n---\n');
    await fixtureFile('.augment/commands/only-augment.md', '---\nname: only-augment\n---\n');
    const nodes = await walkAgentConfig(root, { sourceRoots: ['.augment'] });
    expect(nodes.map((n) => n.name)).toEqual(['only-augment']);
  });

  it('exposes the default source-root order', () => {
    expect(DEFAULT_SOURCE_ROOTS).toEqual(['.event4u-agent', '.augment', '.agent-src']);
  });
});
