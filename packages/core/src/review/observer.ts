/**
 * Cost + audit integration for the review pipeline (road-to-code-review.md
 * Phase 2, T-CR-206).
 *
 * Wires the pipeline's `ReviewObserver` hooks to the real tracking + caps
 * stack: every LLM stage becomes a tracked `activity: "review"` step event in
 * `tracking.db` (priced via the Pricing Book), and each stage is gated by the
 * `CapsEvaluator` so a large diff that would blow the cap is blocked before
 * the call. Span validation reads the working-tree file.
 *
 * The review action itself (Phase 4) records a `tool_call` audit entry when a
 * user invokes it; per-stage LLM cost lives in the step-event trail here.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TrackingDb } from '../tracking/db.js';
import type { CapsEvaluator } from '../tracking/caps.js';
import type { PricingBook } from '../pricing/loader.js';
import type { AggregatedUsage } from '../llm/backend.js';
import type { ReviewObserver, CapVerdict, ReviewStageMeta } from './pipeline.js';

export interface TrackedReviewObserverOptions {
  db: TrackingDb;
  pricing: PricingBook;
  /** Optional cap gate; when omitted, no stage is ever blocked. */
  caps?: CapsEvaluator;
  conversationId: string;
  /** Repo root — file paths in findings resolve relative to it. */
  cwd: string;
  mode?: 'api' | 'cli';
  /** First step index to use; subsequent stages increment from here. */
  stepIndexStart?: number;
  now?: () => number;
  /** ISO timestamp source — injectable for deterministic tests. */
  isoNow?: () => string;
}

function cacheTokens(usage: AggregatedUsage): { creation: number; read: number } {
  const u = usage as unknown as {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  return {
    creation: u.cache_creation_input_tokens ?? 0,
    read: u.cache_read_input_tokens ?? 0,
  };
}

/**
 * Build a `ReviewObserver` backed by `TrackingDb` + `PricingBook` (+ optional
 * `CapsEvaluator`). Each completed stage writes a priced step event; each
 * about-to-run stage is cap-checked.
 */
export function createTrackedReviewObserver(opts: TrackedReviewObserverOptions): ReviewObserver {
  const mode = opts.mode ?? 'api';
  const isoNow = opts.isoNow ?? (() => new Date().toISOString());
  let stepIndex = opts.stepIndexStart ?? 0;

  return {
    now: opts.now,

    async readFile(file: string): Promise<string | undefined> {
      try {
        return await fsReadFile(resolve(opts.cwd, file), 'utf8');
      } catch {
        return undefined;
      }
    },

    async checkCaps(input): Promise<CapVerdict> {
      if (!opts.caps) return 'allow';
      const evaluation = await opts.caps.evaluate({
        input_tokens: input.inputTokens,
        output_cap_tokens: input.outputCapTokens,
        model: input.model,
      });
      return evaluation.verdict;
    },

    async onStage(meta: ReviewStageMeta): Promise<void> {
      const cache = cacheTokens(meta.usage);
      const cost = opts.pricing.costFor(meta.model, {
        input_tokens: meta.usage.input_tokens,
        output_tokens: meta.usage.output_tokens,
        cache_write_tokens: cache.creation,
        cache_read_tokens: cache.read,
      });
      await opts.db.writeStep({
        ts: isoNow(),
        conversation_id: opts.conversationId,
        step_index: stepIndex++,
        activity: 'review',
        mode,
        model: meta.model,
        stop_reason: meta.usage.stop_reason,
        input_tokens: meta.usage.input_tokens,
        output_tokens: meta.usage.output_tokens,
        cache_creation_input_tokens: cache.creation,
        cache_read_input_tokens: cache.read,
        usd: cost.total_usd,
        pricing_book_version: opts.pricing.data.version,
        duration_ms: meta.durationMs,
        meta: { review_stage: meta.stage },
      });
    },
  };
}
