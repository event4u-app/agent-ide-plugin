import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackingDb } from '../tracking/db.js';
import { CapsEvaluator } from '../tracking/caps.js';
import { PricingBook } from '../pricing/loader.js';
import type { AggregatedUsage } from '../llm/backend.js';
import { createTrackedReviewObserver } from './observer.js';

const YAML = `
version: 3
last_updated: '2026-05-29'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
subscriptions: []
`;

const pricing = PricingBook.parse(YAML);

function usage(over: Partial<AggregatedUsage> = {}): AggregatedUsage {
  return {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    text: '',
    tool_uses: [],
    stop_reason: 'tool_use',
    ...over,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'event4u-review-obs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createTrackedReviewObserver — onStage', () => {
  it('writes a priced review step event per stage with incrementing index', async () => {
    const db = new TrackingDb({ baseDir: dir });
    const observer = createTrackedReviewObserver({
      db,
      pricing,
      conversationId: 'review-1',
      cwd: dir,
      isoNow: () => '2026-05-29T00:00:00.000Z',
    });

    await observer.onStage?.({
      stage: 'analyze',
      model: 'claude-sonnet-4-6',
      usage: usage(),
      durationMs: 10,
    });
    await observer.onStage?.({
      stage: 'critical',
      model: 'claude-sonnet-4-6',
      usage: usage(),
      durationMs: 20,
    });

    const steps = await db.readSteps();
    expect(steps).toHaveLength(2);
    expect(steps[0]?.activity).toBe('review');
    expect(steps[0]?.step_index).toBe(0);
    expect(steps[1]?.step_index).toBe(1);
    expect(steps[0]?.meta?.review_stage).toBe('analyze');
    // 1M input @ $3 + 1M output @ $15 = $18.00
    expect(steps[0]?.usd).toBeCloseTo(18.0, 5);
    expect(steps[0]?.pricing_book_version).toBe(3);
  });
});

describe('createTrackedReviewObserver — checkCaps', () => {
  it('blocks a stage when the projected cost exceeds the hard block', async () => {
    const caps = new CapsEvaluator(
      { single_step: { hard_block_above_usd: 1.0 }, daily: {} },
      pricing,
    );
    const observer = createTrackedReviewObserver({
      db: new TrackingDb({ baseDir: dir }),
      pricing,
      caps,
      conversationId: 'review-1',
      cwd: dir,
    });
    // 1M input + 2k output cap → well over $1.
    const verdict = await observer.checkCaps?.({
      inputTokens: 1_000_000,
      outputCapTokens: 2048,
      model: 'claude-sonnet-4-6',
      stage: 'analyze',
    });
    expect(verdict).toBe('block');
  });

  it('allows when no caps evaluator is configured', async () => {
    const observer = createTrackedReviewObserver({
      db: new TrackingDb({ baseDir: dir }),
      pricing,
      conversationId: 'review-1',
      cwd: dir,
    });
    const verdict = await observer.checkCaps?.({
      inputTokens: 9_999_999,
      outputCapTokens: 4096,
      model: 'claude-sonnet-4-6',
      stage: 'analyze',
    });
    expect(verdict).toBe('allow');
  });
});
