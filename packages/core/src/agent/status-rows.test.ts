import { describe, expect, it } from 'vitest';
import type { StatusRowAnnotation } from '@event4u-agent/protocol';

import { resolveMode } from './modes.js';
import {
  buildStatusRows,
  statusRowsForMode,
  transitionStatusRow,
  type StatusRowDescriptor,
} from './status-rows.js';

const descriptors: StatusRowDescriptor[] = [
  { statusId: 'phase-refine', label: 'Refine', phase: 'refine' },
  { statusId: 'phase-implement', label: 'Implement', phase: 'implement' },
  { statusId: 'phase-report', label: 'Report', phase: 'report' },
];

describe('buildStatusRows', () => {
  it('emits one row per descriptor, in order, all pending without an activeIndex', () => {
    const rows = buildStatusRows(descriptors);
    expect(rows.map((r) => r.statusId)).toEqual([
      'phase-refine',
      'phase-implement',
      'phase-report',
    ]);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
    expect(rows.every((r) => r.kind === 'status-row')).toBe(true);
  });

  it('marks earlier rows done, the active row active, later rows pending', () => {
    const rows = buildStatusRows(descriptors, { activeIndex: 1 });
    expect(rows.map((r) => r.state)).toEqual(['done', 'active', 'pending']);
  });

  it('carries phase only when the descriptor sets it', () => {
    const rows = buildStatusRows([
      { statusId: 'indexing', label: 'Indexing' },
      { statusId: 'phase-plan', label: 'Plan', phase: 'plan' },
    ]);
    expect(rows[0]?.phase).toBeUndefined();
    expect(rows[1]?.phase).toBe('plan');
  });

  it('treats an out-of-range activeIndex as all-pending', () => {
    expect(buildStatusRows(descriptors, { activeIndex: 9 }).map((r) => r.state)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('does not mutate its input descriptors', () => {
    const input: StatusRowDescriptor[] = [{ statusId: 'a', label: 'A', phase: 'refine' }];
    const snapshot = JSON.stringify(input);
    buildStatusRows(input, { activeIndex: 0 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('emits an empty array for no descriptors', () => {
    expect(buildStatusRows([])).toEqual([]);
  });
});

describe('statusRowsForMode', () => {
  it('derives one row per directive phase with stable ids and title-cased labels', () => {
    const rows = statusRowsForMode(resolveMode('edit'));
    expect(rows.map((r) => r.statusId)).toEqual([
      'phase-refine',
      'phase-plan',
      'phase-implement',
      'phase-verify',
      'phase-report',
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Refine', 'Plan', 'Implement', 'Verify', 'Report']);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
  });

  it('respects a mode-specific phase subset (ask runs two phases)', () => {
    const rows = statusRowsForMode(resolveMode('ask'));
    expect(rows.map((r) => r.phase)).toEqual(['refine', 'report']);
  });

  it('marks the current phase active, earlier done, later pending', () => {
    const rows = statusRowsForMode(resolveMode('edit'), 'implement');
    expect(rows.map((r) => r.state)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
  });

  it('leaves every row pending when the current phase is not in the directive', () => {
    const rows = statusRowsForMode(resolveMode('ask'), 'implement');
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
  });
});

function row(state: StatusRowAnnotation['state']): StatusRowAnnotation {
  return {
    kind: 'status-row',
    statusId: 'phase-implement',
    label: 'Implement',
    state,
    phase: 'implement',
  };
}

describe('transitionStatusRow', () => {
  it('pending --activate--> active', () => {
    const result = transitionStatusRow(row('pending'), { type: 'activate' });
    expect(result.changed).toBe(true);
    expect(result.next.state).toBe('active');
  });

  it('active --complete--> done', () => {
    const result = transitionStatusRow(row('active'), { type: 'complete' });
    expect(result.changed).toBe(true);
    expect(result.next.state).toBe('done');
  });

  it('fails from pending or active, attaching the reason to detail', () => {
    expect(
      transitionStatusRow(row('pending'), { type: 'fail', detail: 'boom' }).next,
    ).toMatchObject({
      state: 'error',
      detail: 'boom',
    });
    expect(transitionStatusRow(row('active'), { type: 'fail', detail: 'boom' }).next.state).toBe(
      'error',
    );
  });

  it('progress updates detail only, leaving state unchanged', () => {
    const result = transitionStatusRow(row('active'), { type: 'progress', detail: '50%' });
    expect(result.changed).toBe(true);
    expect(result.next.state).toBe('active');
    expect(result.next.detail).toBe('50%');
  });

  it('progress is allowed while pending and does not advance the state', () => {
    const result = transitionStatusRow(row('pending'), { type: 'progress', detail: 'queued' });
    expect(result.next.state).toBe('pending');
    expect(result.next.detail).toBe('queued');
  });

  it('no-ops an out-of-order activate (already active) without throwing', () => {
    const result = transitionStatusRow(row('active'), { type: 'activate' });
    expect(result.changed).toBe(false);
    expect(result.next.state).toBe('active');
  });

  it('no-ops complete from pending', () => {
    expect(transitionStatusRow(row('pending'), { type: 'complete' }).changed).toBe(false);
  });

  it('treats done and error as terminal and immutable', () => {
    for (const terminal of ['done', 'error'] as const) {
      expect(transitionStatusRow(row(terminal), { type: 'activate' }).changed).toBe(false);
      expect(transitionStatusRow(row(terminal), { type: 'complete' }).changed).toBe(false);
      expect(transitionStatusRow(row(terminal), { type: 'fail', detail: 'x' }).changed).toBe(false);
      expect(transitionStatusRow(row(terminal), { type: 'progress', detail: 'x' }).changed).toBe(
        false,
      );
    }
  });

  it('never mutates the input annotation', () => {
    const current = row('pending');
    const snapshot = JSON.stringify(current);
    transitionStatusRow(current, { type: 'activate' });
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});
