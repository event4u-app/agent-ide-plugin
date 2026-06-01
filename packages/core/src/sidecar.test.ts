import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Envelope, LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from './llm/backend.js';
import { ProviderRegistry, type ProviderSpec } from './llm/provider-registry.js';
import { InMemoryConversationStore } from './chat/store.js';
import { buildCoreDispatcher } from './sidecar.js';

/** A backend that streams fixed chunks then a stop event. */
function scriptedBackend(chunks: string[]): LlmBackend {
  return {
    id: 'fake',
    mode: 'api',
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      for (const text of chunks) yield { kind: 'text_delta', text };
      yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 2 } };
    },
  };
}

const scriptedSpec = (chunks: string[]): ProviderSpec => ({
  id: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  modelEnv: 'EVENT4U_ANTHROPIC_MODEL',
  build: () => scriptedBackend(chunks),
});

const sendEnv = (conversationId: string, message: string): Envelope => ({
  messageId: 's1',
  messageType: 'chatSend',
  data: { conversationId, message },
  done: true,
});

describe('buildCoreDispatcher — chatSend wiring', () => {
  it('answers chatSend (no longer chat_not_configured) and streams tokens', async () => {
    const registry = new ProviderRegistry({
      env: {},
      providers: [scriptedSpec(['Hello', ', ', 'world'])],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({
      registry,
      store: new InMemoryConversationStore(),
    });

    const streamed: Envelope[] = [];
    const terminal = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => streamed.push(e));

    expect(terminal.messageType).toBe('chatSend');
    expect(terminal.done).toBe(true);
    const data = terminal.data as { text: string };
    expect(data.text).toBe('Hello, world');
    // Tokens arrived as done:false envelopes.
    expect(streamed.map((e) => (e.data as { token: string }).token)).toEqual([
      'Hello',
      ', ',
      'world',
    ]);
  });

  it('persists the turn in the wired store', async () => {
    const store = new InMemoryConversationStore();
    const registry = new ProviderRegistry({
      env: {},
      providers: [scriptedSpec(['ok'])],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({ registry, store });

    await dispatcher.dispatch(sendEnv('c2', 'question'), () => {});
    const convo = await store.load('c2');
    expect(convo?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(convo?.messages[0]?.content).toBe('question');
    expect(convo?.messages[1]?.content).toBe('ok');
  });

  it('surfaces provider_not_configured when the default provider is unconfigured', async () => {
    const registry = new ProviderRegistry({
      env: {},
      providers: [
        {
          id: 'anthropic',
          defaultModel: 'm',
          modelEnv: 'X',
          build: () => {
            throw new Error('missing API key: set ANTHROPIC_API_KEY');
          },
        },
      ],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({ registry, store: new InMemoryConversationStore() });

    const terminal = await dispatcher.dispatch(sendEnv('c3', 'hi'), () => {});
    expect(terminal.messageType).toBe('error');
    expect((terminal.data as { code: string }).code).toBe('provider_not_configured');
  });

  it('wires a daily-budget tracker from the cost option and surfaces a status (T-PRD06)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event4u-cost-'));
    const registry = new ProviderRegistry({
      env: {},
      providers: [scriptedSpec(['ok'])],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({
      registry,
      store: new InMemoryConversationStore(),
      cwd: dir,
      cost: { dailyBudgetUsd: 10 },
    });

    const terminal = await dispatcher.dispatch(sendEnv('c4', 'hi'), () => {});
    const data = terminal.data as { budget?: { limitUsd: number | null } };
    expect(data.budget).toBeDefined();
    expect(data.budget!.limitUsd).toBe(10);
  });
});
