import type { StepEvent } from './db.js';
import type { TrackingDb } from './db.js';

/**
 * T-507 — Multi-provider Cost-Dashboard fixture data.
 *
 * Synthetic step events spanning the four providers (Anthropic, OpenAI,
 * Google/Gemini, and an OpenAI-compatible endpoint) across API + CLI transport
 * modes. Sprint 7's Cost Dashboard reads these to exercise per-provider /
 * per-mode breakdowns without needing live API spend. Deterministic by design
 * — fixed timestamps and token counts so dashboard snapshots are stable.
 */

interface FixtureRow {
  provider: string;
  mode: 'api' | 'cli';
  model: string;
  activity: StepEvent['activity'];
  input: number;
  output: number;
  cacheRead?: number;
  thinking?: number;
  usd: number;
}

const ROWS: FixtureRow[] = [
  // Anthropic — API and CLI (claude-cli).
  {
    provider: 'anthropic',
    mode: 'api',
    model: 'claude-sonnet-4-6',
    activity: 'chat',
    input: 4200,
    output: 850,
    cacheRead: 3000,
    usd: 0.0264,
  },
  {
    provider: 'anthropic',
    mode: 'cli',
    model: 'claude-sonnet-4-6',
    activity: 'cli-agent',
    input: 9100,
    output: 1200,
    usd: 0.0453,
  },
  // OpenAI — API (o-series reasoning) + Codex CLI.
  {
    provider: 'openai',
    mode: 'api',
    model: 'gpt-5',
    activity: 'agent',
    input: 5600,
    output: 1400,
    thinking: 600,
    usd: 0.042,
  },
  {
    provider: 'codex',
    mode: 'cli',
    model: 'gpt-5-codex',
    activity: 'cli-agent',
    input: 30900,
    output: 5,
    thinking: 0,
    cacheRead: 22400,
    usd: 0.031,
  },
  // Google / Gemini — CLI (the shipped Gemini transport) + API.
  {
    provider: 'gemini',
    mode: 'cli',
    model: 'gemini-3-flash-preview',
    activity: 'cli-agent',
    input: 38800,
    output: 60,
    usd: 0.0039,
  },
  {
    provider: 'gemini',
    mode: 'api',
    model: 'gemini-3-pro',
    activity: 'agent',
    input: 7200,
    output: 1800,
    usd: 0.027,
  },
  // OpenAI-compatible endpoint (Groq) — API only.
  {
    provider: 'groq',
    mode: 'api',
    model: 'llama-3.3-70b',
    activity: 'chat',
    input: 3100,
    output: 720,
    usd: 0.0012,
  },
];

export interface FixtureOptions {
  /** Base ISO timestamp; rows are spaced 1 minute apart. Default fixed date. */
  baseTs?: string;
  /** Conversation id stamped on every row. */
  conversationId?: string;
  /** Pricing-book version that priced the rows. */
  pricingBookVersion?: number;
}

/**
 * Build the deterministic multi-provider step-event set. Pure — no I/O, no
 * clock reads — so callers can snapshot it or seed any `TrackingDb`.
 */
export function buildMultiProviderFixture(opts: FixtureOptions = {}): StepEvent[] {
  const base = Date.parse(opts.baseTs ?? '2026-05-30T12:00:00.000Z');
  const conversationId = opts.conversationId ?? 'fixture-multi-provider';
  const pricingBookVersion = opts.pricingBookVersion ?? 1;
  return ROWS.map((row, i) => ({
    ts: new Date(base + i * 60_000).toISOString(),
    conversation_id: conversationId,
    step_index: i,
    activity: row.activity,
    mode: row.mode,
    model: row.model,
    stop_reason: 'end_turn',
    input_tokens: row.input,
    output_tokens: row.output,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: row.cacheRead ?? 0,
    usd: row.usd,
    pricing_book_version: pricingBookVersion,
    duration_ms: 1200 + i * 300,
    meta: {
      provider: row.provider,
      ...(row.thinking !== undefined ? { thinking_tokens: row.thinking } : {}),
    },
  }));
}

/** Seed a {@link TrackingDb} with the multi-provider fixture. Returns row count. */
export async function seedMultiProviderFixture(
  db: TrackingDb,
  opts: FixtureOptions = {},
): Promise<number> {
  const events = buildMultiProviderFixture(opts);
  for (const event of events) {
    await db.writeStep(event);
  }
  return events.length;
}
