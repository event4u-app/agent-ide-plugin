import { describe, expect, it } from 'vitest';
import type { ConfigNode } from '../config/agent-config-walker.js';
import { buildSystemPrompt } from './system-prompt.js';

function rule(name: string, body: string, fm: Record<string, unknown> = {}): ConfigNode {
  return {
    kind: 'rule',
    name,
    absPath: `/r/${name}.md`,
    relPath: `.agent-src/rules/${name}.md`,
    sourceRoot: '.agent-src',
    frontmatter: fm,
    body,
  };
}

describe('buildSystemPrompt', () => {
  it('returns rules in alphabetic order', () => {
    const out = buildSystemPrompt([rule('z', 'Body Z'), rule('a', 'Body A')]);
    expect(out.included).toEqual(['a', 'z']);
    expect(out.text.indexOf('## Rule: a')).toBeLessThan(out.text.indexOf('## Rule: z'));
  });

  it('treats missing trigger as always-active', () => {
    const out = buildSystemPrompt([rule('default', 'Body')]);
    expect(out.included).toEqual(['default']);
  });

  it('skips rules whose trigger is not "always"', () => {
    const out = buildSystemPrompt([rule('keep', 'A'), rule('skip', 'B', { trigger: 'auto' })]);
    expect(out.included).toEqual(['keep']);
    expect(out.dropped).toEqual([]); // not dropped — just not included
  });

  it('drops over-budget rules into the dropped list', () => {
    const out = buildSystemPrompt(
      [rule('a', 'x'.repeat(60)), rule('b', 'y'.repeat(60)), rule('c', 'z'.repeat(60))],
      { maxChars: 120 },
    );
    expect(out.included.length).toBeLessThan(3);
    expect(out.dropped.length).toBeGreaterThan(0);
  });

  it('prepends an optional prelude', () => {
    const out = buildSystemPrompt([rule('a', 'A')], { prelude: 'You are an agent.' });
    expect(out.text.startsWith('You are an agent.')).toBe(true);
    expect(out.text).toContain('## Rule: a');
  });

  it('returns empty text for an empty input', () => {
    const out = buildSystemPrompt([]);
    expect(out.text).toBe('');
    expect(out.included).toEqual([]);
  });
});
