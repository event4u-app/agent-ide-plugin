import type { PricingBook, UsageBreakdown } from '../pricing/loader.js';
import type { StepEvent } from '../tracking/db.js';
import { usd } from './estimate.js';

/**
 * T-1404 — Subscription-cost approximation ("shadow API cost").
 *
 * In CLI mode the user pays a flat subscription, not per-token, so the
 * Cost Dashboard can't show a real dollar figure. Instead it shows what the
 * same usage WOULD have cost on the metered API — the "shadow" cost — next to
 * the subscription quota (PLAN.md §14.5). That makes the subscription's value
 * legible: "this week's CLI work would have been $42 on the API."
 *
 * Pure computation over the already-recorded {@link StepEvent}s (T-408) and
 * the {@link PricingBook}. Fail-open: a step on a model absent from the book
 * contributes $0 rather than throwing, so one unknown model never breaks the
 * dashboard total. The UI rendering is the IDE-runtime surface (T-707).
 */

function usageOf(step: StepEvent): UsageBreakdown {
  return {
    input_tokens: step.input_tokens,
    output_tokens: step.output_tokens,
    cache_write_tokens: step.cache_creation_input_tokens,
    cache_read_tokens: step.cache_read_input_tokens,
  };
}

/**
 * API-equivalent cost of one step. Returns 0 when the model is unknown to the
 * book (fail-open) — the caller can still total everything else.
 */
export function shadowApiCostForStep(book: PricingBook, step: StepEvent): number {
  if (!book.getModel(step.model)) return 0;
  return book.costFor(step.model, usageOf(step)).total_usd;
}

export interface ShadowCostSummary {
  /** Total API-equivalent USD across the included CLI-mode steps. */
  shadowApiUsd: number;
  /** Number of CLI-mode steps counted. */
  cliStepCount: number;
  /** Per-model breakdown of the shadow cost. */
  byModel: Record<string, number>;
  /** Models seen on CLI steps that the pricing book did not know. */
  unknownModels: string[];
}

export interface ShadowCostOptions {
  /** Only count steps with `ts` in [since, until]. Both optional. */
  since?: string;
  until?: string;
}

/**
 * Summarize the shadow API cost of CLI-mode usage. API-mode steps already have
 * a real cost (`step.usd`) and are excluded — shadow cost is a CLI-only concept.
 */
export function summarizeShadowCost(
  book: PricingBook,
  steps: StepEvent[],
  opts: ShadowCostOptions = {},
): ShadowCostSummary {
  const byModel: Record<string, number> = {};
  const unknown = new Set<string>();
  let shadowApiUsd = 0;
  let cliStepCount = 0;

  for (const step of steps) {
    if (step.mode !== 'cli') continue;
    if (opts.since && step.ts < opts.since) continue;
    if (opts.until && step.ts > opts.until) continue;
    cliStepCount += 1;
    if (!book.getModel(step.model)) {
      unknown.add(step.model);
      continue;
    }
    const cost = book.costFor(step.model, usageOf(step)).total_usd;
    shadowApiUsd += cost;
    byModel[step.model] = (byModel[step.model] ?? 0) + cost;
  }

  return { shadowApiUsd, cliStepCount, byModel, unknownModels: [...unknown].sort() };
}

/** Render the dashboard line: `Shadow API cost: $X.XX (would have cost on API)`. */
export function formatShadowCost(shadowApiUsd: number): string {
  return `Shadow API cost: ${usd(shadowApiUsd)} (would have cost on API)`;
}
