import { describe, expect, it } from 'vitest';
import type { ContextSnippetAnnotation } from '@event4u-agent/protocol';
import { buildContextInjection } from './context-injection.js';

const snippet = (
  filePath: string,
  preview: string,
  overrides: Partial<ContextSnippetAnnotation> = {},
): ContextSnippetAnnotation => ({
  kind: 'context-snippet',
  rootId: 'A',
  filePath,
  startLine: 1,
  endLine: 4,
  relevance: 1,
  category: 'source',
  preview,
  ...overrides,
});

describe('buildContextInjection', () => {
  it('returns no block for an empty snippet set', () => {
    expect(buildContextInjection([])).toEqual({ system: undefined, used: [] });
  });

  it('wraps every snippet in a single <workspace-context> block when within budget', () => {
    const snippets = [snippet('src/a.ts', 'const a = 1;'), snippet('src/b.ts', 'const b = 2;')];
    const { system, used } = buildContextInjection(snippets);

    expect(used).toEqual(snippets);
    expect(system).toContain('<workspace-context>');
    expect(system).toContain('</workspace-context>');
    expect(system).toContain('// src/a.ts:1-4');
    expect(system).toContain('const a = 1;');
    expect(system).toContain('// src/b.ts:1-4');
  });

  it('caps the block at the char budget and `used` reflects EXACTLY what was injected', () => {
    const big = 'x'.repeat(200);
    const snippets = [snippet('a.ts', big), snippet('b.ts', big), snippet('c.ts', big)];
    // Budget fits the first snippet but not a second.
    const { system, used } = buildContextInjection(snippets, { maxChars: 250 });

    expect(used).toHaveLength(1);
    expect(used[0]?.filePath).toBe('a.ts');
    expect(system).toContain('// a.ts:1-4');
    expect(system).not.toContain('// b.ts');
    expect(system).not.toContain('// c.ts');
  });

  it('always includes the first snippet even when it alone exceeds the budget', () => {
    const huge = 'y'.repeat(5000);
    const { system, used } = buildContextInjection([snippet('only.ts', huge)], { maxChars: 100 });

    expect(used).toHaveLength(1);
    expect(system).toContain('// only.ts');
  });
});
