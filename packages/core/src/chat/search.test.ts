import { describe, expect, it } from 'vitest';
import { searchConversations } from './search.js';
import type { Conversation } from './types.js';

function conv(id: string, updatedAt: string, title: string, bodies: string[]): Conversation {
  return {
    id,
    title,
    messages: bodies.map((content, i) => ({
      id: `${id}-m${i}`,
      role: 'user',
      content,
      at: updatedAt,
      turnIndex: i,
    })),
    checkpoints: [],
    createdAt: '0',
    updatedAt,
  };
}

describe('searchConversations', () => {
  const corpus = [
    conv('a', '2026-01-02T00:00:00Z', 'Auth refactor', [
      'rework the login token flow',
      'token rotation done',
    ]),
    conv('b', '2026-01-03T00:00:00Z', 'Login bug', ['the login page crashes']),
    conv('c', '2026-01-01T00:00:00Z', 'Billing', ['invoice rounding']),
  ];

  it('returns empty for an empty/whitespace query', () => {
    expect(searchConversations(corpus, '   ')).toEqual([]);
  });

  it('matches title or body, ranked newest-updated first', () => {
    const hits = searchConversations(corpus, 'login');
    expect(hits.map((h) => h.summary.id)).toEqual(['b', 'a']); // b is newer
  });

  it('requires every token to appear somewhere (token-AND)', () => {
    expect(searchConversations(corpus, 'login invoice')).toEqual([]);
    expect(searchConversations(corpus, 'token rotation').map((h) => h.summary.id)).toEqual(['a']);
  });

  it('counts hits across messages and produces a snippet from the first body match', () => {
    const hit = searchConversations(corpus, 'token')[0];
    expect(hit?.summary.id).toBe('a');
    expect(hit?.hitCount).toBe(2); // two messages contain "token"
    expect(hit?.snippet).toContain('token');
  });

  it('honours the result limit', () => {
    expect(searchConversations(corpus, 'login', { limit: 1 })).toHaveLength(1);
  });
});
