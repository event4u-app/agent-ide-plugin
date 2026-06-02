import { describe, expect, it } from 'vitest';
import type { ChatSendResponse, Envelope, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from '../llm/backend.js';
import { PricingBook } from '../pricing/loader.js';
import { Dispatcher } from '../server.js';
import { CapsEvaluator, type CapsSettings } from '../tracking/caps.js';
import type { TrackingDb } from '../tracking/db.js';
import { ChatHandler } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/**
 * T-411a host integration — pre-send cost-cap gate on the chat turn (ADR-041,
 * AI council 2026-06-02 UNANIMOUS Q0–Q6).
 *
 * Pricing is 3 / 15 USD per Mtok. With `countInputTokens: 1_000_000` and the
 * default 2048 output cap the projected upper bound ≈ $3.03 — well above the
 * $1.00 thresholds these tests configure, so single_step caps fire reliably.
 */

const PRICES = `
version: 1
last_updated: '2026-06-02'
currency: USD
models:
  - id: test-model
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

/** A backend that records whether its stream was ever consumed (= a turn ran). */
function backendWith(countInputTokens: number | undefined): {
  backend: LlmBackend;
  streamed: () => boolean;
} {
  let didStream = false;
  const backend: LlmBackend = {
    id: 'fake',
    mode: 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      didStream = true;
      yield { kind: 'text_delta', text: 'hi' };
      yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
  if (countInputTokens !== undefined) {
    backend.countInputTokens = async () => countInputTokens;
  }
  return { backend, streamed: () => didStream };
}

const sendEnv = (conversationId: string, message: string): Envelope => ({
  messageId: 's1',
  messageType: 'chatSend',
  data: { conversationId, message },
  done: true,
});

function build(backend: LlmBackend, capsEvaluator?: CapsEvaluator): { dispatcher: Dispatcher } {
  let n = 0;
  const store = new InMemoryConversationStore({ idFactory: () => `id-${++n}` });
  const handler = new ChatHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store,
    pricing: PricingBook.parse(PRICES),
    ...(capsEvaluator ? { capsEvaluator } : {}),
  });
  return { dispatcher: new Dispatcher(undefined, handler) };
}

function evaluator(settings: Partial<CapsSettings>): CapsEvaluator {
  return new CapsEvaluator(
    { single_step: settings.single_step ?? {}, daily: settings.daily ?? {} },
    PricingBook.parse(PRICES),
  );
}

describe('ChatHandler — pre-send cost-cap gate (T-411a, ADR-041)', () => {
  it('refuses a turn on a block verdict — no stream, no spend (Q2=B)', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const { dispatcher } = build(backend, evaluator({ single_step: { hard_block_above_usd: 1 } }));

    const events: Envelope[] = [];
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => events.push(e));
    const res = final.data as ChatSendResponse;

    expect(res.stopReason).toBe('cost_cap_blocked');
    expect(res.text).toBe('');
    expect(res.cost.totalUsd).toBe(0);
    expect(res.cap?.verdict).toBe('block');
    expect(res.cap?.reason).toBe('single_step.hard_block_above_usd');
    expect(res.cap?.projectedUsd).toBeGreaterThan(1);
    expect(streamed()).toBe(false); // the provider was never called
    // A block emits NO pre-send estimate event (the turn is not running).
    expect(events.some((e) => 'estimate' in (e.data as object))).toBe(false);
  });

  it('surfaces a warn verdict on the estimate event and proceeds (Q1=A)', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const { dispatcher } = build(backend, evaluator({ single_step: { warn_above_usd: 1 } }));

    const events: Envelope[] = [];
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => events.push(e));
    const res = final.data as ChatSendResponse;

    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect(estimateEvent).toBeDefined();
    expect((estimateEvent!.data as { cap?: { verdict: string } }).cap?.verdict).toBe('warn');
    expect(res.text).toBe('hi'); // proceeded
    expect(res.stopReason).toBe('end_turn');
    expect(res.cap).toBeUndefined(); // terminal cap carries the block only
    expect(streamed()).toBe(true);
  });

  it('PROCEEDS on a confirm verdict (Q3=A — no IDE modal yet, surface + run)', async () => {
    const { backend } = backendWith(1_000_000);
    const { dispatcher } = build(backend, evaluator({ single_step: { confirm_above_usd: 1 } }));

    const events: Envelope[] = [];
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => events.push(e));
    const res = final.data as ChatSendResponse;

    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect((estimateEvent!.data as { cap?: { verdict: string } }).cap?.verdict).toBe('confirm');
    expect(res.text).toBe('hi'); // a confirm does NOT block pre-IDE
    expect(res.stopReason).toBe('end_turn');
  });

  it('is inert when no caps evaluator is injected (estimate carries no cap)', async () => {
    const { backend } = backendWith(1_000_000);
    const { dispatcher } = build(backend);

    const events: Envelope[] = [];
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => events.push(e));

    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect(estimateEvent).toBeDefined();
    expect((estimateEvent!.data as { cap?: unknown }).cap).toBeUndefined();
    expect((final.data as ChatSendResponse).text).toBe('hi');
  });

  it('fails open when the evaluator throws — turn still runs, estimate still emits', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const throwing = {
      async evaluate(): Promise<never> {
        throw new Error('torn daily-spend read');
      },
    } as unknown as CapsEvaluator;
    const { dispatcher } = build(backend, throwing);

    const events: Envelope[] = [];
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => events.push(e));
    const res = final.data as ChatSendResponse;

    expect(res.text).toBe('hi'); // not blocked
    expect(res.stopReason).toBe('end_turn');
    expect(streamed()).toBe(true);
    // The estimate survives an evaluator error (caps fail open independently).
    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect(estimateEvent).toBeDefined();
    expect((estimateEvent!.data as { cap?: unknown }).cap).toBeUndefined();
  });

  it('blocks on a daily hard cap once prior spend pushes the projection over (TrackingDb)', async () => {
    // A daily evaluator backed by a TrackingDb whose recorded spend already
    // exceeds the daily hard block → the projected turn pushes total over.
    const { backend, streamed } = backendWith(1);
    const trackingEvaluator = new CapsEvaluator(
      { single_step: {}, daily: { hard_block_above_usd: 100 } },
      PricingBook.parse(PRICES),
      { totalUsd: async () => 100 } as unknown as TrackingDb,
    );
    const { dispatcher } = build(backend, trackingEvaluator);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    expect(res.stopReason).toBe('cost_cap_blocked');
    expect(res.cap?.reason).toBe('daily.hard_block_above_usd');
    expect(res.cap?.spentTodayUsd).toBe(100);
    expect(streamed()).toBe(false);
  });
});
