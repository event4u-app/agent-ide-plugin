import { describe, expect, it } from 'vitest';
import { aggregateEngagement, renderEngagementReport, exportEngagementReport } from './report.js';
import type { EngagementEvent } from './engagement.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlEngagementRecorder } from './engagement.js';

function ev(
  partial: Partial<EngagementEvent> & Pick<EngagementEvent, 'kind' | 'name'>,
): EngagementEvent {
  return {
    schema_version: 1,
    ts: partial.ts ?? '2026-05-31T10:00:00.000Z',
    kind: partial.kind,
    name: partial.name,
    outcome: partial.outcome,
    duration_ms: partial.duration_ms,
  };
}

describe('aggregateEngagement', () => {
  const events: EngagementEvent[] = [
    ev({
      kind: 'skill',
      name: 'laravel',
      outcome: 'succeeded',
      duration_ms: 100,
      ts: '2026-05-30T10:00:00.000Z',
    }),
    ev({
      kind: 'skill',
      name: 'laravel',
      outcome: 'failed',
      duration_ms: 300,
      ts: '2026-05-31T10:00:00.000Z',
    }),
    ev({
      kind: 'skill',
      name: 'pest-testing',
      outcome: 'succeeded',
      ts: '2026-05-31T11:00:00.000Z',
    }),
    ev({ kind: 'command', name: '/commit', ts: '2026-05-31T12:00:00.000Z' }),
    ev({ kind: 'tool', name: 'grep', ts: '2026-05-31T13:00:00.000Z' }),
  ];

  it('counts, ranks, and averages per kind', () => {
    const r = aggregateEngagement(events);
    expect(r.total).toBe(5);
    expect(r.byKind.skill[0]).toMatchObject({
      name: 'laravel',
      count: 2,
      succeeded: 1,
      failed: 1,
      avgDurationMs: 200,
    });
    expect(r.byKind.skill[1].name).toBe('pest-testing');
    expect(r.byKind.command[0].name).toBe('/commit');
    expect(r.byKind.tool[0].name).toBe('grep');
  });

  it('builds a daily activity series', () => {
    const r = aggregateEngagement(events);
    expect(r.daily).toEqual([
      { date: '2026-05-30', skill: 1, tool: 0, command: 0, total: 1 },
      { date: '2026-05-31', skill: 2, tool: 1, command: 1, total: 4 },
    ]);
  });

  it('filters by date range inclusively', () => {
    const r = aggregateEngagement(events, { from: '2026-05-31', to: '2026-05-31' });
    expect(r.total).toBe(4);
    expect(r.daily).toHaveLength(1);
  });

  it('honours topN', () => {
    const many: EngagementEvent[] = Array.from({ length: 5 }, (_, i) =>
      ev({ kind: 'skill', name: `skill-${i}` }),
    );
    expect(aggregateEngagement(many, { topN: 2 }).byKind.skill).toHaveLength(2);
  });
});

describe('renderEngagementReport', () => {
  it('renders tables and the no-content guarantee footer', () => {
    const md = renderEngagementReport(
      aggregateEngagement([ev({ kind: 'skill', name: 'laravel', outcome: 'succeeded' })]),
    );
    expect(md).toContain('# Artifact Engagement Report');
    expect(md).toContain('Top Skills');
    expect(md).toContain('| laravel | 1 | 1 | 0 |');
    expect(md).toContain('only invocation metadata');
  });

  it('handles empty data with _none_ rows', () => {
    const md = renderEngagementReport(aggregateEngagement([]));
    expect(md).toContain('Total invocations:** 0');
    expect(md).toContain('_none_');
  });
});

describe('exportEngagementReport', () => {
  it('reads from disk and renders markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tel-report-'));
    try {
      const rec = new JsonlEngagementRecorder({
        baseDir: dir,
        now: () => '2026-05-31T09:00:00.000Z',
      });
      await rec.record({ kind: 'command', name: '/refine-ticket', outcome: 'succeeded' });
      const md = await exportEngagementReport(dir);
      expect(md).toContain('/refine-ticket');
      expect(md).toContain('Total invocations:** 1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
