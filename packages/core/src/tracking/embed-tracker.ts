/**
 * Embed cost-tracking (T-806 follow-up, ADR-053).
 *
 * Turns each real remote embed call (the {@link EmbedUsage} signal emitted by
 * `RemoteEmbedder`) into a priced `activity: "context-compression"` step event
 * in `tracking.db`. This is the accounting half the `remote-embedder.ts`
 * comment names: "each remote embed is a step event … that accounting lives in
 * the tracking layer; this class is the transport."
 *
 * Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-06-02) UNANIMOUS Q0–Q4/Q6=A:
 *   - Q1 callback seam (Embedder interface unchanged; only RemoteEmbedder bills).
 *   - Q2 price known embedding models from the book; UNKNOWN → usd:0 (never throw
 *     via `requireModel`) with a `priced:false` meta flag, not a silent global.
 *   - Q3 track both index + query embeds (all real remote spend).
 *   - Q4 TRACK-ONLY — the usage signal fires AFTER the call returns, so it can
 *     never pre-gate; gating background indexing would break it.
 *   - Q5 synthetic `conversation_id`, `stop_reason:'completed'`, `mode:'api'`.
 *   - Q6 fail-soft — a tracking write MUST NEVER break the embed/turn.
 */

import type { EmbedUsage, EmbedUsageCallback } from '../context/remote-embedder.js';
import type { PricingBook } from '../pricing/loader.js';
import type { TrackingDb } from './db.js';

export interface EmbedTrackerOptions {
  db: TrackingDb;
  pricing: PricingBook;
  /** Repo root — keys the synthetic conversation id so spend aggregates per workspace. */
  cwd: string;
  /** ISO timestamp source — injectable for deterministic tests. */
  isoNow?: () => string;
}

/**
 * Build the {@link EmbedUsageCallback} to pass into `resolveActiveEmbedder`.
 * Each invocation writes one priced step event, fire-and-forget and fail-soft:
 * the embed already returned its vectors, so a tracking error is swallowed.
 */
export function createEmbedTracker(opts: EmbedTrackerOptions): EmbedUsageCallback {
  const isoNow = opts.isoNow ?? (() => new Date().toISOString());
  const conversationId = `context-compression:${opts.cwd}`;
  let stepIndex = 0;

  return (usage: EmbedUsage): void => {
    // Price from the book WITHOUT `requireModel` (which throws on unknown):
    // embeddings have input tokens only, so a direct input-rate calc suffices
    // and an unknown embedding model degrades to usd:0 + a `priced:false` flag.
    const model = opts.pricing.getModel(usage.model);
    const usd = model ? (usage.tokens / 1_000_000) * model.input_per_mtok : 0;

    // Fire-and-forget: the EmbedUsageCallback is synchronous, the write is not.
    // A rejected write is swallowed — accounting is best-effort, never a turn
    // dependency (mirrors the fail-soft embed path in ContextEngine).
    void opts.db
      .writeStep({
        ts: isoNow(),
        conversation_id: conversationId,
        step_index: stepIndex++,
        activity: 'context-compression',
        mode: 'api',
        model: usage.model,
        stop_reason: 'completed',
        input_tokens: usage.tokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        usd,
        pricing_book_version: opts.pricing.data.version,
        duration_ms: 0,
        meta: { provider: usage.model.split(':')[0], batch: usage.batch, priced: !!model },
      })
      .catch(() => {
        // best-effort; the next call re-attempts a fresh row.
      });
  };
}
