import type { Activity, StepEvent } from './db.js';
import { StepEventSchema } from './db.js';

/**
 * Live step-event recording (T-408 wiring; ADR-035).
 *
 * The `TrackingDb` (db.ts) and the cost/shadow summarizers shipped fully built
 * but nothing in the live dispatcher ever recorded a step — the chat/agent
 * turns priced their usage for the budget tracker but never persisted a
 * `step_events.jsonl` row, so the Cost Dashboard (T-707) had no real data.
 *
 * This module is the narrow seam the turn handlers write through. A
 * {@link StepRecorder} is the minimal sink (the `TrackingDb` satisfies it
 * structurally via `writeStep`), injected the same way the {@link
 * BudgetRecorder} is. {@link buildStepEvent} is the pure, validated builder the
 * handlers call at turn-finalize — the SAME exactly-once point as `recordSpend`
 * — so step recording inherits the budget recorder's correctness guarantees:
 * an errored turn throws before this runs (never records), a cancelled turn
 * records its partial usage at most once.
 */

/** Minimal sink for one recorded step. `TrackingDb.writeStep` satisfies it. */
export interface StepRecorder {
  writeStep(event: StepEvent): Promise<void>;
}

/** Token usage carried into a recorded step (the chat/agent `LlmUsage` shape). */
export interface StepUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface StepEventInput {
  conversationId: string;
  /** Monotonic per-conversation step index; the handler derives it from the
   * persisted message history so it survives a restart (no process counter). */
  stepIndex: number;
  activity: Activity;
  mode: 'api' | 'cli';
  model: string;
  stopReason: string;
  usage: StepUsage;
  /** Book-rate cost of the step (real for api, shadow for cli). */
  usd: number;
  /** Pricing-book version that priced the row — always a positive int (the
   * caller only records when a pricing book + known model are present). */
  pricingBookVersion: number;
  durationMs: number;
  /** Injectable clock for deterministic tests. Defaults to the wall clock. */
  now?: () => Date;
}

/** Build a validated {@link StepEvent} from the data a turn has at finalize. */
export function buildStepEvent(input: StepEventInput): StepEvent {
  const now = input.now ?? (() => new Date());
  return StepEventSchema.parse({
    ts: now().toISOString(),
    conversation_id: input.conversationId,
    step_index: input.stepIndex,
    activity: input.activity,
    mode: input.mode,
    model: input.model,
    stop_reason: input.stopReason,
    input_tokens: input.usage.input_tokens,
    output_tokens: input.usage.output_tokens,
    cache_creation_input_tokens: input.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: input.usage.cache_read_input_tokens ?? 0,
    usd: input.usd,
    pricing_book_version: input.pricingBookVersion,
    duration_ms: input.durationMs,
  });
}
