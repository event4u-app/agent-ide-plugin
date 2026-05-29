import type { CostFooter, StreamingSummary } from './chat-model.js';

/**
 * Twin of `CostFooterFormatter.kt` — keeps the cost surfaces visually
 * aligned across IDEs. Pure functions, unit-tested.
 */

const MILLIS_PER_SECOND = 1000;
const DECISECONDS_PER_MILLI = 100;
const THOUSAND = 1000;

export function formatTokens(n: number): string {
  if (n >= THOUSAND) {
    return n.toLocaleString('en-US');
  }
  return String(n);
}

export function formatUsd(usd: number): string {
  const fixed = usd.toFixed(4);
  // Trim trailing zeros but keep at least one digit after the dot.
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed.length === 0 ? '0' : trimmed;
}

export function formatStepFooter(cost: CostFooter): string {
  const cache = cost.cacheReadTokens > 0 ? ` (cache: ${formatTokens(cost.cacheReadTokens)})` : '';
  const seconds = Math.floor(cost.durationMs / MILLIS_PER_SECOND);
  const decis = Math.floor((cost.durationMs % MILLIS_PER_SECOND) / DECISECONDS_PER_MILLI);
  return [
    `⏱ ${seconds}.${decis}s`,
    `In: ${formatTokens(cost.inputTokens)}${cache}`,
    `Out: ${formatTokens(cost.outputTokens)}`,
    `$${formatUsd(cost.usd)}`,
    `${cost.stepCount} steps`,
    `${cost.toolCallCount} tool calls`,
    `TTFT ${cost.timeToFirstTokenMs}ms`,
  ].join(' · ');
}

export function formatStreaming(summary: StreamingSummary): string {
  return `🟢 Streaming · In: ${formatTokens(summary.inputTokens)} / Out: ${formatTokens(summary.outputTokens)} · $${formatUsd(summary.usdSoFar)} so far`;
}

export function formatStatusbar(model: string, todayUsd: number): string {
  return `${model} · $${formatUsd(todayUsd)} today`;
}
