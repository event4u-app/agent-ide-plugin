import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * T-1403 — Telemetry engagement logs (opt-in, local-only, content-free).
 *
 * Records WHICH skills / tools / commands were invoked — never WHAT. The
 * privacy floor is structural, not a convention:
 *
 * - **Opt-in.** A disabled recorder is a {@link NoOpRecorder} (zero disk I/O,
 *   zero overhead). The factory decides once at construction.
 * - **No free text.** {@link EngagementEventSchema} is `.strict()` over an
 *   enum-driven shape — `name` is the only string and it is the artefact id,
 *   not user content. A caller cannot smuggle a prompt/completion through an
 *   extra field: unknown keys fail validation and the event is dropped
 *   (fail-open), never persisted.
 * - **Local-only, date-rotated JSONL** under `.event4u-agent/telemetry/`,
 *   mirroring the calibration log (T-706) so a user can delete a single day.
 *
 * Design ratified by AI council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-31 —
 * UNANIMOUS on strict schema, NoOp-when-disabled, date-rotated files,
 * top-N markdown report with an explicit no-content footer).
 */

export const ENGAGEMENT_SCHEMA_VERSION = 1;

export const EngagementKindSchema = z.enum(['skill', 'tool', 'command']);
export type EngagementKind = z.infer<typeof EngagementKindSchema>;

export const EngagementOutcomeSchema = z.enum(['started', 'succeeded', 'failed', 'cancelled']);
export type EngagementOutcome = z.infer<typeof EngagementOutcomeSchema>;

export const EngagementEventSchema = z
  .object({
    schema_version: z.literal(ENGAGEMENT_SCHEMA_VERSION).default(ENGAGEMENT_SCHEMA_VERSION),
    /** ISO-8601 UTC. */
    ts: z.string(),
    kind: EngagementKindSchema,
    /** Artefact id — the skill/tool/command NAME, never user content. */
    name: z.string().min(1),
    outcome: EngagementOutcomeSchema.optional(),
    duration_ms: z.number().int().nonnegative().optional(),
  })
  .strict();
export type EngagementEvent = z.infer<typeof EngagementEventSchema>;

/** What a caller supplies; `ts` + `schema_version` are stamped by the recorder. */
export interface RecordInput {
  kind: EngagementKind;
  name: string;
  outcome?: EngagementOutcome;
  durationMs?: number;
}

export interface EngagementRecorder {
  readonly enabled: boolean;
  record(input: RecordInput): Promise<void>;
}

/** Recorder used when telemetry is opted out — does nothing, touches no disk. */
export class NoOpEngagementRecorder implements EngagementRecorder {
  readonly enabled = false;
  async record(): Promise<void> {
    /* opt-out: intentionally no-op */
  }
}

export interface JsonlEngagementRecorderOptions {
  /** Directory the date-rotated JSONL files live in. */
  baseDir: string;
  /** Injected clock (ISO-8601). Defaults to the wall clock. */
  now?: () => string;
}

export class JsonlEngagementRecorder implements EngagementRecorder {
  readonly enabled = true;
  private readonly now: () => string;

  constructor(private readonly opts: JsonlEngagementRecorderOptions) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async record(input: RecordInput): Promise<void> {
    const ts = this.now();
    // Build ONLY from the allowlisted fields — never spread the caller input,
    // so a stray `{ prompt: ... }` can't reach the schema in the first place.
    const candidate = {
      schema_version: ENGAGEMENT_SCHEMA_VERSION,
      ts,
      kind: input.kind,
      name: input.name,
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.durationMs != null ? { duration_ms: input.durationMs } : {}),
    };
    const parsed = EngagementEventSchema.safeParse(candidate);
    if (!parsed.success) return; // fail-open: drop a malformed event, never throw
    await this.append(ts.slice(0, 10), parsed.data);
  }

  private pathFor(date: string): string {
    return join(this.opts.baseDir, `telemetry-${date}.jsonl`);
  }

  private async append(date: string, event: EngagementEvent): Promise<void> {
    await mkdir(this.opts.baseDir, { recursive: true });
    await appendFile(this.pathFor(date), `${JSON.stringify(event)}\n`, 'utf8');
  }
}

export interface CreateRecorderOptions extends JsonlEngagementRecorderOptions {
  enabled: boolean;
}

/**
 * Single construction point honouring the opt-in gate. `enabled: false`
 * (the default state) yields a {@link NoOpEngagementRecorder}.
 */
export function createEngagementRecorder(opts: CreateRecorderOptions): EngagementRecorder {
  if (!opts.enabled) return new NoOpEngagementRecorder();
  return new JsonlEngagementRecorder({ baseDir: opts.baseDir, now: opts.now });
}

/** Read every engagement event across all date-rotated files in `baseDir`. */
export async function readEngagementEvents(baseDir: string): Promise<EngagementEvent[]> {
  let files: string[];
  try {
    files = await readdir(baseDir);
  } catch {
    return [];
  }
  const jsonl = files.filter((f) => /^telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  const out: EngagementEvent[] = [];
  for (const file of jsonl) {
    const text = await readFile(join(baseDir, file), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const parsed = EngagementEventSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out;
}
