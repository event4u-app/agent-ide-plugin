import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PricingBook } from '../pricing/loader.js';
import { CapsEvaluator } from './caps.js';
import { TrackingDb, type StepEvent } from './db.js';

const BOOK_YAML = `
version: 1
last_updated: '2026-05-29'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

let book: PricingBook;
let dir: string;

beforeEach(async () => {
  book = PricingBook.parse(BOOK_YAML);
  dir = await mkdtemp(join(tmpdir(), 'event4u-caps-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CapsEvaluator — single step', () => {
  it('allows when no caps are set', async () => {
    const evaluator = new CapsEvaluator({ single_step: {}, daily: {} }, book);
    const out = await evaluator.evaluate({
      input_tokens: 100,
      output_cap_tokens: 100,
      model: 'claude-sonnet-4-6',
    });
    expect(out.verdict).toBe('allow');
  });

  it('warns when projected_usd >= single_step.warn_above_usd', async () => {
    const evaluator = new CapsEvaluator({ single_step: { warn_above_usd: 0.01 }, daily: {} }, book);
    // 1000 input + 1000 output @ sonnet = 3e-3 + 15e-3 = 0.018
    const out = await evaluator.evaluate({
      input_tokens: 1_000_000,
      output_cap_tokens: 1_000_000,
      model: 'claude-sonnet-4-6',
    });
    expect(out.verdict).toBe('warn');
  });

  it('confirm beats warn when both trigger', async () => {
    const evaluator = new CapsEvaluator(
      { single_step: { warn_above_usd: 0.001, confirm_above_usd: 0.01 }, daily: {} },
      book,
    );
    const out = await evaluator.evaluate({
      input_tokens: 1_000_000,
      output_cap_tokens: 1_000_000,
      model: 'claude-sonnet-4-6',
    });
    expect(out.verdict).toBe('confirm');
  });

  it('block beats confirm when both trigger', async () => {
    const evaluator = new CapsEvaluator(
      {
        single_step: {
          warn_above_usd: 0.001,
          confirm_above_usd: 0.005,
          hard_block_above_usd: 0.01,
        },
        daily: {},
      },
      book,
    );
    const out = await evaluator.evaluate({
      input_tokens: 1_000_000,
      output_cap_tokens: 1_000_000,
      model: 'claude-sonnet-4-6',
    });
    expect(out.verdict).toBe('block');
  });
});

describe('CapsEvaluator — daily window', () => {
  it('accumulates today spend + projected, then fires', async () => {
    const db = new TrackingDb({ baseDir: dir });
    const today = '2026-05-29T08:00:00.000Z';
    const earlier = '2026-05-29T07:00:00.000Z';
    const step: StepEvent = {
      ts: earlier,
      conversation_id: 'c1',
      step_index: 0,
      activity: 'chat',
      mode: 'api',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      usd: 0.5,
      pricing_book_version: 1,
      duration_ms: 1,
    };
    await db.writeStep(step);

    const evaluator = new CapsEvaluator(
      { single_step: {}, daily: { confirm_above_usd: 0.6 } },
      book,
      db,
      () => new Date(today),
    );
    const out = await evaluator.evaluate({
      input_tokens: 1_000_000,
      output_cap_tokens: 1_000_000,
      model: 'claude-sonnet-4-6',
    });
    expect(out.verdict).toBe('confirm');
    expect(out.spent_today_usd).toBeCloseTo(0.5);
    expect(out.reason).toBe('daily.confirm_above_usd');
  });

  it('does not look at yesterday rows', async () => {
    const db = new TrackingDb({ baseDir: dir });
    await db.writeStep({
      ts: '2026-05-28T22:00:00.000Z',
      conversation_id: 'c1',
      step_index: 0,
      activity: 'chat',
      mode: 'api',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      usd: 100,
      pricing_book_version: 1,
      duration_ms: 1,
    });
    const evaluator = new CapsEvaluator(
      { single_step: {}, daily: { hard_block_above_usd: 1 } },
      book,
      db,
      () => new Date('2026-05-29T05:00:00Z'),
    );
    const out = await evaluator.evaluate({
      input_tokens: 1000,
      output_cap_tokens: 1000,
      model: 'claude-sonnet-4-6',
    });
    expect(out.verdict).toBe('allow');
  });
});
