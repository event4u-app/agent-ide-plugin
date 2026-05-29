import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * T-408 — Token-tracking persistence.
 *
 * The roadmap specifies SQLite via better-sqlite3. The MVP runtime ships
 * with Node 20+ across macOS / Linux / Windows; better-sqlite3 needs a
 * native build per Node minor and currently has no prebuild for Node 25
 * (local-dev OS for this run). Council pattern: ship v0 as append-only
 * JSONL — same data shape, no native deps, cross-platform without
 * compilation. Schema is identical to the documented SQLite columns, so
 * the v1.0 migration is a JSONL → INSERT loop.
 *
 *   step_events.jsonl           — every step (one row per LLM call)
 *   conversation_summaries.jsonl — finalised conversation rollups
 *
 * Council finding #7 (round-2): every row carries `pricing_book_version`
 * for audit-trace.
 */

export const ActivitySchema = z.enum(['agent', 'chat', 'cli-agent', 'skill', 'system']);
export type Activity = z.infer<typeof ActivitySchema>;

export const StepEventSchema = z.object({
  /** ISO-8601 UTC. */
  ts: z.string(),
  /** Conversation id; chosen by the host (UUID or human label). */
  conversation_id: z.string(),
  /** Monotonically increasing step number within the conversation. */
  step_index: z.number().int().nonnegative(),
  activity: ActivitySchema,
  /** Backend used — see `LlmMode` from protocol. */
  mode: z.enum(['api', 'cli']),
  /** Model id, e.g. `claude-sonnet-4-6`. */
  model: z.string(),
  /** Stop reason. */
  stop_reason: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  /** Stage-level cost in USD. */
  usd: z.number().nonnegative(),
  /** Pricing-book version that priced the row. */
  pricing_book_version: z.number().int().positive(),
  /** Wall-clock duration of the step. */
  duration_ms: z.number().int().nonnegative(),
  /** Optional free-form metadata. */
  meta: z.record(z.unknown()).optional(),
});
export type StepEvent = z.infer<typeof StepEventSchema>;

export const ConversationSummarySchema = z.object({
  ts: z.string(),
  conversation_id: z.string(),
  total_input_tokens: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  total_usd: z.number().nonnegative(),
  step_count: z.number().int().nonnegative(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export interface TrackingDbOptions {
  /** Directory the two JSONL files live in. */
  baseDir: string;
}

export class TrackingDb {
  constructor(private readonly opts: TrackingDbOptions) {}

  private stepsPath(): string {
    return `${this.opts.baseDir}/step_events.jsonl`;
  }
  private summariesPath(): string {
    return `${this.opts.baseDir}/conversation_summaries.jsonl`;
  }

  async writeStep(event: StepEvent): Promise<void> {
    const validated = StepEventSchema.parse(event);
    await this.appendLine(this.stepsPath(), validated);
  }

  async writeSummary(summary: ConversationSummary): Promise<void> {
    const validated = ConversationSummarySchema.parse(summary);
    await this.appendLine(this.summariesPath(), validated);
  }

  /** Read every step event ever recorded. Useful for tests + the future drawer. */
  async readSteps(): Promise<StepEvent[]> {
    return this.readLines(this.stepsPath(), StepEventSchema);
  }

  async readSummaries(): Promise<ConversationSummary[]> {
    return this.readLines(this.summariesPath(), ConversationSummarySchema);
  }

  /**
   * Sum USD spent within `since..until`. Used by the daily-cap guardrail
   * (T-411a). Both ends optional; default = all-time.
   */
  async totalUsd(window: { since?: string; until?: string } = {}): Promise<number> {
    const steps = await this.readSteps();
    return steps
      .filter(
        (s) => (!window.since || s.ts >= window.since) && (!window.until || s.ts <= window.until),
      )
      .reduce((acc, s) => acc + s.usd, 0);
  }

  private async appendLine(path: string, payload: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(payload)}\n`, 'utf8');
  }

  private async readLines<T>(
    path: string,
    schema: { safeParse(x: unknown): { success: true; data: T } | { success: false } },
  ): Promise<T[]> {
    const text = await readFile(path, 'utf8').catch(() => '');
    if (!text) return [];
    const out: T[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = schema.safeParse(JSON.parse(trimmed));
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }
}
