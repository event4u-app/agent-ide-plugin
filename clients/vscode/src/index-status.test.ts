import { describe, expect, it, vi } from 'vitest';
import type { Envelope, RootIndexStatus } from '@event4u-agent/protocol';
import { IndexStatusController, extractStatuses, presentIndexStatus } from './index-status.js';

function root(
  stableId: string,
  state: RootIndexStatus['state'],
  fileCount: number,
  totalFiles: number | null = null,
  message: string | null = null,
): RootIndexStatus {
  return { stableId, state, fileCount, totalFiles, message };
}

function reply(statuses: RootIndexStatus[]): Envelope {
  return { messageId: 'm', messageType: 'rootStatus', data: { status: statuses }, done: true };
}

describe('presentIndexStatus', () => {
  it('reports idle for an empty list', () => {
    expect(presentIndexStatus([]).text).toBe('Index: idle');
  });

  it('sums indexed files when all ready', () => {
    expect(presentIndexStatus([root('a', 'ready', 120), root('b', 'ready', 80)]).text).toBe(
      'Index ready · 200 files',
    );
  });

  it('shows N/M when every indexing root knows its total', () => {
    expect(presentIndexStatus([root('a', 'indexing', 40, 100)]).text).toBe(
      'Indexing 40/100 files…',
    );
  });

  it('drops the denominator when any total is unknown', () => {
    expect(
      presentIndexStatus([root('a', 'indexing', 40, 100), root('b', 'indexing', 10, null)]).text,
    ).toBe('Indexing 50 files…');
  });

  it('lets error outrank indexing and ready', () => {
    const v = presentIndexStatus([
      root('a', 'ready', 100),
      root('b', 'indexing', 5),
      root('c', 'error', 0, null, 'EACCES'),
    ]);
    expect(v.text).toBe('Index: error (1)');
    expect(v.tooltip).toContain('EACCES');
  });

  it('carries a per-root tooltip line', () => {
    expect(presentIndexStatus([root('repo-1', 'ready', 42)]).tooltip).toContain(
      'repo-1: ready 42 files',
    );
  });
});

describe('extractStatuses', () => {
  it('pulls the status array out of a reply payload', () => {
    expect(extractStatuses({ status: [root('a', 'ready', 1)] })).toHaveLength(1);
  });

  it('returns undefined for a missing / non-array status', () => {
    expect(extractStatuses(undefined)).toBeUndefined();
    expect(extractStatuses({})).toBeUndefined();
    expect(extractStatuses({ status: 'nope' })).toBeUndefined();
  });
});

describe('IndexStatusController', () => {
  it('renders the seed then polls rootStatus until indexing settles', async () => {
    vi.useFakeTimers();
    try {
      const renders: string[] = [];
      let call = 0;
      const request = vi.fn(async () => {
        call += 1;
        return reply(call === 1 ? [root('a', 'indexing', 5, 10)] : [root('a', 'ready', 10)]);
      });
      const ctrl = new IndexStatusController(request, (v) => renders.push(v.text), 1000);

      ctrl.applyReply({ status: [root('a', 'indexing', 0, 10)] });
      expect(renders[0]).toContain('Indexing');

      await vi.advanceTimersByTimeAsync(1000); // poll 1 → still indexing
      await vi.advanceTimersByTimeAsync(1000); // poll 2 → ready → stop

      expect(request).toHaveBeenCalledTimes(2);
      expect(renders[renders.length - 1]).toBe('Index ready · 10 files');

      await vi.advanceTimersByTimeAsync(3000); // no further polls after settle
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll when the seed is already settled', () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn();
      const ctrl = new IndexStatusController(request, () => {}, 1000);
      ctrl.applyReply({ status: [root('a', 'ready', 10)] });
      vi.advanceTimersByTime(5000);
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
