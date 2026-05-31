import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * T-PRD05 — permission audit trail (pure core).
 *
 * An append-only, date-rotated JSONL log of permission decisions, matching the
 * repo's chat-event / telemetry / cost-calibration precedent (AI council
 * 2026-05-31, UNANIMOUS — a separate log, NOT a `denials[]` array bloating
 * `permissions.json`). The permission card links to the entry it produced.
 *
 * Only user-facing decisions are recorded — `grant_once`, `grant_always`,
 * `deny_user`, and hard-floor blocks (`deny_hard_floor`). Auto-allowed low-risk
 * tools and `always`-granted repeats are NOT logged (they are not decisions and
 * would drown the trail).
 *
 * Writes are FAIL-OPEN: an audit append must never break a turn. A failed
 * write is swallowed (the council flagged the disk-pressure blind spot — it is
 * the accepted v0 trade-off for a single-dev plugin; the alternative, failing
 * the turn on an audit write, is worse).
 */

export const AuditKindSchema = z.enum([
  'grant_once',
  'grant_always',
  'deny_user',
  'deny_hard_floor',
]);
export type AuditKind = z.infer<typeof AuditKindSchema>;

export const AuditEntrySchema = z.object({
  kind: AuditKindSchema,
  tool: z.string().min(1),
  /** Why — e.g. the matched hard-floor pattern, or a user note. */
  reason: z.string().optional(),
  /** Argument scope the decision applied to, when narrowed. */
  scope: z.string().optional(),
  /** ISO-8601 timestamp. */
  ts: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** The minimal recorder surface the approval orchestrator depends on. */
export interface AuditRecorder {
  record(entry: Omit<AuditEntry, 'ts'> & { ts?: string }): Promise<void>;
}

export interface AuditLogOptions {
  /** Directory for the date-rotated `audit-<YYYY-MM-DD>.jsonl` files. */
  dir: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export class AuditLog implements AuditRecorder {
  private readonly now: () => Date;

  constructor(private readonly opts: AuditLogOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  async record(entry: Omit<AuditEntry, 'ts'> & { ts?: string }): Promise<void> {
    const at = this.now();
    const full: AuditEntry = { ...entry, ts: entry.ts ?? at.toISOString() };
    try {
      const file = this.fileFor(at);
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
    } catch {
      // Fail-open: audit logging must never break the agent loop.
    }
  }

  /** Read every entry for a date (`YYYY-MM-DD`); tolerates torn / blank lines. */
  async readDay(date: string): Promise<AuditEntry[]> {
    const raw = await readFile(join(this.opts.dir, `audit-${date}.jsonl`), 'utf8').catch(
      () => undefined,
    );
    if (raw === undefined) return [];
    const out: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = AuditEntrySchema.safeParse(JSON.parse(trimmed));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // Skip a torn line; the rest of the day still reads.
      }
    }
    return out;
  }

  private fileFor(at: Date): string {
    return join(this.opts.dir, `audit-${isoDate(at)}.jsonl`);
  }
}

/** `YYYY-MM-DD` in UTC. */
export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
