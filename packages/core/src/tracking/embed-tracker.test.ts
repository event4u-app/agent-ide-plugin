import { describe, expect, it, vi } from 'vitest';
import { PricingBook } from '../pricing/loader.js';
import { createEmbedTracker } from './embed-tracker.js';
import type { StepEvent, TrackingDb } from './db.js';

const YAML = `
version: 7
last_updated: '2026-06-02'
currency: USD
models:
  - id: 'openai:text-embedding-3-small'
    family: openai
    input_per_mtok: 0.02
    output_per_mtok: 0
    context_window: 8191
subscriptions: []
`;

const pricing = PricingBook.parse(YAML);

/** A TrackingDb stub capturing the (synchronously-issued) writeStep calls. */
function fakeDb(impl: (e: StepEvent) => Promise<void> = async () => {}) {
  const writeStep = vi.fn(impl);
  return { db: { writeStep } as unknown as TrackingDb, writeStep };
}

describe('createEmbedTracker', () => {
  it('writes a priced context-compression step for a known embedding model', () => {
    const { db, writeStep } = fakeDb();
    const track = createEmbedTracker({
      db,
      pricing,
      cwd: '/repo',
      isoNow: () => '2026-06-02T00:00:00.000Z',
    });

    track({ tokens: 1_000_000, model: 'openai:text-embedding-3-small', batch: 5 });

    expect(writeStep).toHaveBeenCalledOnce();
    const ev = writeStep.mock.calls[0]![0];
    expect(ev.activity).toBe('context-compression');
    expect(ev.mode).toBe('api');
    expect(ev.stop_reason).toBe('completed');
    expect(ev.conversation_id).toBe('context-compression:/repo');
    expect(ev.model).toBe('openai:text-embedding-3-small');
    expect(ev.input_tokens).toBe(1_000_000);
    expect(ev.output_tokens).toBe(0);
    expect(ev.usd).toBeCloseTo(0.02, 6); // 1M tokens × $0.02/Mtok
    expect(ev.pricing_book_version).toBe(7);
    expect(ev.meta).toEqual({ provider: 'openai', batch: 5, priced: true });
  });

  it('records usd:0 + priced:false for an embedding model absent from the book (never throws)', () => {
    const { db, writeStep } = fakeDb();
    const track = createEmbedTracker({ db, pricing, cwd: '/repo' });

    expect(() => track({ tokens: 500_000, model: 'voyage:unknown', batch: 1 })).not.toThrow();
    const ev = writeStep.mock.calls[0]![0];
    expect(ev.usd).toBe(0);
    expect(ev.input_tokens).toBe(500_000);
    expect(ev.meta).toMatchObject({ provider: 'voyage', priced: false });
  });

  it('assigns a monotonic step_index per call', () => {
    const { db, writeStep } = fakeDb();
    const track = createEmbedTracker({ db, pricing, cwd: '/repo' });

    track({ tokens: 10, model: 'openai:text-embedding-3-small', batch: 1 });
    track({ tokens: 20, model: 'openai:text-embedding-3-small', batch: 1 });

    expect(writeStep.mock.calls[0]![0].step_index).toBe(0);
    expect(writeStep.mock.calls[1]![0].step_index).toBe(1);
  });

  it('is fail-soft — a rejected write never throws into the embed path', () => {
    const { db } = fakeDb(async () => {
      throw new Error('disk full');
    });
    const track = createEmbedTracker({ db, pricing, cwd: '/repo' });
    expect(() =>
      track({ tokens: 10, model: 'openai:text-embedding-3-small', batch: 1 }),
    ).not.toThrow();
  });
});
