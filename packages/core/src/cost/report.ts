import type { PricingBook } from '../pricing/loader.js';
import type { StepEvent } from '../tracking/db.js';
import { summarizeShadowCost } from './shadow.js';

/**
 * Cost-report aggregation (T-707 backend; ADR-035).
 *
 * Folds the recorded `step_events.jsonl` trail into the focused aggregate the
 * Cost Dashboard renders. Pure over the already-recorded {@link StepEvent}s;
 * the window filter matches `TrackingDb.totalUsd` (inclusive both ends). The
 * IDE render (donuts / bars) is the deferred surface — this is its data source.
 *
 * `totalUsd` / the `by*` maps sum each step's recorded book-rate `usd` (real
 * for api steps, shadow for cli steps — see `ChatHandler.computeCost`), so
 * `byMode` cleanly splits real spend (`api`) from shadow value (`cli`). The
 * explicit CLI-only shadow figure comes from {@link summarizeShadowCost}, which
 * recomputes from token counts (independent of the stored `usd`) and is shown
 * next to the subscription quota.
 */

export interface CostReportSummary {
  totalUsd: number;
  stepCount: number;
  byActivity: Record<string, number>;
  byMode: Record<string, number>;
  byModel: Record<string, number>;
  shadowApiUsd: number;
  cliStepCount: number;
}

export interface CostReportWindow {
  /** Inclusive ISO-8601 lower bound on `step.ts`. */
  since?: string;
  /** Inclusive ISO-8601 upper bound on `step.ts`. */
  until?: string;
}

/** Aggregate the recorded steps. `book` absent → shadow cost is 0 (still counts cli steps). */
export function summarizeCostReport(
  steps: StepEvent[],
  opts: CostReportWindow = {},
  book?: PricingBook,
): CostReportSummary {
  const inWindow = steps.filter(
    (s) => (!opts.since || s.ts >= opts.since) && (!opts.until || s.ts <= opts.until),
  );

  let totalUsd = 0;
  const byActivity: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  for (const s of inWindow) {
    totalUsd += s.usd;
    byActivity[s.activity] = (byActivity[s.activity] ?? 0) + s.usd;
    byMode[s.mode] = (byMode[s.mode] ?? 0) + s.usd;
    byModel[s.model] = (byModel[s.model] ?? 0) + s.usd;
  }

  const shadow = book
    ? summarizeShadowCost(book, inWindow, opts)
    : { shadowApiUsd: 0, cliStepCount: inWindow.filter((s) => s.mode === 'cli').length };

  return {
    totalUsd,
    stepCount: inWindow.length,
    byActivity,
    byMode,
    byModel,
    shadowApiUsd: shadow.shadowApiUsd,
    cliStepCount: shadow.cliStepCount,
  };
}

/** Coded error so an absent cost reporter surfaces cleanly (mirrors GitRequestError). */
export class CostRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CostRequestError';
  }
}

/** The minimal read seam the report needs over the tracking trail. */
export interface StepReader {
  readSteps(): Promise<StepEvent[]>;
}

/** Answers the `costReport` protocol method. */
export interface CostReporter {
  report(opts?: CostReportWindow): Promise<CostReportSummary>;
}

/** Default reporter — reads the tracking trail and aggregates it (book optional). */
export class DefaultCostReporter implements CostReporter {
  constructor(
    private readonly reader: StepReader,
    private readonly book?: PricingBook,
  ) {}

  async report(opts: CostReportWindow = {}): Promise<CostReportSummary> {
    const steps = await this.reader.readSteps();
    return summarizeCostReport(steps, opts, this.book);
  }
}
