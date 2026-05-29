import { describe, expect, it, vi } from 'vitest';
import type { LlmBackend } from '../llm/backend.js';
import type { LlmStreamEvent, LlmRequest } from '@event4u-agent/protocol';
import { reviewGroup, sortAndDedup, CapsBlockedError, type ReviewObserver } from './pipeline.js';
import type { FileChange, ReviewIssue } from './types.js';

/** A scripted backend: each stream() call emits the next queued tool call. */
function scriptedBackend(responses: Array<{ tool: { name: string; input: unknown } }>): {
  backend: LlmBackend;
  calls: LlmRequest[];
} {
  const calls: LlmRequest[] = [];
  let i = 0;
  const backend: LlmBackend = {
    id: 'fake',
    mode: 'api',
    async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      calls.push(request);
      const res = responses[i++];
      if (res) {
        yield { kind: 'tool_use_start', id: `t${i}`, name: res.tool.name };
        yield { kind: 'tool_use_end', id: `t${i}`, name: res.tool.name, input: res.tool.input };
      }
      yield { kind: 'stop', reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 50 } };
    },
  };
  return { backend, calls };
}

const FILE = `function pick(arr, i) {
  return arr[i + 1];
}
function greet(user) {
  return 'hi ' + user.name;
}
`;

function fileChange(file: string): FileChange {
  return {
    file,
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
}

const observer: ReviewObserver = {
  readFile: async () => FILE,
  now: () => 0,
};

describe('reviewGroup — single-pass chain', () => {
  it('surfaces a known off-by-one + missing-null-check with correct line anchors', async () => {
    const { backend } = scriptedBackend([
      {
        tool: {
          name: 'submit_findings',
          input: {
            changeSummary: 'two new functions',
            issues: [
              {
                file: 'a.ts',
                startLine: 2,
                endLine: 2,
                verbatimSnippet: 'return arr[i + 1];',
                description: 'Off-by-one: indexing i+1 overruns the array',
                severity: 'high',
                category: 'bug',
                confidence: 0.9,
              },
              {
                file: 'a.ts',
                startLine: 5,
                endLine: 5,
                verbatimSnippet: "return 'hi ' + user.name;",
                description: 'Missing null check: user may be undefined',
                severity: 'medium',
                category: 'bug',
                confidence: 0.8,
              },
            ],
          },
        },
      },
      { tool: { name: 'submit_findings', input: { changeSummary: '', issues: [] } } },
      {
        tool: {
          name: 'submit_decisions',
          input: {
            decisions: [
              { issueId: 'a.ts:analyze:0', keep: true },
              { issueId: 'a.ts:analyze:1', keep: true },
            ],
          },
        },
      },
    ]);

    const review = await reviewGroup(backend, ['a.ts'], [fileChange('a.ts')], {
      config: { model: 'claude-sonnet-4-6' },
      observer,
    });

    expect(review.issues).toHaveLength(2);
    const lines = review.issues.map((i: ReviewIssue) => i.line).sort();
    expect(lines).toEqual([2, 5]);
    expect(review.issues[0]?.severity).toBe('high'); // sorted severity-desc
  });

  it('produces zero issues on a clean refactor (no false positives)', async () => {
    const { backend, calls } = scriptedBackend([
      { tool: { name: 'submit_findings', input: { changeSummary: 'pure rename', issues: [] } } },
      { tool: { name: 'submit_findings', input: { changeSummary: '', issues: [] } } },
    ]);
    const review = await reviewGroup(backend, ['a.ts'], [fileChange('a.ts')], {
      config: { model: 'm' },
      observer,
    });
    expect(review.issues).toHaveLength(0);
    expect(review.potentialIssues).toHaveLength(0);
    // No candidates → the critical pass (3rd call) is skipped.
    expect(calls).toHaveLength(2);
  });

  it('keeps a security finding even when the critical pass votes to drop it', async () => {
    const { backend } = scriptedBackend([
      {
        tool: {
          name: 'submit_findings',
          input: {
            changeSummary: 'removed an authz check',
            issues: [
              {
                file: 'a.ts',
                startLine: 2,
                endLine: 2,
                verbatimSnippet: 'return arr[i + 1];',
                description: 'Authorization check removed on this path',
                severity: 'high',
                category: 'security',
                confidence: 0.4,
              },
            ],
          },
        },
      },
      { tool: { name: 'submit_findings', input: { changeSummary: '', issues: [] } } },
      {
        tool: {
          name: 'submit_decisions',
          input: { decisions: [{ issueId: 'a.ts:analyze:0', keep: false }] },
        },
      },
    ]);
    const review = await reviewGroup(backend, ['a.ts'], [fileChange('a.ts')], {
      config: { model: 'm' },
      observer,
    });
    // Dropped by the model, kept by the security exemption — and high-conf despite 0.4.
    expect(review.issues).toHaveLength(1);
    expect(review.issues[0]?.category).toBe('security');
  });

  it('drops a finding whose quoted span cannot be located', async () => {
    const { backend } = scriptedBackend([
      {
        tool: {
          name: 'submit_findings',
          input: {
            changeSummary: 'x',
            issues: [
              {
                file: 'a.ts',
                startLine: 9,
                endLine: 9,
                verbatimSnippet: 'this code does not exist anywhere',
                description: 'hallucinated finding',
                severity: 'high',
                category: 'bug',
              },
            ],
          },
        },
      },
      { tool: { name: 'submit_findings', input: { changeSummary: '', issues: [] } } },
    ]);
    const review = await reviewGroup(backend, ['a.ts'], [fileChange('a.ts')], {
      config: { model: 'm' },
      observer,
    });
    expect(review.issues).toHaveLength(0);
  });
});

describe('cost + caps integration (T-CR-206)', () => {
  it('reports usage for every LLM stage via onStage', async () => {
    const onStage = vi.fn();
    const { backend } = scriptedBackend([
      {
        tool: {
          name: 'submit_findings',
          input: {
            changeSummary: 's',
            issues: [
              {
                file: 'a.ts',
                startLine: 2,
                endLine: 2,
                verbatimSnippet: 'return arr[i + 1];',
                description: 'off by one',
                severity: 'high',
                category: 'bug',
              },
            ],
          },
        },
      },
      { tool: { name: 'submit_findings', input: { changeSummary: '', issues: [] } } },
      {
        tool: {
          name: 'submit_decisions',
          input: { decisions: [{ issueId: 'a.ts:analyze:0', keep: true }] },
        },
      },
    ]);
    await reviewGroup(backend, ['a.ts'], [fileChange('a.ts')], {
      config: { model: 'm' },
      observer: { ...observer, onStage },
    });
    expect(onStage.mock.calls.map((c) => c[0].stage)).toEqual([
      'analyze',
      'edge-cases',
      'critical',
    ]);
  });

  it('throws CapsBlockedError when the cap check blocks a stage', async () => {
    const { backend } = scriptedBackend([
      { tool: { name: 'submit_findings', input: { changeSummary: '', issues: [] } } },
    ]);
    await expect(
      reviewGroup(backend, ['a.ts'], [fileChange('a.ts')], {
        config: { model: 'm' },
        observer: { ...observer, checkCaps: () => 'block' },
      }),
    ).rejects.toBeInstanceOf(CapsBlockedError);
  });
});

describe('sortAndDedup (Stage 4)', () => {
  it('dedups same file+line+description and sorts by severity desc', () => {
    const mk = (over: Partial<ReviewIssue>): ReviewIssue => ({
      id: Math.random().toString(),
      file: 'a.ts',
      line: 1,
      description: 'dup',
      severity: 'low',
      category: 'bug',
      ...over,
    });
    const out = sortAndDedup([
      mk({ description: 'dup', severity: 'low' }),
      mk({ description: 'dup', severity: 'low' }), // exact dup → removed
      mk({ description: 'critical thing', severity: 'critical', line: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.severity).toBe('critical'); // sorted first
  });
});
