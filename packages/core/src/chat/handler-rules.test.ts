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

function sink(): { emit: (e: Envelope) => void } {
  return { emit: () => {} };
}

describe('ChatHandler — always-active RULES folded into the system prompt (T-404, ADR-043)', () => {
  it('folds the loaded rules block into `system` even without guidelines', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadRules: async () => '## Rule: minimal-diff\n\nKeep diffs small.',
    });
    await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, sink().emit);

    expect(requests[0]!.system).toContain('<workspace-rules>');
    expect(requests[0]!.system).toContain('Keep diffs small.');
  });

  it('leads with rules ahead of guidelines (council Q5=A ordering)', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadGuidelines: async () => 'Prefer early returns.',
      loadRules: async () => '## Rule: r\n\nHard rule body.',
    });
    await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, sink().emit);

    const system = requests[0]!.system!;
    expect(system).toContain('<workspace-rules>');
    expect(system).toContain('<workspace-guidelines>');
    expect(system.indexOf('Hard rule body.')).toBeLessThan(system.indexOf('Prefer early returns.'));
  });

  it('omits `system` when neither rules, guidelines, nor context are wired', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
    });
    await handler.handleSend('m1', { conversationId: 'c1', message: 'hi' }, sink().emit);

    expect(requests[0]!.system).toBeUndefined();
  });

  it('fails open: a rules load error never breaks the turn', async () => {
    const { backend, requests } = capturingBackend();
    const handler = new ChatHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      loadRules: async () => {
        throw new Error('walk exploded');
      },
    });
    const terminal = await handler.handleSend(
      'm1',
      { conversationId: 'c1', message: 'hi' },
      sink().emit,
    );

    expect(terminal.done).toBe(true);
    expect(requests[0]!.system).toBeUndefined();
  });
});
