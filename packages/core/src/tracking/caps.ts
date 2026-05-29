import { z } from 'zod';
import type { PricingBook } from '../pricing/loader.js';
import type { TrackingDb } from './db.js';

/**
 * T-411a — Hard caps + confirm dialog.
 *
 * Reads `tracking.caps` from `.agent-settings.yml`. On every send, projects
 * an upper-bound cost from input tokens (T-411b counted) plus the model's
 * output-cap-priced ceiling, and compares against three thresholds:
 *
 *   - `warn_above_usd`: yellow banner.
 *   - `confirm_above_usd`: modal dialog before send.
 *   - `hard_block_above_usd`: button disabled with message.
 *
 * Subscription caps (Claude Pro 200 msg / 5h) are tracked as warnings only
 * — they are CLI/SDK's responsibility; the IDE surfaces them but never
 * blocks.
 */

export const CapsSettingsSchema = z.object({
  single_step: z
    .object({
      warn_above_usd: z.number().nonnegative().optional(),
      confirm_above_usd: z.number().nonnegative().optional(),
      hard_block_above_usd: z.number().nonnegative().optional(),
    })
    .partial()
    .default({}),
  daily: z
    .object({
      warn_above_usd: z.number().nonnegative().optional(),
      confirm_above_usd: z.number().nonnegative().optional(),
      hard_block_above_usd: z.number().nonnegative().optional(),
    })
    .partial()
    .default({}),
});
export type CapsSettings = z.infer<typeof CapsSettingsSchema>;

export type CapVerdict = 'allow' | 'warn' | 'confirm' | 'block';

export interface CapEvaluation {
  verdict: CapVerdict;
  /** Source of the firing rule, e.g. "single_step.confirm_above_usd". */
  reason?: string;
  /** Estimated cost the verdict is based on. */
  projected_usd: number;
  /** USD spent today (when daily caps fired). */
  spent_today_usd?: number;
}

export interface CapEvaluationInput {
  /** Token count from T-411b. */
  input_tokens: number;
  /** Output ceiling — usually `request.max_tokens`. */
  output_cap_tokens: number;
  /** Model id used by the next call. */
  model: string;
}

export class CapsEvaluator {
  constructor(
    private readonly settings: CapsSettings,
    private readonly book: PricingBook,
    private readonly db?: TrackingDb,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async evaluate(input: CapEvaluationInput): Promise<CapEvaluation> {
    const m = this.book.requireModel(input.model);
    const projected_usd =
      (input.input_tokens / 1_000_000) * m.input_per_mtok +
      (input.output_cap_tokens / 1_000_000) * m.output_per_mtok;

    const step = this.settings.single_step;
    if (step?.hard_block_above_usd !== undefined && projected_usd >= step.hard_block_above_usd) {
      return { verdict: 'block', reason: 'single_step.hard_block_above_usd', projected_usd };
    }
    if (step?.confirm_above_usd !== undefined && projected_usd >= step.confirm_above_usd) {
      return { verdict: 'confirm', reason: 'single_step.confirm_above_usd', projected_usd };
    }

    let spent_today_usd: number | undefined;
    const daily = this.settings.daily;
    if (
      this.db &&
      (daily?.hard_block_above_usd !== undefined ||
        daily?.confirm_above_usd !== undefined ||
        daily?.warn_above_usd !== undefined)
    ) {
      const day = startOfUtcDay(this.clock());
      spent_today_usd = await this.db.totalUsd({ since: day.toISOString() });
      const total = spent_today_usd + projected_usd;
      if (daily.hard_block_above_usd !== undefined && total >= daily.hard_block_above_usd) {
        return {
          verdict: 'block',
          reason: 'daily.hard_block_above_usd',
          projected_usd,
          spent_today_usd,
        };
      }
      if (daily.confirm_above_usd !== undefined && total >= daily.confirm_above_usd) {
        return {
          verdict: 'confirm',
          reason: 'daily.confirm_above_usd',
          projected_usd,
          spent_today_usd,
        };
      }
      if (daily.warn_above_usd !== undefined && total >= daily.warn_above_usd) {
        return { verdict: 'warn', reason: 'daily.warn_above_usd', projected_usd, spent_today_usd };
      }
    }

    if (step?.warn_above_usd !== undefined && projected_usd >= step.warn_above_usd) {
      return { verdict: 'warn', reason: 'single_step.warn_above_usd', projected_usd };
    }

    return { verdict: 'allow', projected_usd, spent_today_usd };
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
