import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTurnResponse, Envelope, LlmStreamEvent } from '@event4u-agent/protocol';
import { InMemoryConversationStore } from '../chat/store.js';
import type { LlmBackend } from '../llm/backend.js';
import { PermissionGate } from '../permissions/gate.js';
import { PricingBook } from '../pricing/loader.js';
import { CapsEvaluator, type CapsSettings } from '../tracking/caps.js';
import { buildDefaultToolRegistry } from './tool-registry.js';
import { AgentTurnHandler } from './turn-handler.js';

/**
 * T-411a host integration — pre-send cost-cap gate on the AGENT turn (ADR-041,
 * AI council 2026-06-02 UNANIMOUS Q0–Q6). The gate fires ONCE before the loop on
 * the iteration-1 projection: a `block` refuses the turn (`iterations: 0`), while
 * `warn`/`confirm` ride the pre-send estimate event and the loop runs.
 *
 * Pricing is 3 / 15 USD per Mtok; `countInputTokens: 1_000_000` + the 2048 output
 * cap project ≈ $3.03, above the $1.00 thresholds these tests configure.
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

function backendWith(countInputTokens: number): { backend: LlmBackend; streamed: () => boolean } {
  let didStream = false;
  const backend: LlmBackend = {
    id: 'fake',
    mode: 'api',
    async *stream(): AsyncIterable<LlmStreamEvent> {
      didStream = true;
      yield { kind: 'text_delta', text: 'hi' };
      yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
    },
    countInputTokens: async () => countInputTokens,
  };
  return { backend, streamed: () => didStream };
}

function evaluator(settings: Partial<CapsSettings>): CapsEvaluator {
  return new CapsEvaluator(
    { single_step: settings.single_step ?? {}, daily: settings.daily ?? {} },
    PricingBook.parse(PRICES),
  );
}

function buildHandler(
  backend: LlmBackend,
  workspaceRoot: string,
  capsEvaluator?: CapsEvaluator,
): AgentTurnHandler {
  return new AgentTurnHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'test-model',
    store: new InMemoryConversationStore(),
    gate: new PermissionGate({}),
    decide: () => Promise.resolve('allow_once'),
    registry: buildDefaultToolRegistry({ workspaceRoot }),
    pricing: PricingBook.parse(PRICES),
    ...(capsEvaluator ? { capsEvaluator } : {}),
  });
}

describe('AgentTurnHandler — pre-send cost-cap gate (T-411a, ADR-041)', () => {
  let ws: string;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'agent-caps-ws-'));
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it('refuses the turn before the loop on a block verdict (iterations 0, no stream)', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const handler = buildHandler(
      backend,
      ws,
      evaluator({ single_step: { hard_block_above_usd: 1 } }),
    );

    const events: Envelope[] = [];
    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, (e) =>
      events.push(e),
    );
    const res = final.data as AgentTurnResponse;

    expect(res.stopReason).toBe('cost_cap_blocked');
    expect(res.iterations).toBe(0);
    expect(res.text).toBe('');
    expect(res.changedFiles).toEqual([]);
    expect(res.cost.totalUsd).toBe(0);
    expect(res.cap?.verdict).toBe('block');
    expect(res.mode).toBe('edit'); // default mode still resolved + surfaced
    expect(streamed()).toBe(false);
    expect(events.some((e) => 'estimate' in (e.data as object))).toBe(false);
  });

  it('surfaces a warn verdict on the estimate event and runs the loop', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const handler = buildHandler(backend, ws, evaluator({ single_step: { warn_above_usd: 1 } }));

    const events: Envelope[] = [];
    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, (e) =>
      events.push(e),
    );
    const res = final.data as AgentTurnResponse;

    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect((estimateEvent!.data as { cap?: { verdict: string } }).cap?.verdict).toBe('warn');
    expect(res.text).toBe('hi');
    expect(res.iterations).toBe(1);
    expect(res.cap).toBeUndefined();
    expect(streamed()).toBe(true);
  });

  it('PROCEEDS on a confirm verdict (Q3=A — no IDE modal yet)', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const handler = buildHandler(backend, ws, evaluator({ single_step: { confirm_above_usd: 1 } }));

    const events: Envelope[] = [];
    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, (e) =>
      events.push(e),
    );
    const res = final.data as AgentTurnResponse;

    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect((estimateEvent!.data as { cap?: { verdict: string } }).cap?.verdict).toBe('confirm');
    expect(res.text).toBe('hi');
    expect(streamed()).toBe(true);
  });

  it('is inert when no caps evaluator is injected', async () => {
    const { backend } = backendWith(1_000_000);
    const handler = buildHandler(backend, ws);

    const events: Envelope[] = [];
    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, (e) =>
      events.push(e),
    );

    const estimateEvent = events.find((e) => 'estimate' in (e.data as object));
    expect((estimateEvent!.data as { cap?: unknown }).cap).toBeUndefined();
    expect((final.data as AgentTurnResponse).text).toBe('hi');
  });

  it('fails open when the evaluator throws — the loop still runs', async () => {
    const { backend, streamed } = backendWith(1_000_000);
    const throwing = {
      async evaluate(): Promise<never> {
        throw new Error('torn daily-spend read');
      },
    } as unknown as CapsEvaluator;
    const handler = buildHandler(backend, ws, throwing);

    const final = await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi' }, () => {});
    const res = final.data as AgentTurnResponse;

    expect(res.text).toBe('hi');
    expect(res.iterations).toBe(1);
    expect(streamed()).toBe(true);
  });
});
