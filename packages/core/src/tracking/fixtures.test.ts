import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StepEventSchema, TrackingDb } from './db.js';
import { buildMultiProviderFixture, seedMultiProviderFixture } from './fixtures.js';

describe('buildMultiProviderFixture', () => {
  it('spans all four providers and both transport modes', () => {
    const events = buildMultiProviderFixture();
    const providers = new Set(events.map((e) => e.meta?.provider));
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
    expect(providers).toContain('gemini');
    expect(providers).toContain('groq');
    const modes = new Set(events.map((e) => e.mode));
    expect(modes).toEqual(new Set(['api', 'cli']));
  });

  it('produces rows that validate against the StepEvent schema', () => {
    for (const event of buildMultiProviderFixture()) {
      expect(() => StepEventSchema.parse(event)).not.toThrow();
    }
  });

  it('is deterministic for a fixed base timestamp', () => {
    const a = buildMultiProviderFixture({ baseTs: '2026-01-01T00:00:00.000Z' });
    const b = buildMultiProviderFixture({ baseTs: '2026-01-01T00:00:00.000Z' });
    expect(a).toEqual(b);
    expect(a[0].ts).toBe('2026-01-01T00:00:00.000Z');
    expect(a[1].ts).toBe('2026-01-01T00:01:00.000Z');
  });
});

describe('seedMultiProviderFixture', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tracking-fixture-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes every fixture row into the tracking db', async () => {
    const db = new TrackingDb({ baseDir: dir });
    const count = await seedMultiProviderFixture(db);
    const steps = await db.readSteps();
    expect(steps).toHaveLength(count);
    expect(count).toBeGreaterThanOrEqual(7);
    const total = await db.totalUsd();
    expect(total).toBeGreaterThan(0);
  });
});
