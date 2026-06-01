import { describe, expect, it } from 'vitest';
import { StepEventSchema } from './db.js';
import { buildStepEvent } from './step-recorder.js';

/**
 * ADR-035 — `buildStepEvent` builds a validated StepEvent from the data a turn
 * has at finalize. Pure + clock-injectable so the handler integration stays
 * deterministic.
 */
describe('buildStepEvent', () => {
  const base = {
    conversationId: 'c1',
    stepIndex: 2,
    activity: 'chat' as const,
    mode: 'api' as const,
    model: 'claude-sonnet-4-6',
    stopReason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 },
    usd: 0.0123,
    pricingBookVersion: 7,
    durationMs: 412,
    now: () => new Date('2026-06-02T10:00:00.000Z'),
  };

  it('produces a schema-valid StepEvent with the injected clock', () => {
    const event = buildStepEvent(base);
    expect(StepEventSchema.safeParse(event).success).toBe(true);
    expect(event.ts).toBe('2026-06-02T10:00:00.000Z');
    expect(event.conversation_id).toBe('c1');
    expect(event.step_index).toBe(2);
    expect(event.activity).toBe('chat');
    expect(event.usd).toBeCloseTo(0.0123);
    expect(event.pricing_book_version).toBe(7);
  });

  it('defaults the cache token buckets to 0 when absent', () => {
    const event = buildStepEvent(base);
    expect(event.cache_creation_input_tokens).toBe(0);
    expect(event.cache_read_input_tokens).toBe(0);
  });

  it('carries cache buckets through when present', () => {
    const event = buildStepEvent({
      ...base,
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_creation_input_tokens: 14200,
        cache_read_input_tokens: 200,
      },
    });
    expect(event.cache_creation_input_tokens).toBe(14200);
    expect(event.cache_read_input_tokens).toBe(200);
  });

  it('rejects a non-positive pricing_book_version (schema hard-gate)', () => {
    expect(() => buildStepEvent({ ...base, pricingBookVersion: 0 })).toThrow();
  });
});
