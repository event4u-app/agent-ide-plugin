import { describe, expect, it } from 'vitest';
import { PricingBook } from '../pricing/loader.js';
import { estimateCost, formatEstimate, usd } from './estimate.js';

const BOOK = PricingBook.parse(`
version: 1
last_updated: '2026-05-30'
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

describe('estimateCost', () => {
  it('produces lower < typical < upper', () => {
    const r = estimateCost(BOOK, {
      model: 'claude-sonnet-4-6',
      inputTokens: 100_000,
      maxOutputTokens: 4096,
    });
    expect(r.lowerUsd).toBeLessThan(r.typicalUsd);
    expect(r.typicalUsd).toBeLessThan(r.upperUsd);
  });

  it('prices the lower bound at the cache-read rate', () => {
    const r = estimateCost(BOOK, {
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      maxOutputTokens: 1000,
      minOutputTokens: 0,
    });
    // 1M input @ cache-read 0.30 + 0 output = $0.30.
    expect(r.lowerUsd).toBeCloseTo(0.3, 6);
  });

  it('prices the upper bound at the full input + cache-write + max output', () => {
    const r = estimateCost(BOOK, {
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      maxOutputTokens: 1_000_000,
      minOutputTokens: 0,
    });
    // 1M input @ 3.00 + 1M cache-write @ 3.75 + 1M output @ 15.00 = $21.75.
    expect(r.upperUsd).toBeCloseTo(21.75, 6);
  });

  it('throws on an unknown model', () => {
    expect(() =>
      estimateCost(BOOK, { model: 'nope', inputTokens: 1, maxOutputTokens: 1 }),
    ).toThrow();
  });
});

describe('formatEstimate / usd', () => {
  it('formats sub-dollar amounts with 4 decimals and thousands separators', () => {
    const r = estimateCost(BOOK, {
      model: 'claude-sonnet-4-6',
      inputTokens: 14_238,
      maxOutputTokens: 2048,
    });
    const s = formatEstimate(r);
    expect(s).toContain('Context: ≈14,238 tok');
    expect(s).toMatch(/Est\. cost: \$\d/);
    expect(s).toContain('typical)');
  });

  it('uses 2 decimals at or above $1', () => {
    expect(usd(12.5)).toBe('$12.50');
    expect(usd(0.0156)).toBe('$0.0156');
  });
});
