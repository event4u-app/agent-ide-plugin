import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackingDb, type StepEvent } from './db.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'event4u-tracking-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function step(overrides: Partial<StepEvent> = {}): StepEvent {
  return {
    ts: '2026-05-29T10:00:00.000Z',
    conversation_id: 'conv-1',
    step_index: 0,
    activity: 'chat',
    mode: 'api',
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    usd: 0.001,
    pricing_book_version: 1,
    duration_ms: 1500,
    ...overrides,
  };
}

describe('TrackingDb', () => {
  it('persists step events and reads them back', async () => {
    const db = new TrackingDb({ baseDir: dir });
    await db.writeStep(step({ step_index: 0 }));
    await db.writeStep(step({ step_index: 1, usd: 0.002 }));
    const all = await db.readSteps();
    expect(all.length).toBe(2);
    expect(all[1]?.step_index).toBe(1);
  });

  it('persists conversation summaries', async () => {
    const db = new TrackingDb({ baseDir: dir });
    await db.writeSummary({
      ts: '2026-05-29T10:01:00.000Z',
      conversation_id: 'conv-1',
      total_input_tokens: 300,
      total_output_tokens: 150,
      total_usd: 0.005,
      step_count: 3,
    });
    const summaries = await db.readSummaries();
    expect(summaries[0]?.total_usd).toBeCloseTo(0.005);
  });

  it('sums USD across a window', async () => {
    const db = new TrackingDb({ baseDir: dir });
    await db.writeStep(step({ ts: '2026-05-29T10:00:00Z', usd: 0.001 }));
    await db.writeStep(step({ ts: '2026-05-29T11:00:00Z', usd: 0.002 }));
    await db.writeStep(step({ ts: '2026-05-30T10:00:00Z', usd: 0.003 }));
    const day1 = await db.totalUsd({
      since: '2026-05-29T00:00:00Z',
      until: '2026-05-29T23:59:59Z',
    });
    expect(day1).toBeCloseTo(0.003);
  });

  it('rejects writes that violate the schema', async () => {
    const db = new TrackingDb({ baseDir: dir });
    // negative usd → schema violation
    await expect(db.writeStep(step({ usd: -0.01 }))).rejects.toThrow();
  });

  it('readSteps returns [] for a fresh dir', async () => {
    const db = new TrackingDb({ baseDir: dir });
    expect(await db.readSteps()).toEqual([]);
  });

  it('carries pricing_book_version on every row (audit trail)', async () => {
    const db = new TrackingDb({ baseDir: dir });
    await db.writeStep(step({ pricing_book_version: 2 }));
    const out = await db.readSteps();
    expect(out[0]?.pricing_book_version).toBe(2);
  });
});
