import { describe, expect, it } from 'vitest';
import type { LlmRequest } from '@event4u-agent/protocol';
import { buildContextBlock, injectContext } from './inject.js';
import { Snippet } from './snippet.js';

const content = ['function a() {}', 'function b() {}', 'function c() {}'].join('\n');

describe('buildContextBlock', () => {
  it('renders a header + fenced snippets with denotations', () => {
    const block = buildContextBlock([new Snippet('src/a.ts', content, 0, 2)]);
    expect(block).toContain('[Context: 1 snippet from codebase]');
    expect(block).toContain('// src/a.ts:0-2');
    expect(block).toContain('function a()');
  });

  it('returns empty string for no snippets', () => {
    expect(buildContextBlock([])).toBe('');
  });

  it('trims to the token budget, keeping at least one snippet', () => {
    const snippets = Array.from(
      { length: 50 },
      (_, i) => new Snippet(`src/f${i}.ts`, content, 0, 3),
    );
    // Tiny window → ~72-char budget → only the first ~70-char snippet survives.
    const block = buildContextBlock(snippets, { contextWindow: 90, budgetRatio: 0.2 });
    expect(block).toContain('[Context: 1 snippet from codebase]');
  });
});

describe('injectContext', () => {
  const base: LlmRequest = {
    model: 'claude-sonnet-4-6',
    system: 'STATIC RULES',
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'what does loginUser do?' },
    ],
    max_tokens: 1024,
  };

  it('prepends the block to the last user message and leaves system untouched', () => {
    const out = injectContext(base, '[Context: 1 snippet from codebase]\n```\n...\n```');
    expect(out.system).toBe('STATIC RULES'); // cache-friendly: system unchanged
    const lastUser = out.messages[2];
    expect(typeof lastUser?.content).toBe('string');
    expect(lastUser?.content).toContain('[Context:');
    expect(lastUser?.content).toContain('what does loginUser do?');
    // earlier turns untouched
    expect(out.messages[0]?.content).toBe('first');
  });

  it('does not mutate the input request', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    injectContext(base, 'BLOCK');
    expect(base).toEqual(snapshot);
  });

  it('is a no-op for an empty block', () => {
    expect(injectContext(base, '')).toBe(base);
  });
});
