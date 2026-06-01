import { describe, expect, it } from 'vitest';
import type { Envelope, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from '../llm/backend.js';
import { PricingBook } from '../pricing/loader.js';
import type { StepEvent } from '../tracking/db.js';
import type { StepRecorder } from '../tracking/step-recorder.js';
import { Dispatcher } from '../server.js';
import { ChatHandler } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/**
 * ADR-035 — live step-event recording in the chat turn. The handler persists
 * ONE priced StepEvent per turn at the same finalize point as recordSpend, only
 * when a pricing book + known model are present, fail-open.
 */

const PRICES = `
version: 5
last_updated: '2026-06-01'
currency: USD
models:
  - id: test-model
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

function backendWith(opts: {
  mode?: 'api' | 'cli';
  usage?: { input_tokens: number; output_tokens: number };
  errorCode?: string;
}): LlmBackend {
  const usage = opts.usage ?? { input_tokens: 10, output_tokens: 5 };
  return {
    id: 'fake',
    mode: opts.mode ?? 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      yield { kind: 'text_delta', text: 'hi' };
      if (opts.errorCode) {
        yield { kind: 'error', code: opts.errorCode, message: 'boom' };
        return;
      }
      yield { kind: 'stop', reason: 'end_turn', usage };
    },
  };
}

function spyStep(): { recorder: StepRecorder; written: StepEvent[] } {
  const written: StepEvent[] = [];
  return {
    recorder: {
      async writeStep(e) {
        written.push(e);
      },
    },
    written,
  };
}

const sendEnv = (conversationId: string, message: string, messageId = 's1'): Envelope => ({
  messageId,
  messageType: 'chatSend',
  data: { conversationId, message },
  done: true,
});

function build(
  backend: LlmBackend,
  step?: StepRecorder,
  withPricing = true,
): { dispatcher: Dispatcher } {
  let n = 0;
  const store = new InMemoryConversationStore({ idFactory: () => `id-${++n}` });
  const handler = new ChatHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store,
    pricing: withPricing ? PricingBook.parse(PRICES) : undefined,
    ...(step ? { step } : {}),
  });
  return { dispatcher: new Dispatcher(undefined, handler) };
}

describe('ChatHandler — step recording (ADR-035)', () => {
  it('records exactly one priced step for an api turn', async () => {
    const spy = spyStep();
    const { dispatcher } = build(backendWith({}), spy.recorder);

    await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(spy.written).toHaveLength(1);
    const ev = spy.written[0]!;
    expect(ev.activity).toBe('chat');
    expect(ev.mode).toBe('api');
    expect(ev.model).toBe('test-model');
    expect(ev.step_index).toBe(0); // first turn
    expect(ev.pricing_book_version).toBe(5);
    expect(ev.usd).toBeCloseTo(0.000105, 9);
    expect(ev.stop_reason).toBe('end_turn');
  });

  it('records a cli turn with its shadow usd', async () => {
    const spy = spyStep();
    const { dispatcher } = build(backendWith({ mode: 'cli' }), spy.recorder);

    await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(spy.written).toHaveLength(1);
    expect(spy.written[0]!.mode).toBe('cli');
    expect(spy.written[0]!.usd).toBeGreaterThan(0); // book-rate shadow figure
  });

  it('increments step_index across turns (derived from persisted history)', async () => {
    const spy = spyStep();
    const { dispatcher } = build(backendWith({}), spy.recorder);

    await dispatcher.dispatch(sendEnv('c1', 'one', 's1'), () => {});
    await dispatcher.dispatch(sendEnv('c1', 'two', 's2'), () => {});

    expect(spy.written.map((e) => e.step_index)).toEqual([0, 1]);
  });

  it('does NOT record when the backend errors mid-turn', async () => {
    const spy = spyStep();
    const { dispatcher } = build(backendWith({ errorCode: 'overloaded_error' }), spy.recorder);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(final.messageType).toBe('error');
    expect(spy.written).toEqual([]);
  });

  it('skips recording when no pricing book is configured (no version to record)', async () => {
    const spy = spyStep();
    const { dispatcher } = build(backendWith({}), spy.recorder, false);

    await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(spy.written).toEqual([]);
  });

  it('skips recording for an unknown model (no known price → no version)', async () => {
    const spy = spyStep();
    let n = 0;
    const store = new InMemoryConversationStore({ idFactory: () => `id-${++n}` });
    const handler = new ChatHandler({
      resolveBackend: () => backendWith({}),
      resolveModel: () => 'unknown-model',
      store,
      pricing: PricingBook.parse(PRICES),
      step: spy.recorder,
    });
    const dispatcher = new Dispatcher(undefined, handler);

    await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(spy.written).toEqual([]);
  });

  it('fail-open: a recorder write error never breaks the turn', async () => {
    const failing: StepRecorder = {
      async writeStep() {
        throw new Error('disk full');
      },
    };
    const { dispatcher } = build(backendWith({}), failing);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(final.messageType).toBe('chatSend'); // turn still completed
  });
});
