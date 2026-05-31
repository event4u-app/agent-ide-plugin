import { describe, expect, it } from 'vitest';
import type { FileChange, ReviewIssue, Severity } from '../review/types.js';
import type { RunReviewResult } from '../review/run.js';
import { summarizeReview } from './review-summary.js';

function issue(id: string, severity: Severity, confidence?: number): ReviewIssue {
  return {
    id,
    file: 'a.ts',
    line: 1,
    description: id,
    severity,
    category: 'bug',
    ...(confidence === undefined ? {} : { confidence }),
  };
}

const CHANGES: FileChange[] = [
  {
    file: 'a.ts',
    status: 'modified',
    binary: false,
    hunks: [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 3,
        section: '',
        changes: [
          { kind: 'context', oldLine: 1, newLine: 1, text: 'ctx' },
          { kind: 'add', oldLine: null, newLine: 2, text: 'added one' },
          { kind: 'add', oldLine: null, newLine: 3, text: 'added two' },
          { kind: 'del', oldLine: 2, newLine: null, text: 'removed' },
        ],
      },
    ],
  },
];

function result(issues: ReviewIssue[], potentialIssues: ReviewIssue[] = []): RunReviewResult {
  return { reviews: [], issues, potentialIssues, files: ['a.ts'] };
}

describe('summarizeReview', () => {
  it('counts additions/deletions from the source diff', () => {
    const summary = summarizeReview(result([]), CHANGES);
    expect(summary.filesChanged).toBe(1);
    expect(summary.additions).toBe(2);
    expect(summary.deletions).toBe(1);
  });

  it('emits exhaustive, zero-initialised severity counts', () => {
    const summary = summarizeReview(result([issue('x', 'high'), issue('y', 'high')]), CHANGES);
    expect(Object.keys(summary.findingsBySeverity).sort()).toEqual(
      ['critical', 'high', 'info', 'low', 'medium'].sort(),
    );
    expect(summary.findingsBySeverity.high).toBe(2);
    expect(summary.findingsBySeverity.critical).toBe(0);
    expect(summary.totalFindings).toBe(2);
  });

  it('orders topFindings by severity then confidence and caps at topN', () => {
    const issues = [
      issue('low1', 'low', 0.9),
      issue('crit', 'critical', 0.3),
      issue('high-lo', 'high', 0.2),
      issue('high-hi', 'high', 0.8),
    ];
    const summary = summarizeReview(result(issues), CHANGES, { topN: 3 });
    expect(summary.topFindings.map((f) => f.id)).toEqual(['crit', 'high-hi', 'high-lo']);
  });

  it('reports potential findings separately', () => {
    const summary = summarizeReview(result([], [issue('p', 'medium')]), CHANGES);
    expect(summary.totalFindings).toBe(0);
    expect(summary.potentialFindings).toBe(1);
  });
});
