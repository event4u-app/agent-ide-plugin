import { describe, expect, it } from 'vitest';
import {
  formatStatusbar,
  formatStepFooter,
  formatStreaming,
  formatTokens,
  formatUsd,
} from './cost-format.js';

describe('formatTokens', () => {
  it('passes small numbers through', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('thousand-separates big numbers', () => {
    expect(formatTokens(18_422)).toBe('18,422');
  });
});

describe('formatUsd', () => {
  it('trims trailing zeros but keeps significant decimals', () => {
    expect(formatUsd(0.0156)).toBe('0.0156');
    expect(formatUsd(0.5)).toBe('0.5');
    expect(formatUsd(0)).toBe('0');
  });
});

describe('formatStepFooter', () => {
  it('carries every expected segment', () => {
    const out = formatStepFooter({
      durationMs: 4200,
      inputTokens: 18_422,
      cacheReadTokens: 14_200,
      outputTokens: 487,
      usd: 0.0156,
      stepCount: 3,
      toolCallCount: 3,
      timeToFirstTokenMs: 412,
    });
    expect(out).toContain('4.2s');
    expect(out).toContain('18,422');
    expect(out).toContain('cache: 14,200');
    expect(out).toContain('Out: 487');
    expect(out).toContain('$0.0156');
    expect(out).toContain('3 steps');
    expect(out).toContain('3 tool calls');
    expect(out).toContain('TTFT 412ms');
  });

  it('omits cache bucket when zero', () => {
    const out = formatStepFooter({
      durationMs: 1000,
      inputTokens: 100,
      cacheReadTokens: 0,
      outputTokens: 10,
      usd: 0.0001,
      stepCount: 1,
      toolCallCount: 0,
      timeToFirstTokenMs: 100,
    });
    expect(out).not.toContain('cache:');
  });
});

describe('formatStreaming', () => {
  it('includes both token counts and running cost', () => {
    const out = formatStreaming({ inputTokens: 14_238, outputTokens: 412, usdSoFar: 0.0089 });
    expect(out).toContain('14,238');
    expect(out).toContain('412');
    expect(out).toContain('$0.0089');
  });
});

describe('formatStatusbar', () => {
  it('shows model and today usd', () => {
    expect(formatStatusbar('claude-sonnet-4-6', 0.0156)).toBe('claude-sonnet-4-6 · $0.0156 today');
  });
});
