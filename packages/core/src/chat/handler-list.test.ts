import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from './types.js';
import type { LlmBackend } from '../llm/backend.js';
import { ChatHandler, MAX_CONVERSATION_LIST_RESULTS } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/** A backend is required by the handler deps but never exercised by `list`. */
const UNUSED_BACKEND: LlmBackend = {
  id: 'fake',
  mode: 'api',
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<never> {
    throw new Error('list must not touch the backend');
  },
};

function handlerWith(store: InMemoryConversationStore): ChatHandler {
  return new ChatHandler({
    resolveBackend: () => UNUSED_BACKEND,
    resolveModel: () => 'test-model',
    store,
  });
}

/** A fabricated summary at a given `updatedAt`, for ordering / clamp assertions. */
function summary(id: string, updatedAt: string): ConversationSummary {
  return {
    id,
    title: id,
    messageCount: 0,
    checkpointCount: 0,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('ChatHandler.list — conversationList (T-1301)', () => {
  it('delegates to store.list and preserves its newest-first order with total', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1', title: 'Login flow' });
    await store.create({ id: 'c2', title: 'Billing' });

    const res = await handlerWith(store).list({});

    expect(res.total).toBe(2);
    // store.list sorts newest-`updatedAt` first; c2 was created last.
    expect(res.conversations.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(res.conversations[0]!.title).toBe('Billing');
  });

  it('clamps to the hard ceiling and reports the full count as total (Q1=B, Q3 total)', async () => {
    const store = new InMemoryConversationStore();
    const full = Array.from({ length: MAX_CONVERSATION_LIST_RESULTS + 5 }, (_, i) =>
      summary(`c${i}`, `2026-06-02T00:00:${String(i).padStart(2, '0')}.000Z`),
    );
    vi.spyOn(store, 'list').mockResolvedValue(full);
    const handler = handlerWith(store);

    // Omitted limit → clamped to the ceiling; total still reflects the full set.
    const capped = await handler.list({});
    expect(capped.conversations).toHaveLength(MAX_CONVERSATION_LIST_RESULTS);
    expect(capped.total).toBe(full.length);

    // An oversized limit is clamped down to the ceiling.
    const oversized = await handler.list({ limit: MAX_CONVERSATION_LIST_RESULTS + 500 });
    expect(oversized.conversations).toHaveLength(MAX_CONVERSATION_LIST_RESULTS);

    // A smaller limit rides through unchanged.
    const small = await handler.list({ limit: 3 });
    expect(small.conversations).toHaveLength(3);
    expect(small.total).toBe(full.length);
  });

  it('returns an empty listing with total 0 when there are no conversations', async () => {
    const res = await handlerWith(new InMemoryConversationStore()).list({});
    expect(res.conversations).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('omits optional parentId cleanly (exactOptionalPropertyTypes-safe)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1', title: 'top-level' });

    const res = await handlerWith(store).list({});

    expect(res.conversations).toHaveLength(1);
    const only = res.conversations[0]!;
    expect(only.parentId).toBeUndefined();
    // Nothing leaks beyond the projected summary shape.
    expect(Object.keys(only).sort()).toEqual(
      ['checkpointCount', 'createdAt', 'id', 'messageCount', 'title', 'updatedAt'].sort(),
    );
  });
});
