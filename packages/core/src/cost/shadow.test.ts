import { describe, expect, it } from 'vitest';
import { PricingBook } from '../pricing/loader.js';
import type { StepEvent } from '../tracking/db.js';
import { formatShadowCost, shadowApiCostForStep, summarizeShadowCost } from './shadow.js';

const BOOK = PricingBook.parse(`
version: 1
last_updated: '2026-05-31'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    cache_write_per_mtok: 3.75
    cache_read_per_mtok: 0.30
    context_window: 200000
`);

function step(partial: Partial<StepEvent> & Pick<StepEvent, 'mode' | 'model'>): StepEvent {
  return {
    ts: partial.ts ?? '2026-05-31T10:00:00.000Z',
    conversation_id: partial.conversation_id ?? 'c1',
    step_index: partial.step_index ?? 0,
    activity: partial.activity ?? 'cli-agent',
    mode: partial.mode,
    model: partial.model,
    stop_reason: partial.stop_reason ?? 'end_turn',
    input_tokens: partial.input_tokens ?? 0,
    output_tokens: partial.output_tokens ?? 0,
    cache_creation_input_tokens: partial.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: partial.cache_read_input_tokens ?? 0,
    usd: partial.usd ?? 0,
    pricing_book_version: partial.pricing_book_version ?? 1,
    duration_ms: partial.duration_ms ?? 0,
    meta: partial.meta,
  };
}

describe('shadowApiCostForStep', () => {
  it('prices a CLI step at the API rate', () => {
    // 1M input @ $3 + 1M output @ $15 = $18.00
    const cost = shadowApiCostForStep(
      BOOK,
      step({
        mode: 'cli',
        model: 'claude-sonnet-4-6',
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    );
    expect(cost).toBeCloseTo(18.0, 6);
  });

  it('returns 0 for an unknown model (fail-open)', () => {
    expect(
      shadowApiCostForStep(BOOK, step({ mode: 'cli', model: 'mystery-model', input_tokens: 1000 })),
    ).toBe(0);
  });
});

describe('summarizeShadowCost', () => {
  it('sums only CLI-mode steps and excludes API-mode', () => {
    const steps = [
      step({ mode: 'cli', model: 'claude-sonnet-4-6', input_tokens: 1_000_000 }), // $3
      step({ mode: 'cli', model: 'claude-sonnet-4-6', output_tokens: 1_000_000 }), // $15
      step({ mode: 'api', model: 'claude-sonnet-4-6', input_tokens: 1_000_000, usd: 3 }), // excluded
    ];
    const s = summarizeShadowCost(BOOK, steps);
    expect(s.cliStepCount).toBe(2);
    expect(s.shadowApiUsd).toBeCloseTo(18.0, 6);
    expect(s.byModel['claude-sonnet-4-6']).toBeCloseTo(18.0, 6);
  });

  it('collects unknown models without counting their cost', () => {
    const s = summarizeShadowCost(BOOK, [
      step({ mode: 'cli', model: 'mystery', input_tokens: 1000 }),
      step({ mode: 'cli', model: 'claude-sonnet-4-6', input_tokens: 1_000_000 }),
    ]);
    expect(s.unknownModels).toEqual(['mystery']);
    expect(s.cliStepCount).toBe(2);
    expect(s.shadowApiUsd).toBeCloseTo(3.0, 6);
  });

  it('honours a date window', () => {
    const steps = [
      step({
        mode: 'cli',
        model: 'claude-sonnet-4-6',
        input_tokens: 1_000_000,
        ts: '2026-05-30T10:00:00.000Z',
      }),
      step({
        mode: 'cli',
        model: 'claude-sonnet-4-6',
        input_tokens: 1_000_000,
        ts: '2026-05-31T10:00:00.000Z',
      }),
    ];
    const s = summarizeShadowCost(BOOK, steps, { since: '2026-05-31T00:00:00.000Z' });
    expect(s.cliStepCount).toBe(1);
    expect(s.shadowApiUsd).toBeCloseTo(3.0, 6);
  });
});

describe('formatShadowCost', () => {
  it('renders the dashboard line', () => {
    expect(formatShadowCost(42)).toBe('Shadow API cost: $42.00 (would have cost on API)');
    expect(formatShadowCost(0.0156)).toBe('Shadow API cost: $0.0156 (would have cost on API)');
  });
});
