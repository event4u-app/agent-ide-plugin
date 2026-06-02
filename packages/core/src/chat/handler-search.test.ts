import { describe, expect, it, vi } from 'vitest';
import type { LlmBackend } from '../llm/backend.js';
import { ChatHandler, MAX_CONVERSATION_SEARCH_RESULTS } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/** A backend is required by the handler deps but never exercised by `search`. */
const UNUSED_BACKEND: LlmBackend = {
  id: 'fake',
  mode: 'api',
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<never> {
    throw new Error('search must not touch the backend');
  },
};

function handlerWith(store: InMemoryConversationStore): ChatHandler {
  return new ChatHandler({
    resolveBackend: () => UNUSED_BACKEND,
    resolveModel: () => 'test-model',
    store,
  });
}

describe('ChatHandler.search — conversationSearch (T-1301)', () => {
  it('returns no results for an empty / whitespace query (council Q2=A)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1', title: 'Login flow' });
    await store.appendMessage('c1', { role: 'user', content: 'fix the auth bug' });

    expect((await handlerWith(store).search({ query: '' })).results).toEqual([]);
    expect((await handlerWith(store).search({ query: '   ' })).results).toEqual([]);
  });

  it('projects ranked hits with the full summary + snippet onto the wire (Q1=A)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1', title: 'Login flow' });
    await store.appendMessage('c1', { role: 'user', content: 'the auth token expires too soon' });
    await store.create({ id: 'c2', title: 'Billing' });
    await store.appendMessage('c2', { role: 'user', content: 'invoice math is wrong' });

    const res = await handlerWith(store).search({ query: 'auth' });

    expect(res.results).toHaveLength(1);
    const hit = res.results[0]!;
    expect(hit.summary.id).toBe('c1');
    expect(hit.summary.title).toBe('Login flow');
    expect(hit.summary.messageCount).toBe(1);
    expect(hit.hitCount).toBeGreaterThanOrEqual(1);
    expect(hit.snippet).toContain('auth');
  });

  it('clamps the result count to the hard ceiling, regardless of the request limit (Q3=B)', async () => {
    const store = new InMemoryConversationStore();
    const spy = vi.spyOn(store, 'search').mockResolvedValue([]);
    const handler = handlerWith(store);

    // Omitted limit → the hard ceiling is applied.
    await handler.search({ query: 'x' });
    expect(spy).toHaveBeenLastCalledWith('x', { limit: MAX_CONVERSATION_SEARCH_RESULTS });

    // An oversized limit is clamped down to the ceiling.
    await handler.search({ query: 'x', limit: MAX_CONVERSATION_SEARCH_RESULTS + 500 });
    expect(spy).toHaveBeenLastCalledWith('x', { limit: MAX_CONVERSATION_SEARCH_RESULTS });

    // A smaller limit rides through unchanged.
    await handler.search({ query: 'x', limit: 3 });
    expect(spy).toHaveBeenLastCalledWith('x', { limit: 3 });
  });

  it('omits optional parentId / snippet cleanly (exactOptionalPropertyTypes-safe)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1', title: 'auth' }); // title hit, no body → no snippet

    const res = await handlerWith(store).search({ query: 'auth' });

    expect(res.results).toHaveLength(1);
    const hit = res.results[0]!;
    expect(hit.snippet).toBeUndefined();
    expect(hit.summary.parentId).toBeUndefined();
    // Nothing leaks beyond the projected summary shape.
    expect(Object.keys(hit.summary).sort()).toEqual(
      ['checkpointCount', 'createdAt', 'id', 'messageCount', 'title', 'updatedAt'].sort(),
    );
  });
});
