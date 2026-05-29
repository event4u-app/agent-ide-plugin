import { describe, expect, it } from 'vitest';
import {
  clusterIssues,
  jaccard,
  ngrams,
  normalizeIssueText,
  NgramJaccardSimilarity,
  tokenize,
} from './clustering.js';
import type { ReviewIssue } from './types.js';

function issue(over: Partial<ReviewIssue>): ReviewIssue {
  return {
    id: Math.random().toString(36).slice(2),
    file: 'a.ts',
    line: 10,
    description: 'off by one in the loop bound',
    severity: 'high',
    category: 'bug',
    ...over,
  };
}

describe('normalizeIssueText', () => {
  it('masks numbers + string literals and drops generic filler', () => {
    const norm = normalizeIssueText(
      issue({ description: 'Missing null check could be a bug on line 42 for "user"' }),
    );
    expect(norm).toContain('<num>');
    expect(norm).toContain('<str>');
    expect(norm).toBe(norm.toLowerCase());
  });
});

describe('tokenize', () => {
  it('drops generic review filler words', () => {
    const tokens = tokenize(
      normalizeIssueText(issue({ description: 'Missing null check is a bug' })),
    );
    expect(tokens).not.toContain('missing');
    expect(tokens).not.toContain('bug');
    expect(tokens).toContain('null');
    expect(tokens).toContain('check');
  });
});

describe('ngrams + jaccard', () => {
  it('produces word trigrams and a token-set fallback for short input', () => {
    expect(ngrams(tokenize('alpha beta gamma delta')).size).toBe(2);
    expect([...ngrams(tokenize('alpha beta'))]).toEqual(['alpha', 'beta']);
  });
  it('jaccard of identical sets is 1, disjoint is 0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });
});

describe('NgramJaccardSimilarity.connected', () => {
  const sim = new NgramJaccardSimilarity();

  it('connects the same finding phrased identically on nearby lines', () => {
    const a = issue({ line: 10, description: 'array index overruns the buffer boundary here' });
    const b = issue({ line: 11, description: 'array index overruns the buffer boundary here' });
    expect(sim.connected(a, b)).toBe(true);
  });

  it('never connects findings in different files', () => {
    const a = issue({ file: 'a.ts', description: 'array index overruns the buffer boundary' });
    const b = issue({ file: 'b.ts', description: 'array index overruns the buffer boundary' });
    expect(sim.connected(a, b)).toBe(false);
  });

  it('does not connect distinct bugs that merely share boilerplate', () => {
    const a = issue({ line: 10, description: 'unchecked array index overrun on read path' });
    const b = issue({ line: 10, description: 'race condition on the shared counter mutation' });
    expect(sim.connected(a, b)).toBe(false);
  });

  it('does not connect the same wording when lines are far apart', () => {
    const a = issue({ line: 10, description: 'array index overruns the buffer boundary here' });
    const b = issue({ line: 40, description: 'array index overruns the buffer boundary here' });
    expect(sim.connected(a, b)).toBe(false);
  });
});

describe('clusterIssues', () => {
  it('votes by distinct source run, not by member count', () => {
    const desc = 'array index overruns the buffer boundary on the read path';
    const issues = [
      issue({ line: 10, description: desc, sourceRun: 0 }),
      issue({ line: 10, description: desc, sourceRun: 1 }),
      issue({ line: 11, description: desc, sourceRun: 1 }), // same run → no extra vote
      issue({ line: 50, description: 'totally unrelated concurrency hazard', sourceRun: 2 }),
    ];
    const clusters = clusterIssues(issues, new NgramJaccardSimilarity());
    const big = clusters.find((c) => c.members.length >= 2);
    expect(big?.votes).toBe(2); // runs {0,1}, not 3 members
    expect(clusters).toHaveLength(2);
  });
});
