import { describe, expect, it } from 'vitest';
import type { LlmBackend } from '../llm/backend.js';
import { ChatHandler, ChatRequestError } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/** A backend is required by the handler deps but never exercised by `rewind`. */
const UNUSED_BACKEND: LlmBackend = {
  id: 'fake',
  mode: 'api',
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<never> {
    throw new Error('rewind must not touch the backend');
  },
};

function handlerWith(store: InMemoryConversationStore): ChatHandler {
  return new ChatHandler({
    resolveBackend: () => UNUSED_BACKEND,
    resolveModel: () => 'test-model',
    store,
  });
}

describe('ChatHandler.rewind — conversationRewind plan (T-1303)', () => {
  it('projects a recorded checkpoint to a found plan, keeping [0, targetTurnIndex)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1' });
    await store.appendMessage('c1', { role: 'user', content: 'one' });
    await store.appendMessage('c1', { role: 'assistant', content: 'two' });
    // A complete checkpoint (file manifest + loop-state snapshot) → no warnings.
    const checkpoint = await store.recordCheckpoint('c1', {
      id: 'cp1',
      changedFiles: ['src/a.ts'],
      workState: { phase: 'verify' },
    });
    // Two messages were on record when the checkpoint was taken.
    expect(checkpoint?.turnIndex).toBe(2);

    const res = await handlerWith(store).rewind({ conversationId: 'c1', checkpointId: 'cp1' });

    expect(res.found).toBe(true);
    expect(res.conversationId).toBe('c1');
    expect(res.checkpointId).toBe('cp1');
    // Half-open interval parity (council Q5): keep == targetTurnIndex.
    expect(res.targetTurnIndex).toBe(2);
    expect(res.changedFiles).toEqual(['src/a.ts']);
    expect(res.warnings).toEqual([]);
  });

  it('NEVER projects message bodies or the opaque workState onto the wire (Q1/Q2=A)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1' });
    await store.appendMessage('c1', { role: 'user', content: 'secret body' });
    await store.recordCheckpoint('c1', {
      id: 'cp1',
      changedFiles: ['src/a.ts'],
      workState: { phase: 'implement', cursor: 42 },
    });

    const res = await handlerWith(store).rewind({ conversationId: 'c1', checkpointId: 'cp1' });

    const keys = Object.keys(res);
    expect(keys).not.toContain('messagesToKeep');
    expect(keys).not.toContain('messagesToDrop');
    expect(keys).not.toContain('workState');
    // The response, serialized, leaks neither the body nor the loop state.
    const blob = JSON.stringify(res);
    expect(blob).not.toContain('secret body');
    expect(blob).not.toContain('cursor');
  });

  it('returns found:false for an unknown checkpoint on an existing conversation (codex B)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1' });
    await store.appendMessage('c1', { role: 'user', content: 'one' });

    const res = await handlerWith(store).rewind({
      conversationId: 'c1',
      checkpointId: 'missing',
    });

    expect(res.found).toBe(false);
    expect(res.conversationId).toBe('c1');
    expect(res.checkpointId).toBe('missing');
    expect(res.targetTurnIndex).toBeUndefined();
    expect(res.changedFiles).toBeUndefined();
    expect(res.warnings).toBeUndefined();
  });

  it('throws conversation_not_found for an unknown conversation (gemini A)', async () => {
    const store = new InMemoryConversationStore();
    const handler = handlerWith(store);

    await expect(handler.rewind({ conversationId: 'nope', checkpointId: 'cp1' })).rejects.toThrow(
      ChatRequestError,
    );
    await expect(
      handler.rewind({ conversationId: 'nope', checkpointId: 'cp1' }),
    ).rejects.toMatchObject({ code: 'conversation_not_found' });
  });

  it('surfaces planRewind warnings (empty file manifest) on the wire (Q4)', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'c1' });
    await store.appendMessage('c1', { role: 'user', content: 'one' });
    await store.recordCheckpoint('c1', { id: 'cp1' }); // no changedFiles → manifest warning

    const res = await handlerWith(store).rewind({ conversationId: 'c1', checkpointId: 'cp1' });

    expect(res.found).toBe(true);
    expect(res.warnings?.some((w) => w.includes('no changed-file manifest'))).toBe(true);
  });
});
