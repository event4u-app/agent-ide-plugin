import { describe, expect, it } from 'vitest';
import { PricingBook } from '../pricing/loader.js';
import type { StepEvent } from '../tracking/db.js';
import { DefaultCostReporter, summarizeCostReport } from './report.js';

/**
 * ADR-035 — the `costReport` aggregation that backs the Cost Dashboard (T-707).
 * Pure over recorded steps; `byMode` splits real (api) from shadow (cli), and
 * the explicit CLI shadow figure comes from `summarizeShadowCost`.
 */

const PRICES = `
version: 3
last_updated: '2026-06-01'
currency: USD
models:
  - id: m-api
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
  - id: m-cli
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

function step(
  partial: Partial<StepEvent> & Pick<StepEvent, 'ts' | 'mode' | 'model' | 'usd'>,
): StepEvent {
  return {
    conversation_id: 'c1',
    step_index: 0,
    activity: 'chat',
    stop_reason: 'end_turn',
    input_tokens: 1_000_000,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    pricing_book_version: 3,
    duration_ms: 100,
    ...partial,
  };
}

const STEPS: StepEvent[] = [
  step({ ts: '2026-06-01T08:00:00.000Z', mode: 'api', model: 'm-api', activity: 'chat', usd: 1.0 }),
  step({
    ts: '2026-06-02T08:00:00.000Z',
    mode: 'api',
    model: 'm-api',
    activity: 'agent',
    usd: 2.0,
  }),
  // CLI step: stored usd is the shadow figure; 1M input tokens @ $3/MTok = $3.00.
  step({
    ts: '2026-06-03T08:00:00.000Z',
    mode: 'cli',
    model: 'm-cli',
    activity: 'agent',
    usd: 3.0,
  }),
];

describe('summarizeCostReport', () => {
  it('totals book-rate usd and groups by activity / mode / model', () => {
    const book = PricingBook.parse(PRICES);
    const r = summarizeCostReport(STEPS, {}, book);
    expect(r.stepCount).toBe(3);
    expect(r.totalUsd).toBeCloseTo(6.0);
    expect(r.byActivity.chat).toBeCloseTo(1.0);
    expect(r.byActivity.agent).toBeCloseTo(5.0);
    expect(r.byMode.api).toBeCloseTo(3.0); // real spend
    expect(r.byMode.cli).toBeCloseTo(3.0); // shadow value
    expect(r.byModel['m-api']).toBeCloseTo(3.0);
    expect(r.byModel['m-cli']).toBeCloseTo(3.0);
  });

  it('computes the CLI-only shadow cost from token counts (api excluded)', () => {
    const book = PricingBook.parse(PRICES);
    const r = summarizeCostReport(STEPS, {}, book);
    expect(r.cliStepCount).toBe(1);
    expect(r.shadowApiUsd).toBeCloseTo(3.0); // 1M input @ $3/MTok
  });

  it('applies the inclusive since/until window (matches totalUsd semantics)', () => {
    const book = PricingBook.parse(PRICES);
    const r = summarizeCostReport(
      STEPS,
      { since: '2026-06-02T00:00:00.000Z', until: '2026-06-02T23:59:59.000Z' },
      book,
    );
    expect(r.stepCount).toBe(1);
    expect(r.totalUsd).toBeCloseTo(2.0);
    expect(r.cliStepCount).toBe(0);
  });

  it('reports zero shadow but still counts cli steps when no book is supplied', () => {
    const r = summarizeCostReport(STEPS);
    expect(r.totalUsd).toBeCloseTo(6.0);
    expect(r.shadowApiUsd).toBe(0);
    expect(r.cliStepCount).toBe(1);
  });

  it('is empty over an empty trail', () => {
    const r = summarizeCostReport([], {}, PricingBook.parse(PRICES));
    expect(r.stepCount).toBe(0);
    expect(r.totalUsd).toBe(0);
    expect(r.byActivity).toEqual({});
  });
});

describe('DefaultCostReporter', () => {
  it('reads the trail then aggregates it', async () => {
    const reporter = new DefaultCostReporter(
      { readSteps: async () => STEPS },
      PricingBook.parse(PRICES),
    );
    const r = await reporter.report();
    expect(r.stepCount).toBe(3);
    expect(r.shadowApiUsd).toBeCloseTo(3.0);
  });
});
