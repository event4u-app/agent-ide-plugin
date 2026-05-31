import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_CHECKPOINTS, deriveTitle, foldConversation, parseEvents } from './fold.js';

function line(event: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, ...event });
}

describe('foldConversation', () => {
  it('returns undefined when there is no created event', () => {
    expect(
      foldConversation([line({ type: 'message', at: 'a', id: 'm1', role: 'user', content: 'hi' })]),
    ).toBeUndefined();
  });

  it('folds created + messages into a conversation, assigning turn indices', () => {
    const conv = foldConversation([
      line({ type: 'created', at: '2026-01-01T00:00:00Z', id: 'c1' }),
      line({
        type: 'message',
        at: '2026-01-01T00:00:01Z',
        id: 'm1',
        role: 'user',
        content: 'first',
      }),
      line({
        type: 'message',
        at: '2026-01-01T00:00:02Z',
        id: 'm2',
        role: 'assistant',
        content: 'second',
      }),
    ]);
    expect(conv?.id).toBe('c1');
    expect(conv?.messages.map((m) => m.turnIndex)).toEqual([0, 1]);
    expect(conv?.messages[1]?.content).toBe('second');
    expect(conv?.updatedAt).toBe('2026-01-01T00:00:02Z');
  });

  it('derives the title from the first user message when none is set', () => {
    const conv = foldConversation([
      line({ type: 'created', at: 'a', id: 'c1' }),
      line({ type: 'message', at: 'b', id: 'm1', role: 'system', content: 'sys' }),
      line({ type: 'message', at: 'c', id: 'm2', role: 'user', content: 'Fix the login bug' }),
    ]);
    expect(conv?.title).toBe('Fix the login bug');
  });

  it('prefers an explicit title and lets meta override it', () => {
    const conv = foldConversation([
      line({ type: 'created', at: 'a', id: 'c1', title: 'Original' }),
      line({ type: 'message', at: 'b', id: 'm1', role: 'user', content: 'whatever' }),
      line({ type: 'meta', at: 'c', title: 'Renamed' }),
    ]);
    expect(conv?.title).toBe('Renamed');
  });

  it('tolerates blank, non-JSON, and schema-invalid lines (fail-open)', () => {
    const conv = foldConversation([
      '',
      line({ type: 'created', at: 'a', id: 'c1' }),
      'not json at all',
      JSON.stringify({ v: 1, type: 'message', at: 'b', id: 'm1', role: 'banana', content: 'x' }), // bad role
      line({ type: 'message', at: 'c', id: 'm2', role: 'user', content: 'good' }),
      '{ torn line', // simulated partial write
    ]);
    expect(conv?.messages).toHaveLength(1);
    expect(conv?.messages[0]?.content).toBe('good');
  });

  it('carries fork lineage from the created event', () => {
    const conv = foldConversation([
      line({ type: 'created', at: 'a', id: 'c2', parentId: 'c1', forkedFromTurnIndex: 2 }),
    ]);
    expect(conv?.parentId).toBe('c1');
    expect(conv?.forkedFromTurnIndex).toBe(2);
  });

  it('retains only the most recent checkpoints up to the cap', () => {
    const events = [line({ type: 'created', at: 'a', id: 'c1' })];
    for (let i = 0; i < DEFAULT_MAX_CHECKPOINTS + 5; i++) {
      events.push(
        line({ type: 'checkpoint', at: `t${i}`, id: `cp${i}`, turnIndex: i, changedFiles: [] }),
      );
    }
    const conv = foldConversation(events);
    expect(conv?.checkpoints).toHaveLength(DEFAULT_MAX_CHECKPOINTS);
    // The newest checkpoint survives; the oldest is dropped.
    expect(conv?.checkpoints.at(-1)?.id).toBe(`cp${DEFAULT_MAX_CHECKPOINTS + 4}`);
    expect(conv?.checkpoints[0]?.id).toBe('cp5');
  });

  it('honours an explicit maxCheckpoints of 0', () => {
    const conv = foldConversation(
      [
        line({ type: 'created', at: 'a', id: 'c1' }),
        line({ type: 'checkpoint', at: 'b', id: 'cp1', turnIndex: 0, changedFiles: [] }),
      ],
      { maxCheckpoints: 0 },
    );
    expect(conv?.checkpoints).toHaveLength(0);
  });
});

describe('parseEvents', () => {
  it('drops malformed records and keeps valid ones in order', () => {
    const events = parseEvents([
      line({ type: 'created', at: 'a', id: 'c1' }),
      'garbage',
      line({ type: 'message', at: 'b', id: 'm1', role: 'user', content: 'x' }),
    ]);
    expect(events.map((e) => e.type)).toEqual(['created', 'message']);
  });
});

describe('deriveTitle', () => {
  it('uses the first non-empty line and clamps to 80 chars', () => {
    expect(deriveTitle('\n\n  Hello world  \nsecond line')).toBe('Hello world');
    const long = 'x'.repeat(100);
    expect(deriveTitle(long).endsWith('…')).toBe(true);
    expect(deriveTitle(long).length).toBeLessThanOrEqual(81);
  });
});
