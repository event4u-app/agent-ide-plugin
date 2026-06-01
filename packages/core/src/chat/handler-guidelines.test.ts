import { describe, expect, it } from 'vitest';
import type { Envelope, LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from '../llm/backend.js';
import { ChatHandler } from './handler.js';
import { InMemoryConversationStore } from './store.js';

const USAGE = { input_tokens: 10, output_tokens: 5 };

/** A backend that records the request it was handed, then streams one chunk. */
function capturingBackend(): { backend: LlmBackend; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const backend: LlmBackend = {
    id: 'fake',
    mode: 'api',
    async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      requests.push(request);
      yield { kind: 'text_delta', text: 'ok' };
      yield { kind: 'stop', reason: 'end_turn', usage: USAGE };
    },
  };
  return { backend, requests };
}

function sink(): { emit: (e: Envelope) => void; envelopes: Envelope[] } {
  const envelopes: Envelope[] = [];
  return { emit: (e) => envelopes.push(e), envelopes };
}

describe('ChatHandler — workspace guidelines folded into the system prompt (T-1307)', () => {
  it('omits `system` when no guidelines loader is wired (backward-compatible)', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
    });
    const { emit } = sink();
    await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, emit);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toBeUndefined();
  });

  it('folds the loaded guidelines into `system` on the request', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadGuidelines: async () => 'Prefer early returns.',
    });
    const { emit } = sink();
    await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, emit);

    expect(requests[0]!.system).toContain('<workspace-guidelines>');
    expect(requests[0]!.system).toContain('Prefer early returns.');
  });

  it('omits `system` when the loader returns empty guidelines', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadGuidelines: async () => '   ',
    });
    const { emit } = sink();
    await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, emit);

    expect(requests[0]!.system).toBeUndefined();
  });

  it('fails open: a guidelines load error never breaks the turn', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadGuidelines: async () => {
        throw new Error('disk gone');
      },
    });
    const { emit } = sink();
    const terminal = await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, emit);

    expect(terminal.done).toBe(true);
    expect(requests[0]!.system).toBeUndefined();
  });

  it('reloads guidelines per turn (an edit between turns takes effect — fork D1)', async () => {
    const { backend, requests } = capturingBackend();
    let current = 'v1 rules';
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadGuidelines: async () => current,
    });
    const { emit } = sink();
    await handler.handleSend('m1', { conversationId: 'c1', message: 'one' }, emit);
    current = 'v2 rules';
    await handler.handleSend('m2', { conversationId: 'c2', message: 'two' }, emit);

    expect(requests[0]!.system).toContain('v1 rules');
    expect(requests[1]!.system).toContain('v2 rules');
  });
});
