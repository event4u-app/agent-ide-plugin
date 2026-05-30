import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { CostRange } from './estimate.js';

/**
 * T-706 — reconciliation logging.
 *
 * After every completed turn, compare the real cost against the pre-flight
 * {@link CostRange}. When the real cost overruns the upper bound by more than
 * {@link DRIFT_THRESHOLD}×, append a calibration event to a date-rotated
 * `calibration-event-<YYYY-MM-DD>.jsonl`. Drift is **signal for heuristic
 * improvement, not a regression** — the Cost Dashboard surfaces it as a
 * "Calibration drift" KPI for v1.5+; here we only capture the evidence.
 */

/** Real cost must exceed `upper × this` to log a calibration event. */
export const DRIFT_THRESHOLD = 1.5;

export const CalibrationEventSchema = z.object({
  ts: z.string(),
  conversation_id: z.string(),
  model: z.string(),
  estimate_lower_usd: z.number().nonnegative(),
  estimate_upper_usd: z.number().nonnegative(),
  estimate_typical_usd: z.number().nonnegative(),
  real_usd: z.number().nonnegative(),
  /** real / upper — how far past the upper bound the turn landed. */
  drift_ratio: z.number().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
});
export type CalibrationEvent = z.infer<typeof CalibrationEventSchema>;

export interface ReconcileInput {
  conversationId: string;
  estimate: CostRange;
  realUsd: number;
}

export interface CalibrationLogOptions {
  /** Directory the date-rotated JSONL files live in. */
  baseDir: string;
  /** Injected clock (ISO-8601). Defaults to the wall clock. */
  now?: () => string;
}

export class CalibrationLog {
  private readonly now: () => string;

  constructor(private readonly opts: CalibrationLogOptions) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Reconcile one turn. Returns the logged event when drift exceeds the
   * threshold (and writes it), or `undefined` when the turn was within range.
   */
  async reconcile(input: ReconcileInput): Promise<CalibrationEvent | undefined> {
    const upper = input.estimate.upperUsd;
    const driftRatio = upper > 0 ? input.realUsd / upper : input.realUsd > 0 ? Infinity : 0;
    if (!(input.realUsd > upper * DRIFT_THRESHOLD)) return undefined;

    const ts = this.now();
    const event: CalibrationEvent = CalibrationEventSchema.parse({
      ts,
      conversation_id: input.conversationId,
      model: input.estimate.model,
      estimate_lower_usd: input.estimate.lowerUsd,
      estimate_upper_usd: upper,
      estimate_typical_usd: input.estimate.typicalUsd,
      real_usd: input.realUsd,
      drift_ratio: Number.isFinite(driftRatio) ? driftRatio : 0,
      input_tokens: input.estimate.inputTokens,
    });
    await this.append(ts.slice(0, 10), event);
    return event;
  }

  /** Read every calibration event for a given date (YYYY-MM-DD). */
  async readDay(date: string): Promise<CalibrationEvent[]> {
    const text = await readFile(this.pathFor(date), 'utf8').catch(() => '');
    if (!text) return [];
    const out: CalibrationEvent[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = CalibrationEventSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  private pathFor(date: string): string {
    return join(this.opts.baseDir, `calibration-event-${date}.jsonl`);
  }

  private async append(date: string, event: CalibrationEvent): Promise<void> {
    await mkdir(this.opts.baseDir, { recursive: true });
    await appendFile(this.pathFor(date), `${JSON.stringify(event)}\n`, 'utf8');
  }
}
