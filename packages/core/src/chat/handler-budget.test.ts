import { describe, expect, it } from 'vitest';
import type {
  ChatSendResponse,
  Envelope,
  LlmRequest,
  LlmStreamEvent,
} from '@event4u-agent/protocol';
import type { BudgetRecorder, BudgetStatus } from '../cost/budget.js';
import type { LlmBackend } from '../llm/backend.js';
import { PricingBook } from '../pricing/loader.js';
import { Dispatcher } from '../server.js';
import { ChatHandler } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/**
 * T-PRD06 — cost & budget wiring into the chat handler.
 *
 * Covers the AI-council 2026-06-01 decisions: pre-send estimate as an early
 * `done:false` envelope (B1), injected recorder (B-inj), flag-not-block
 * (B-warn), and the correctness traps (record exactly once, never on a thrown
 * error, fail-open, no debit for shadow/unpriced turns).
 */

const PRICES = `
version: 1
last_updated: '2026-06-01'
currency: USD
models:
  - id: test-model
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

/** A backend that streams text chunks, a stop with usage, and CAN count tokens. */
function backendWith(opts: {
  chunks?: string[];
  usage?: { input_tokens: number; output_tokens: number };
  mode?: 'api' | 'cli';
  countInputTokens?: number | undefined;
  /** When set, the stream yields an error event instead of stopping cleanly. */
  errorCode?: string;
}): LlmBackend {
  const chunks = opts.chunks ?? ['hi'];
  const usage = opts.usage ?? { input_tokens: 10, output_tokens: 5 };
  const backend: LlmBackend = {
    id: 'fake',
    mode: opts.mode ?? 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      for (const text of chunks) yield { kind: 'text_delta', text };
      if (opts.errorCode) {
        yield { kind: 'error', code: opts.errorCode, message: 'boom' };
        return;
      }
      yield { kind: 'stop', reason: 'end_turn', usage };
    },
  };
  if (opts.countInputTokens !== undefined) {
    backend.countInputTokens = async () => opts.countInputTokens;
  }
  return backend;
}

/** A spying recorder so tests can assert the exact debit cadence. */
function spyRecorder(
  opts: { initial?: number; limit?: number | null; throwOnRecord?: boolean } = {},
): {
  recorder: BudgetRecorder;
  records: number[];
  statusCalls: number;
} {
  let spent = opts.initial ?? 0;
  const limit = opts.limit ?? null;
  const records: number[] = [];
  let statusCalls = 0;
  const build = (): BudgetStatus => {
    const ratio = limit === null ? null : limit > 0 ? spent / limit : spent > 0 ? Infinity : 0;
    return {
      date: '2026-06-01',
      spentUsd: spent,
      limitUsd: limit,
      remainingUsd: limit === null ? null : Math.max(0, limit - spent),
      ratio,
      overBudget: limit !== null && spent > limit,
      warning: ratio !== null && ratio >= 0.8,
    };
  };
  const recorder: BudgetRecorder = {
    async record(usd: number): Promise<BudgetStatus> {
      if (opts.throwOnRecord) throw new Error('disk full');
      records.push(usd);
      spent += usd;
      return build();
    },
    async status(): Promise<BudgetStatus> {
      statusCalls += 1;
      return build();
    },
  };
  return {
    recorder,
    records,
    get statusCalls() {
      return statusCalls;
    },
  };
}

const sendEnv = (conversationId: string, message: string, messageId = 's1'): Envelope => ({
  messageId,
  messageType: 'chatSend',
  data: { conversationId, message },
  done: true,
});

const cancelEnv = (conversationId: string): Envelope => ({
  messageId: 'x1',
  messageType: 'chatCancel',
  data: { conversationId },
  done: true,
});

function build(
  backend: LlmBackend,
  budget?: BudgetRecorder,
  withPricing = true,
): { dispatcher: Dispatcher } {
  let n = 0;
  const store = new InMemoryConversationStore({ idFactory: () => `id-${++n}` });
  const handler = new ChatHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store,
    pricing: withPricing ? PricingBook.parse(PRICES) : undefined,
    ...(budget ? { budget } : {}),
  });
  return { dispatcher: new Dispatcher(undefined, handler) };
}

describe('ChatHandler — pre-send estimate (T-PRD06, B1)', () => {
  it('emits a done:false estimate envelope BEFORE the first token', async () => {
    const { dispatcher } = build(backendWith({ chunks: ['a', 'b'], countInputTokens: 1000 }));
    const emitted: Envelope[] = [];

    await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => emitted.push(e));

    const first = emitted[0]!;
    expect(first.done).toBe(false);
    expect(first.messageType).toBe('chatSend');
    const estimate = (first.data as { estimate?: Record<string, number | string> }).estimate;
    expect(estimate).toBeDefined();
    expect(estimate!.model).toBe('test-model');
    expect(estimate!.inputTokens).toBe(1000);
    expect(estimate!.lowerUsd as number).toBeGreaterThan(0);
    expect(estimate!.upperUsd as number).toBeGreaterThan(estimate!.lowerUsd as number);
    expect(estimate!.typicalUsd as number).toBeGreaterThanOrEqual(estimate!.lowerUsd as number);
    expect(estimate!.typicalUsd as number).toBeLessThanOrEqual(estimate!.upperUsd as number);

    // The remaining envelopes are token chunks — exactly one estimate, emitted first.
    const estimateCount = emitted.filter(
      (e) => (e.data as { estimate?: unknown }).estimate !== undefined,
    ).length;
    expect(estimateCount).toBe(1);
    expect(emitted.slice(1).map((e) => (e.data as { token?: string }).token)).toEqual(['a', 'b']);
  });

  it('skips the estimate when the backend cannot count tokens', async () => {
    const { dispatcher } = build(backendWith({ chunks: ['a'], countInputTokens: undefined }));
    const emitted: Envelope[] = [];
    await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => emitted.push(e));
    expect(emitted.every((e) => (e.data as { estimate?: unknown }).estimate === undefined)).toBe(
      true,
    );
  });

  it('skips the estimate when the model is unpriced', async () => {
    const { dispatcher } = build(
      backendWith({ chunks: ['a'], countInputTokens: 1000 }),
      undefined,
      false, // no pricing book
    );
    const emitted: Envelope[] = [];
    await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => emitted.push(e));
    expect(emitted.every((e) => (e.data as { estimate?: unknown }).estimate === undefined)).toBe(
      true,
    );
  });
});

describe('ChatHandler — budget recording (T-PRD06, B-inj / B-warn)', () => {
  it('records actual spend exactly once for an api turn and surfaces the status', async () => {
    const spy = spyRecorder({ limit: 1 });
    const { dispatcher } = build(backendWith({}), spy.recorder);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    // 10/1e6*3 + 5/1e6*15 = 0.000105
    expect(spy.records).toEqual([res.cost.totalUsd]);
    expect(spy.records[0]).toBeCloseTo(0.000105, 9);
    expect(res.budget).toBeDefined();
    expect(res.budget!.spentUsd).toBeCloseTo(0.000105, 9);
    expect(res.budget!.limitUsd).toBe(1);
    expect(res.budget!.overBudget).toBe(false);
  });

  it('does not debit a real budget for a CLI shadow turn (status only)', async () => {
    const spy = spyRecorder({ initial: 0.5, limit: 1 });
    const { dispatcher } = build(backendWith({ mode: 'cli' }), spy.recorder);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    expect(res.cost.isEstimate).toBe(true); // CLI shadow
    expect(spy.records).toEqual([]); // never debited
    expect(spy.statusCalls).toBe(1); // status read
    expect(res.budget!.spentUsd).toBe(0.5); // unchanged
  });

  it('flags overBudget without blocking the turn (B-warn)', async () => {
    const spy = spyRecorder({ initial: 5, limit: 1 }); // already over
    const { dispatcher } = build(backendWith({ chunks: ['ok'] }), spy.recorder);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    expect(final.messageType).toBe('chatSend'); // not an error — the turn ran
    expect(res.text).toBe('ok');
    expect(res.budget!.overBudget).toBe(true);
    expect(res.budget!.warning).toBe(true);
  });

  it('does NOT record spend when the backend errors mid-turn', async () => {
    const spy = spyRecorder({ limit: 1 });
    const { dispatcher } = build(backendWith({ errorCode: 'overloaded_error' }), spy.recorder);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(final.messageType).toBe('error');
    expect(final.data).toMatchObject({ code: 'overloaded_error' });
    expect(spy.records).toEqual([]); // errored turn never debits
    expect(spy.statusCalls).toBe(0);
  });

  it('records at most once on a mid-stream cancel (no ghost double-count)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let reached!: () => void;
    const reachedP = new Promise<void>((r) => {
      reached = r;
    });
    const backend: LlmBackend = {
      id: 'gated',
      mode: 'api',
      async *stream(_req: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: 'Par' };
        reached();
        await gate;
        if (signal?.aborted) return; // cancelled before any stop/usage event
        yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    const spy = spyRecorder({ limit: 1 });
    const { dispatcher } = build(backend, spy.recorder);

    const sendP = dispatcher.dispatch(sendEnv('c1', 'go'), () => {});
    await reachedP;
    await dispatcher.dispatch(cancelEnv('c1'));
    release();
    const final = await sendP;
    const res = final.data as ChatSendResponse;

    expect(res.cancelled).toBe(true);
    // Cancelled before usage arrived → $0 cost → status-only, never a debit.
    expect(spy.records).toEqual([]);
    expect(res.budget).toBeDefined();
  });

  it('fails open when the recorder throws — the turn still completes', async () => {
    const spy = spyRecorder({ limit: 1, throwOnRecord: true });
    const { dispatcher } = build(backendWith({ chunks: ['fine'] }), spy.recorder);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    expect(final.messageType).toBe('chatSend');
    expect(res.text).toBe('fine');
    expect(res.budget).toBeUndefined(); // recorder failed → no status, but no crash
  });

  it('omits the budget field entirely when no recorder is injected', async () => {
    const { dispatcher } = build(backendWith({}));
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    expect((final.data as ChatSendResponse).budget).toBeUndefined();
  });
});
