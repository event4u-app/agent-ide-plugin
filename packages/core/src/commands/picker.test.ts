import { describe, expect, it } from 'vitest';
import type { ConfigNode } from '../config/agent-config-walker.js';
import { commandsToPickerItems, pickCommands } from './picker.js';

const NODES: ConfigNode[] = [
  {
    kind: 'command',
    name: 'commit',
    absPath: '/cmds/commit.md',
    relPath: '.agent-src/commands/commit.md',
    sourceRoot: '.agent-src',
    frontmatter: { description: 'Stage and commit the current changes.' },
    body: '# Commit\nBody.',
  },
  {
    kind: 'command',
    name: 'review-changes',
    absPath: '/cmds/review.md',
    relPath: '.agent-src/commands/review.md',
    sourceRoot: '.agent-src',
    frontmatter: {},
    body: '# Review Changes\nBody.',
  },
  {
    kind: 'command',
    name: 'create-pr',
    absPath: '/cmds/create-pr.md',
    relPath: '.agent-src/commands/create-pr.md',
    sourceRoot: '.agent-src',
    frontmatter: { description: 'Open a pull request from the current branch.' },
    body: '',
  },
  // Non-command should be filtered out.
  {
    kind: 'skill',
    name: 'pricing',
    absPath: '/skills/pricing.md',
    relPath: '.agent-src/skills/pricing.md',
    sourceRoot: '.agent-src',
    frontmatter: {},
    body: '',
  },
];

describe('commandsToPickerItems', () => {
  it('keeps commands only', () => {
    const items = commandsToPickerItems(NODES);
    expect(items.map((i) => i.name)).toEqual(['commit', 'review-changes', 'create-pr']);
  });

  it('falls back to the first heading when description is missing', () => {
    const items = commandsToPickerItems(NODES);
    const review = items.find((i) => i.name === 'review-changes')!;
    expect(review.description).toBe('Review Changes');
  });
});

describe('pickCommands', () => {
  const items = commandsToPickerItems(NODES);

  it('returns alphabetic order for an empty query', () => {
    const results = pickCommands(items, '');
    expect(results.map((r) => r.name)).toEqual(['commit', 'create-pr', 'review-changes']);
  });

  it('returns alphabetic order for whitespace-only query', () => {
    expect(pickCommands(items, '   ').map((r) => r.name)).toEqual([
      'commit',
      'create-pr',
      'review-changes',
    ]);
  });

  it('ranks prefix matches above scattered ones', () => {
    const results = pickCommands(items, 'co');
    expect(results[0]?.name).toBe('commit');
  });

  it('drops items whose characters do not appear in order', () => {
    const results = pickCommands(items, 'zzz');
    expect(results).toEqual([]);
  });

  it('matches non-prefix subsequences', () => {
    const results = pickCommands(items, 'rev');
    expect(results.map((r) => r.name)).toContain('review-changes');
  });

  it('is case-insensitive', () => {
    const results = pickCommands(items, 'COMMIT');
    expect(results[0]?.name).toBe('commit');
  });
});
