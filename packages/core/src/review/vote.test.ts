import { describe, expect, it } from 'vitest';
import type { LlmBackend } from '../llm/backend.js';
import type { LlmStreamEvent, LlmRequest } from '@event4u-agent/protocol';
import { groupVoteReview, mapWithConcurrency } from './vote.js';
import type { FileChange, ReviewIssue } from './types.js';
import type { ReviewObserver } from './pipeline.js';

const FILE = `function pick(arr, i) {
  return arr[i + 1];
}
function greet(user) {
  return 'hi ' + user.name;
}
`;

const change: FileChange = {
  file: 'a.ts',
  status: 'modified',
  binary: false,
  hunks: [
    {
      oldStart: 1,
      oldCount: 6,
      newStart: 1,
      newCount: 6,
      section: '',
      changes: [
        { kind: 'add', oldLine: null, newLine: 2, text: '  return arr[i + 1];' },
        { kind: 'add', oldLine: null, newLine: 5, text: "  return 'hi ' + user.name;" },
      ],
    },
  ],
};

const observer: ReviewObserver = { readFile: async () => FILE, now: () => 0 };

const ISSUE_A = {
  file: 'a.ts',
  startLine: 2,
  endLine: 2,
  verbatimSnippet: 'return arr[i + 1];',
  description: 'array index overruns the buffer boundary by one element',
  severity: 'high',
  category: 'bug',
  confidence: 0.9,
};
const ISSUE_B = {
  file: 'a.ts',
  startLine: 5,
  endLine: 5,
  verbatimSnippet: "return 'hi ' + user.name;",
  description: 'user object may be undefined causing a property access crash',
  severity: 'medium',
  category: 'bug',
  confidence: 0.7,
};
const HALLUCINATION = {
  file: 'a.ts',
  startLine: 5,
  endLine: 5,
  verbatimSnippet: "return 'hi ' + user.name;",
  description: 'string concatenation here hurts readability and should use a template',
  severity: 'low',
  category: 'style',
  confidence: 0.3,
};

/**
 * A backend that decides its response from the request itself, so concurrent
 * runs are deterministic: the run index comes from the sampling temperature,
 * the stage from the system prompt.
 */
function votingBackend(perRunStage1: Record<number, unknown[]>): LlmBackend {
  const runOf = (temp: number | undefined): number => Math.round(((temp ?? 0.2) - 0.2) / 0.15);
  return {
    id: 'voting',
    mode: 'api',
    async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      const sys = request.system ?? '';
      let tool: { name: string; input: unknown };
      if (sys.includes('skeptical second reviewer')) {
        // Critical pass: keep every candidate listed in the user message.
        const content =
          typeof request.messages[0]?.content === 'string' ? request.messages[0].content : '';
        const ids = [...content.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
        tool = {
          name: 'submit_decisions',
          input: { decisions: ids.map((id) => ({ issueId: id, keep: true })) },
        };
      } else if (sys.includes('stress-testing')) {
        tool = { name: 'submit_findings', input: { changeSummary: '', issues: [] } };
      } else {
        const run = runOf(request.temperature);
        tool = {
          name: 'submit_findings',
          input: { changeSummary: 'two functions', issues: perRunStage1[run] ?? [] },
        };
      }
      yield { kind: 'tool_use_start', id: 'x', name: tool.name };
      yield { kind: 'tool_use_end', id: 'x', name: tool.name, input: tool.input };
      yield { kind: 'stop', reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
}

describe('groupVoteReview — majority gate', () => {
  it('keeps ≥4/5 in issues, 3/5 in potentialIssues, drops 1/5 as noise', async () => {
    // A: runs 0..3 (4 votes). B: runs 0..2 (3 votes). Hallucination: run 0 only (1 vote).
    const backend = votingBackend({
      0: [ISSUE_A, ISSUE_B, HALLUCINATION],
      1: [ISSUE_A, ISSUE_B],
      2: [ISSUE_A, ISSUE_B],
      3: [ISSUE_A],
      4: [],
    });
    const review = await groupVoteReview(
      backend,
      ['a.ts'],
      [change],
      { config: { model: 'm' }, observer },
      { groupSize: 5 },
    );

    expect(review.issues).toHaveLength(1);
    expect(review.issues[0]?.line).toBe(2);
    expect(review.issues[0]?.votes).toBe(4);
    expect(review.issues[0]?.groupSize).toBe(5);
    expect(review.issues[0]?.confidence).toBeCloseTo(0.8, 5);

    expect(review.potentialIssues).toHaveLength(1);
    expect(review.potentialIssues[0]?.line).toBe(5);
    expect(review.potentialIssues[0]?.votes).toBe(3);

    // The 1/5 style hallucination is dropped entirely.
    const allLinesDescriptions = [...review.issues, ...review.potentialIssues].map(
      (i: ReviewIssue) => i.description,
    );
    expect(allLinesDescriptions.some((d) => d.includes('readability'))).toBe(false);
  });

  it('groupSize 1 runs a single pass with the vote disabled', async () => {
    const backend = votingBackend({ 0: [ISSUE_A] });
    const review = await groupVoteReview(
      backend,
      ['a.ts'],
      [change],
      { config: { model: 'm' }, observer },
      { groupSize: 1 },
    );
    expect(review.issues).toHaveLength(1);
    expect(review.issues[0]?.votes).toBe(1);
    expect(review.issues[0]?.groupSize).toBe(1);
  });

  it('surfaces a low-vote security finding as potential rather than dropping it', async () => {
    const SEC = {
      file: 'a.ts',
      startLine: 2,
      endLine: 2,
      verbatimSnippet: 'return arr[i + 1];',
      description: 'authorization check removed on this code path allowing bypass',
      severity: 'high',
      category: 'security',
      confidence: 0.5,
    };
    // Security finding appears in only 1 of 5 runs — below potentialThreshold.
    const backend = votingBackend({ 0: [SEC], 1: [], 2: [], 3: [], 4: [] });
    const review = await groupVoteReview(
      backend,
      ['a.ts'],
      [change],
      { config: { model: 'm' }, observer },
      { groupSize: 5 },
    );
    expect(review.issues).toHaveLength(0);
    expect(review.potentialIssues).toHaveLength(1);
    expect(review.potentialIssues[0]?.category).toBe('security');
    expect(review.potentialIssues[0]?.votes).toBe(1);
  });
});

describe('mapWithConcurrency', () => {
  it('runs all items and preserves order under a bounded pool', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });
});
