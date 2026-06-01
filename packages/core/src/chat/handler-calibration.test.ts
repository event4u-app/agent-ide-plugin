import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChatSendResponse,
  Envelope,
  LlmRequest,
  LlmStreamEvent,
} from '@event4u-agent/protocol';
import { CalibrationLog, type ReconcileInput } from '../cost/reconcile.js';
import type { LlmBackend } from '../llm/backend.js';
import { PricingBook } from '../pricing/loader.js';
import { Dispatcher } from '../server.js';
import { ChatHandler } from './handler.js';
import { InMemoryConversationStore } from './store.js';

/**
 * T-706 wiring — calibration-drift reconciliation into the chat handler.
 *
 * Covers the AI-council 2026-06-02 decisions (ADR-036, UNANIMOUS A0–A6): the
 * handler reconciles a turn's REAL cost against its pre-flight estimate at the
 * finalize point (A1/A2), drift covers api real cost AND cli shadow cost
 * (A4), a cancelled turn is skipped (A5), a turn with no estimate is skipped
 * (A6), and a reconcile error is fail-open (never breaks the turn).
 *
 * Pricing has no cache rates → upper bound = inputFull + maxOut(2048)·outRate.
 * With `countInputTokens: 1` the upper bound ≈ $0.0307, so its ×1.5 drift
 * threshold ≈ $0.046; a turn whose real output is 100k tokens costs ≈ $1.50 and
 * reliably trips the threshold. The default `{10,5}` usage costs ≈ $0.0001 and
 * stays well within range.
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

const CLOCK = () => '2026-06-02T12:00:00.000Z';
const DRIFT_USAGE = { input_tokens: 1, output_tokens: 100_000 }; // ≈ $1.50 real

function backendWith(opts: {
  chunks?: string[];
  usage?: { input_tokens: number; output_tokens: number };
  mode?: 'api' | 'cli';
  countInputTokens?: number | undefined;
}): LlmBackend {
  const chunks = opts.chunks ?? ['hi'];
  const usage = opts.usage ?? { input_tokens: 10, output_tokens: 5 };
  const backend: LlmBackend = {
    id: 'fake',
    mode: opts.mode ?? 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      for (const text of chunks) yield { kind: 'text_delta', text };
      yield { kind: 'stop', reason: 'end_turn', usage };
    },
  };
  if (opts.countInputTokens !== undefined) {
    backend.countInputTokens = async () => opts.countInputTokens;
  }
  return backend;
}

/** A spy standing in for the concrete CalibrationLog so "not called" / "throws"
 * paths are assertable without touching disk. */
function spyCalibration(opts: { throwOnReconcile?: boolean } = {}): {
  calibration: CalibrationLog;
  calls: ReconcileInput[];
} {
  const calls: ReconcileInput[] = [];
  const fake = {
    async reconcile(input: ReconcileInput) {
      calls.push(input);
      if (opts.throwOnReconcile) throw new Error('disk full');
      return undefined;
    },
  };
  return { calibration: fake as unknown as CalibrationLog, calls };
}

const sendEnv = (conversationId: string, message: string): Envelope => ({
  messageId: 's1',
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
  calibration?: CalibrationLog,
  withPricing = true,
): { dispatcher: Dispatcher } {
  let n = 0;
  const store = new InMemoryConversationStore({ idFactory: () => `id-${++n}` });
  const handler = new ChatHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store,
    pricing: withPricing ? PricingBook.parse(PRICES) : undefined,
    ...(calibration ? { calibration } : {}),
  });
  return { dispatcher: new Dispatcher(undefined, handler) };
}

describe('ChatHandler — calibration-drift reconciliation (T-706, ADR-036)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-handler-calib-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('logs a calibration event when the real cost overruns the estimate (A1/A2)', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: CLOCK });
    const { dispatcher } = build(backendWith({ countInputTokens: 1, usage: DRIFT_USAGE }), log);

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    const day = await log.readDay('2026-06-02');
    expect(day).toHaveLength(1);
    expect(day[0]!.conversation_id).toBe('c1');
    expect(day[0]!.model).toBe('test-model');
    expect(day[0]!.real_usd).toBeCloseTo(res.cost.totalUsd, 9);
    expect(day[0]!.drift_ratio).toBeGreaterThan(1.5);
  });

  it('writes NO event when the turn stays within the estimate (no drift)', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: CLOCK });
    // Default {10,5} usage ≈ $0.0001, far under the ≈ $0.05 threshold.
    const { dispatcher } = build(backendWith({ countInputTokens: 1000 }), log);

    await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(await log.readDay('2026-06-02')).toHaveLength(0);
  });

  it('reconciles a CLI shadow turn too — drift is an accuracy signal, not billing (A4)', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: CLOCK });
    const { dispatcher } = build(
      backendWith({ mode: 'cli', countInputTokens: 1, usage: DRIFT_USAGE }),
      log,
    );

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;
    expect(res.cost.isEstimate).toBe(true); // CLI shadow cost

    const day = await log.readDay('2026-06-02');
    expect(day).toHaveLength(1); // shadow cost still reconciled
    expect(day[0]!.real_usd).toBeCloseTo(res.cost.totalUsd, 9);
  });

  it('skips a cancelled turn even when drift would apply (A5)', async () => {
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
      countInputTokens: async () => 1,
      async *stream(_req: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: 'Par' };
        reached();
        await gate;
        if (signal?.aborted) return;
        yield { kind: 'stop', reason: 'end_turn', usage: DRIFT_USAGE };
      },
    };
    const spy = spyCalibration();
    const { dispatcher } = build(backend, spy.calibration);

    const sendP = dispatcher.dispatch(sendEnv('c1', 'go'), () => {});
    await reachedP;
    await dispatcher.dispatch(cancelEnv('c1'));
    release();
    const final = await sendP;

    expect((final.data as ChatSendResponse).cancelled).toBe(true);
    expect(spy.calls).toEqual([]); // cancelled → never reconciled
  });

  it('skips a turn that produced no pre-flight estimate (A6)', async () => {
    // No countInputTokens → no estimate range, despite a huge real cost.
    const spy = spyCalibration();
    const { dispatcher } = build(
      backendWith({ countInputTokens: undefined, usage: DRIFT_USAGE }),
      spy.calibration,
    );

    await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});

    expect(spy.calls).toEqual([]); // no estimate → nothing to reconcile against
  });

  it('fails open when reconcile throws — the turn still completes', async () => {
    const spy = spyCalibration({ throwOnReconcile: true });
    const { dispatcher } = build(
      backendWith({ chunks: ['fine'], countInputTokens: 1, usage: DRIFT_USAGE }),
      spy.calibration,
    );

    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    const res = final.data as ChatSendResponse;

    expect(final.messageType).toBe('chatSend'); // not an error — the turn ran
    expect(res.text).toBe('fine');
    expect(spy.calls).toHaveLength(1); // reconcile was attempted
  });

  it('is a no-op when no calibration log is injected', async () => {
    const { dispatcher } = build(backendWith({ countInputTokens: 1, usage: DRIFT_USAGE }));
    const final = await dispatcher.dispatch(sendEnv('c1', 'hi'), () => {});
    expect(final.messageType).toBe('chatSend');
    expect((final.data as ChatSendResponse).text).toBe('hi');
  });
});
