import type { PricingBook } from '../pricing/loader.js';

/**
 * T-705 — pre-flight cost estimate.
 *
 * A turn's real cost is unknown before it runs (output length and cache state
 * vary), so we surface a *range* per PLAN.md §14.3 instead of a false-precise
 * single number:
 *
 *   lower bound = min output + cache **hit**  (input billed at cache-read rate)
 *   upper bound = max output + cache **miss** (full input rate + a cache write)
 *   typical     = a midpoint output at a partial cache hit
 *
 * The plugin renders `Context: ≈14,238 tok · Est. cost: $0.02 – $0.12
 * (~$0.04 typical)` via {@link formatEstimate}.
 */

const PER_MTOK = 1_000_000;

/** Default min/typical output assumptions when the caller has no better guess. */
const DEFAULT_MIN_OUTPUT = 256;

export interface EstimateInput {
  model: string;
  /** Context size sent to the model. */
  inputTokens: number;
  /** Cap on output (the request's max_tokens). */
  maxOutputTokens: number;
  /** Floor on output. Default {@link DEFAULT_MIN_OUTPUT}. */
  minOutputTokens?: number;
  /** Expected output for the typical figure. Default = halfway. */
  typicalOutputTokens?: number;
  /**
   * Fraction (0..1) of the input that the typical case reads from cache.
   * Default 0.5. The lower bound assumes a full hit (1.0); the upper bound a
   * full miss (0.0).
   */
  typicalCacheHitRatio?: number;
}

export interface CostRange {
  model: string;
  inputTokens: number;
  lowerUsd: number;
  upperUsd: number;
  typicalUsd: number;
}

export function estimateCost(book: PricingBook, input: EstimateInput): CostRange {
  const m = book.requireModel(input.model);
  const minOut = input.minOutputTokens ?? DEFAULT_MIN_OUTPUT;
  const maxOut = input.maxOutputTokens;
  const typicalOut = input.typicalOutputTokens ?? Math.round((minOut + maxOut) / 2);
  const hitRatio = clamp01(input.typicalCacheHitRatio ?? 0.5);

  const inputFull = (input.inputTokens / PER_MTOK) * m.input_per_mtok;
  const cacheRate = m.cache_read_per_mtok ?? m.input_per_mtok;
  const inputCached = (input.inputTokens / PER_MTOK) * cacheRate;
  const cacheWrite =
    m.cache_write_per_mtok !== undefined
      ? (input.inputTokens / PER_MTOK) * m.cache_write_per_mtok
      : 0;
  const outRate = m.output_per_mtok / PER_MTOK;

  // Lower: full cache hit + smallest output.
  const lowerUsd = inputCached + minOut * outRate;
  // Upper: cache miss (full input + a write to populate the cache) + max output.
  const upperUsd = inputFull + cacheWrite + maxOut * outRate;
  // Typical: blended input by the hit ratio + a mid-size output.
  const inputTypical = inputCached * hitRatio + inputFull * (1 - hitRatio);
  const typicalUsd = inputTypical + typicalOut * outRate;

  return {
    model: input.model,
    inputTokens: input.inputTokens,
    lowerUsd,
    upperUsd,
    typicalUsd,
  };
}

/** Render the one-line estimate string for the composer footer. */
export function formatEstimate(range: CostRange): string {
  const tok = range.inputTokens.toLocaleString('en-US');
  return (
    `Context: ≈${tok} tok · Est. cost: ` +
    `${usd(range.lowerUsd)} – ${usd(range.upperUsd)} (~${usd(range.typicalUsd)} typical)`
  );
}

/** Format a USD amount with the precision the magnitude warrants. */
export function usd(amount: number): string {
  const decimals = amount < 1 ? 4 : 2;
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}
