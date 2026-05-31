import { describe, expect, it } from 'vitest';
import type {
  ChatSendResponse,
  Envelope,
  LlmRequest,
  LlmStreamEvent,
} from '@event4u-agent/protocol';
import type { LlmBackend } from '../llm/backend.js';
import { PricingBook } from '../pricing/loader.js';
import { Dispatcher } from '../server.js';
import { ChatHandler } from './handler.js';
import { InMemoryConversationStore } from './store.js';

const PRICES = `
version: 1
last_updated: '2026-05-31'
currency: USD
models:
  - id: test-model
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

/** A backend that streams a fixed list of text chunks then a stop event. */
function scriptedBackend(
  chunks: string[],
  usage = { input_tokens: 10, output_tokens: 5 },
  mode: 'api' | 'cli' = 'api',
): LlmBackend {
  return {
    id: 'fake',
    mode,
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      for (const text of chunks) yield { kind: 'text_delta', text };
      yield { kind: 'stop', reason: 'end_turn', usage };
    },
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function defer(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sendEnv = (conversationId: string, message: string, messageId = 's1'): Envelope => ({
  messageId,
  messageType: 'chatSend',
  data: { conversationId, message },
  done: true,
});

const cancelEnv = (conversationId: string, messageId = 'x1'): Envelope => ({
  messageId,
  messageType: 'chatCancel',
  data: { conversationId },
  done: true,
});

function makeDispatcher(
  backend: LlmBackend,
  withPricing = true,
): {
  dispatcher: Dispatcher;
  store: InMemoryConversationStore;
} {
  let n = 0;
  const store = new InMemoryConversationStore({ idFactory: () => `id-${++n}` });
  const handler = new ChatHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store,
    pricing: withPricing ? PricingBook.parse(PRICES) : undefined,
  });
  return { dispatcher: new Dispatcher(undefined, handler), store };
}

describe('ChatHandler — streamed turn (T-VS03 / T-VS04, exit gate)', () => {
  it('streams tokens in order, then a terminal usage+cost envelope', async () => {
    const { dispatcher, store } = makeDispatcher(scriptedBackend(['Hello', ', ', 'world']));
    const emitted: Envelope[] = [];

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => emitted.push(e));

    // Intermediate envelopes — one per token, `done:false`, in order.
    expect(emitted.every((e) => e.done === false && e.messageType === 'chatSend')).toBe(true);
    expect(emitted.map((e) => (e.data as { token: string }).token)).toEqual([
      'Hello',
      ', ',
      'world',
    ]);

    // Terminal envelope — the full result with usage + cost.
    expect(final.done).toBe(true);
    expect(final.messageId).toBe('s1');
    const res = final.data as ChatSendResponse;
    expect(res.text).toBe('Hello, world');
    expect(res.cancelled).toBe(false);
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.cost.model).toBe('test-model');
    expect(res.cost.mode).toBe('api');
    expect(res.cost.isEstimate).toBe(false);
    // 10/1e6*3 + 5/1e6*15 = 0.000105
    expect(res.cost.totalUsd).toBeCloseTo(0.000105, 9);

    // The turn is persisted: user + assistant.
    const convo = await store.load('c1');
    expect(convo?.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello, world'],
    ]);
  });

  it('reports a $0 estimate when no pricing book is configured', async () => {
    const { dispatcher } = makeDispatcher(scriptedBackend(['x']), false);
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;
    expect(res.cost.totalUsd).toBe(0);
    expect(res.cost.isEstimate).toBe(true);
  });

  it('marks CLI-mode cost as a shadow estimate', async () => {
    const { dispatcher } = makeDispatcher(
      scriptedBackend(['x'], { input_tokens: 10, output_tokens: 5 }, 'cli'),
    );
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;
    expect(res.cost.mode).toBe('cli');
    expect(res.cost.isEstimate).toBe(true);
    expect(res.cost.totalUsd).toBeCloseTo(0.000105, 9);
  });

  it('rejects a concurrent send for the same conversation with chat_busy', async () => {
    const blocked = defer();
    const reached = defer();
    const backend: LlmBackend = {
      id: 'gated',
      mode: 'api',
      async *stream(): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: 'A' };
        reached.resolve();
        await blocked.promise;
        yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    const { dispatcher } = makeDispatcher(backend);

    const firstP = dispatcher.dispatch(sendEnv('c1', 'first'), () => {});
    await reached.promise;
    const busy = await dispatcher.dispatch(sendEnv('c1', 'second', 's2'));
    expect(busy.messageType).toBe('error');
    expect(busy.data).toMatchObject({ code: 'chat_busy' });

    blocked.resolve();
    await firstP;
  });
});

describe('ChatHandler — cancellation (T-VS02)', () => {
  it('aborts mid-stream, keeps + persists the partial text', async () => {
    const blocked = defer();
    const reached = defer();
    const backend: LlmBackend = {
      id: 'gated',
      mode: 'api',
      async *stream(_request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: 'Par' };
        reached.resolve();
        await blocked.promise;
        if (signal?.aborted) return;
        yield { kind: 'text_delta', text: 'tial' };
        yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 9 } };
      },
    };
    const { dispatcher, store } = makeDispatcher(backend);
    const emitted: Envelope[] = [];

    const sendP = dispatcher.dispatch(sendEnv('c-cancel', 'stop me'), (e) => emitted.push(e));
    await reached.promise;
    expect(emitted.map((e) => (e.data as { token: string }).token)).toEqual(['Par']);

    const cancel = await dispatcher.dispatch(cancelEnv('c-cancel'));
    expect(cancel.data).toEqual({ cancelled: true });

    blocked.resolve();
    const final = await sendP;
    const res = final.data as ChatSendResponse;
    expect(res.cancelled).toBe(true);
    expect(res.stopReason).toBe('cancelled');
    expect(res.text).toBe('Par');

    const convo = await store.load('c-cancel');
    expect(convo?.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'stop me'],
      ['assistant', 'Par'],
    ]);
  });

  it('chatCancel returns cancelled:false when nothing is in flight', async () => {
    const { dispatcher } = makeDispatcher(scriptedBackend(['x']));
    const res = await dispatcher.dispatch(cancelEnv('nope'));
    expect(res.data).toEqual({ cancelled: false });
  });
});

describe('Dispatcher — chatSend without a handler', () => {
  it('returns chat_not_configured rather than crashing', async () => {
    const dispatcher = new Dispatcher();
    const res = await dispatcher.dispatch(sendEnv('c1', 'hi'));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'chat_not_configured' });
  });
});
