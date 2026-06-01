import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { isoDate } from '../permissions/audit.js';

/**
 * T-PRD06 — daily budget tracker (pure core).
 *
 * Accumulates per-turn spend into a date-rotated JSONL log and reports a
 * {@link BudgetStatus} the composer renders (live remaining + a soft warning as
 * the daily limit approaches). Dedicated tracker under `cost/` (AI council
 * 2026-05-31, UNANIMOUS), injectable clock + storage dir for deterministic
 * tests, fail-open like the audit log.
 *
 * Standalone this slice — the council deferred wiring the pre-send estimate →
 * budget check into `chat/handler.ts` until a protocol/UI consumer exists for
 * the warning. The tracker + settings key ship + are unit-tested now.
 *
 * No daily budget configured (`limitUsd == null`) → `record`/`status` still
 * track spend, but `overBudget` and `warning` stay `false` (nothing to breach).
 */

export const SpendRecordSchema = z.object({
  ts: z.string(),
  usd: z.number().nonnegative(),
  conversationId: z.string().optional(),
  model: z.string().optional(),
  /** `true` when this row is a pre-send estimate, not a reconciled actual. */
  isEstimate: z.boolean().optional(),
});
export type SpendRecord = z.infer<typeof SpendRecordSchema>;

export interface BudgetStatus {
  /** `YYYY-MM-DD` the figures are for. */
  date: string;
  spentUsd: number;
  /** Configured daily limit, or `null` when none is set. */
  limitUsd: number | null;
  /** `limitUsd - spentUsd`, clamped at 0; `null` when no limit. */
  remainingUsd: number | null;
  /** `spentUsd / limitUsd`; `null` when no limit. */
  ratio: number | null;
  overBudget: boolean;
  /** `ratio >= warningThresholdRatio` — the soft "approaching budget" signal. */
  warning: boolean;
}

/**
 * Narrow recorder surface the chat handler injects (T-PRD06 wiring). Lets the
 * handler record a turn's actual spend and read today's status without
 * depending on the concrete {@link DailyBudgetTracker} — mirrors the optional
 * `AuditRecorder` injection in {@link import('../agent/approval.js')}.
 * {@link DailyBudgetTracker} satisfies it structurally.
 */
export interface BudgetRecorder {
  record(usd: number, meta?: Omit<SpendRecord, 'ts' | 'usd'>): Promise<BudgetStatus>;
  status(): Promise<BudgetStatus>;
}

const DEFAULT_WARNING_RATIO = 0.8;

export interface DailyBudgetOptions {
  /** Directory for the `daily-spend-<YYYY-MM-DD>.jsonl` files. */
  dir: string;
  /** Daily limit in USD; `undefined` / `null` = no budget. */
  dailyBudgetUsd?: number | null;
  /** Warn when `spent/limit` reaches this (0..1). Default 0.8. */
  warningThresholdRatio?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export class DailyBudgetTracker {
  private readonly now: () => Date;
  private readonly limit: number | null;
  private readonly warningRatio: number;

  constructor(private readonly opts: DailyBudgetOptions) {
    this.now = opts.now ?? (() => new Date());
    this.limit = opts.dailyBudgetUsd ?? null;
    this.warningRatio = opts.warningThresholdRatio ?? DEFAULT_WARNING_RATIO;
  }

  /** Sum of recorded spend for a date (`YYYY-MM-DD`); fail-open → 0. */
  async spentOn(date: string): Promise<number> {
    const raw = await readFile(join(this.opts.dir, `daily-spend-${date}.jsonl`), 'utf8').catch(
      () => undefined,
    );
    if (raw === undefined) return 0;
    let total = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = SpendRecordSchema.safeParse(JSON.parse(trimmed));
        if (parsed.success) total += parsed.data.usd;
      } catch {
        // Skip a torn line.
      }
    }
    return total;
  }

  /** Today's status without recording anything. */
  async status(): Promise<BudgetStatus> {
    const date = isoDate(this.now());
    return this.statusFor(date, await this.spentOn(date));
  }

  /** Append a spend row for today and return the resulting status. */
  async record(usd: number, meta: Omit<SpendRecord, 'ts' | 'usd'> = {}): Promise<BudgetStatus> {
    const at = this.now();
    const date = isoDate(at);
    const before = await this.spentOn(date);
    const row: SpendRecord = { ...meta, usd, ts: at.toISOString() };
    try {
      const file = join(this.opts.dir, `daily-spend-${date}.jsonl`);
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
    } catch {
      // Fail-open: a spend-log write must never break a turn.
    }
    return this.statusFor(date, before + usd);
  }

  private statusFor(date: string, spentUsd: number): BudgetStatus {
    if (this.limit === null) {
      return {
        date,
        spentUsd,
        limitUsd: null,
        remainingUsd: null,
        ratio: null,
        overBudget: false,
        warning: false,
      };
    }
    const ratio = this.limit > 0 ? spentUsd / this.limit : spentUsd > 0 ? Infinity : 0;
    return {
      date,
      spentUsd,
      limitUsd: this.limit,
      remainingUsd: Math.max(0, this.limit - spentUsd),
      ratio,
      overBudget: spentUsd > this.limit,
      warning: ratio >= this.warningRatio,
    };
  }
}
