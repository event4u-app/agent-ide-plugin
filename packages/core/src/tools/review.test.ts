import { describe, expect, it } from 'vitest';
import { planToReview } from './review.js';
import type { WriteFilesPlan } from './write-files.js';

function plan(over: Partial<WriteFilesPlan> = {}): WriteFilesPlan {
  return {
    files: [
      {
        path: 'src/a.ts',
        absPath: '/repo/src/a.ts',
        oldContent: 'a',
        newContent: 'b',
        isNewFile: false,
        diff: '@@ -1 +1 @@\n-a\n+b',
      },
      {
        path: 'src/new.ts',
        absPath: '/repo/src/new.ts',
        oldContent: '',
        newContent: 'fresh',
        isNewFile: true,
        diff: '@@ -0,0 +1 @@\n+fresh',
      },
    ],
    edits: [],
    ok: true,
    ...over,
  };
}

describe('planToReview', () => {
  it('maps a plan to a diff review of per-file diffs', () => {
    const review = planToReview(plan());
    expect(review.kind).toBe('diff');
    expect(review.files).toEqual([
      { path: 'src/a.ts', diff: '@@ -1 +1 @@\n-a\n+b', isNewFile: false },
      { path: 'src/new.ts', diff: '@@ -0,0 +1 @@\n+fresh', isNewFile: true },
    ]);
  });

  it('drops the heavy oldContent / newContent / absPath fields from the wire payload', () => {
    const review = planToReview(plan());
    expect(Object.keys(review.files[0]!).sort()).toEqual(['diff', 'isNewFile', 'path']);
  });

  it('yields an empty diff for a plan with no resolved files', () => {
    const review = planToReview(plan({ files: [] }));
    expect(review.files).toEqual([]);
  });
});
