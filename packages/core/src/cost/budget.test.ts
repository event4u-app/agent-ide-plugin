import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DailyBudgetTracker } from './budget.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'event4u-budget-'));
  dirs.push(d);
  return d;
}

const FIXED = new Date('2026-05-31T08:00:00.000Z');
const fixedNow = (): Date => FIXED;

afterEach(() => {
  dirs.length = 0;
});

describe('DailyBudgetTracker', () => {
  it('accumulates spend across records for the day', async () => {
    const dir = await tempDir();
    const t = new DailyBudgetTracker({ dir, dailyBudgetUsd: 5, now: fixedNow });
    await t.record(1.5);
    const status = await t.record(1.0);
    expect(status.date).toBe('2026-05-31');
    expect(status.spentUsd).toBeCloseTo(2.5);
    expect(status.remainingUsd).toBeCloseTo(2.5);
    expect(status.overBudget).toBe(false);
    expect(status.warning).toBe(false);
  });

  it('warns once spend reaches the threshold ratio (default 0.8)', async () => {
    const dir = await tempDir();
    const t = new DailyBudgetTracker({ dir, dailyBudgetUsd: 10, now: fixedNow });
    const under = await t.record(7.9);
    expect(under.warning).toBe(false);
    const at = await t.record(0.2); // 8.1 / 10 = 0.81 ≥ 0.8
    expect(at.warning).toBe(true);
    expect(at.overBudget).toBe(false);
  });

  it('flags overBudget once spend exceeds the limit', async () => {
    const dir = await tempDir();
    const t = new DailyBudgetTracker({ dir, dailyBudgetUsd: 2, now: fixedNow });
    const status = await t.record(2.5);
    expect(status.overBudget).toBe(true);
    expect(status.warning).toBe(true);
    expect(status.remainingUsd).toBe(0);
    expect(status.ratio).toBeCloseTo(1.25);
  });

  it('honours a custom warning threshold', async () => {
    const dir = await tempDir();
    const t = new DailyBudgetTracker({
      dir,
      dailyBudgetUsd: 10,
      warningThresholdRatio: 0.5,
      now: fixedNow,
    });
    expect((await t.record(5)).warning).toBe(true);
  });

  it('never breaches when no budget is configured, but still tracks spend', async () => {
    const dir = await tempDir();
    const t = new DailyBudgetTracker({ dir, now: fixedNow });
    const status = await t.record(999);
    expect(status.limitUsd).toBeNull();
    expect(status.remainingUsd).toBeNull();
    expect(status.ratio).toBeNull();
    expect(status.overBudget).toBe(false);
    expect(status.warning).toBe(false);
    expect(status.spentUsd).toBe(999);
  });

  it('status() reflects persisted spend without recording', async () => {
    const dir = await tempDir();
    const t = new DailyBudgetTracker({ dir, dailyBudgetUsd: 5, now: fixedNow });
    await t.record(2);
    const seen = await t.status();
    expect(seen.spentUsd).toBe(2);
    // status() must not have added a row.
    expect((await t.status()).spentUsd).toBe(2);
  });

  it('persists spend across tracker instances (survives restart)', async () => {
    const dir = await tempDir();
    const first = new DailyBudgetTracker({ dir, dailyBudgetUsd: 5, now: fixedNow });
    await first.record(3, { conversationId: 'c1', model: 'claude', isEstimate: false });
    const second = new DailyBudgetTracker({ dir, dailyBudgetUsd: 5, now: fixedNow });
    expect((await second.status()).spentUsd).toBe(3);
  });

  it('is fail-open on an unwritable dir', async () => {
    const t = new DailyBudgetTracker({ dir: '/nope\0/x', dailyBudgetUsd: 5, now: fixedNow });
    const status = await t.record(1);
    // Write failed silently; spentOn read also fails-open to 0 → status reflects 0 prior + 1.
    expect(status.spentUsd).toBe(1);
  });
});
