import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CostRange } from './estimate.js';
import { CalibrationLog, DRIFT_THRESHOLD } from './reconcile.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'event4u-calib-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const estimate: CostRange = {
  model: 'claude-sonnet-4-6',
  inputTokens: 10_000,
  lowerUsd: 0.01,
  upperUsd: 0.1,
  typicalUsd: 0.04,
};

const clock = () => '2026-05-30T12:00:00.000Z';

describe('CalibrationLog.reconcile', () => {
  it('does not log when real cost is within the upper bound', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: clock });
    const event = await log.reconcile({ conversationId: 'c1', estimate, realUsd: 0.08 });
    expect(event).toBeUndefined();
    expect(await log.readDay('2026-05-30')).toHaveLength(0);
  });

  it('does not log at exactly the threshold', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: clock });
    const event = await log.reconcile({
      conversationId: 'c1',
      estimate,
      realUsd: estimate.upperUsd * DRIFT_THRESHOLD,
    });
    expect(event).toBeUndefined();
  });

  it('logs a calibration event when drift exceeds the threshold', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: clock });
    const event = await log.reconcile({ conversationId: 'c1', estimate, realUsd: 0.2 });
    expect(event).toBeDefined();
    expect(event!.drift_ratio).toBeCloseTo(2, 6);
    expect(event!.real_usd).toBe(0.2);

    const day = await log.readDay('2026-05-30');
    expect(day).toHaveLength(1);
    expect(day[0]!.conversation_id).toBe('c1');
    expect(day[0]!.model).toBe('claude-sonnet-4-6');
  });

  it('rotates the file by date from the injected clock', async () => {
    const log = new CalibrationLog({ baseDir: dir, now: () => '2026-06-01T09:30:00.000Z' });
    await log.reconcile({ conversationId: 'c2', estimate, realUsd: 1.0 });
    expect(await log.readDay('2026-06-01')).toHaveLength(1);
    expect(await log.readDay('2026-05-30')).toHaveLength(0);
  });
});
