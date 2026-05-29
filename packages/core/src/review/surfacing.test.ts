import { describe, expect, it, vi } from 'vitest';
import type { LlmBackend } from '../llm/backend.js';
import type { LlmStreamEvent, LlmRequest } from '@event4u-agent/protocol';
import type { GitRunner } from '../commands/commit.js';
import { runReview, type RunReviewProgress } from './run.js';
import { toDiagnostics } from './diagnostics.js';
import { buildFixEdit } from './apply-fix.js';
import type { ReviewIssue } from './types.js';

const FILE = `function pick(arr, i) {
  return arr[i + 1];
}
`;

const DIFF = `diff --git a/a.ts b/a.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,3 @@
+function pick(arr, i) {
+  return arr[i + 1];
+}
`;

const gitRunner: GitRunner = {
  run: () => Promise.resolve({ stdout: DIFF, stderr: '', exitCode: 0 }),
};

/** Stage-aware backend (groupSize 1 → sequential stage calls per group). */
function backendFor(issues: unknown[]): LlmBackend {
  return {
    id: 'fake',
    mode: 'api',
    async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      const sys = request.system ?? '';
      let tool: { name: string; input: unknown };
      if (sys.includes('skeptical second reviewer')) {
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
        tool = { name: 'submit_findings', input: { changeSummary: 'adds pick', issues } };
      }
      yield { kind: 'tool_use_start', id: 'x', name: tool.name };
      yield { kind: 'tool_use_end', id: 'x', name: tool.name, input: tool.input };
      yield { kind: 'stop', reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
}

describe('runReview', () => {
  it('diffs, groups, reviews, and flattens findings with progress', async () => {
    const backend = backendFor([
      {
        file: 'a.ts',
        startLine: 2,
        endLine: 2,
        verbatimSnippet: 'return arr[i + 1];',
        description: 'off-by-one indexing past the array end',
        severity: 'high',
        category: 'bug',
        confidence: 0.9,
      },
    ]);
    const progress: RunReviewProgress[] = [];
    const result = await runReview(backend, {
      cwd: '/repo',
      source: { mode: 'unstaged' },
      runner: gitRunner,
      pipeline: { config: { model: 'm' }, observer: { readFile: async () => FILE, now: () => 0 } },
      vote: { groupSize: 1 },
      onProgress: (p) => progress.push(p),
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.line).toBe(2);
    expect(result.files).toContain('a.ts');
    expect(progress[0]?.phase).toBe('diffing');
    expect(progress.at(-1)?.phase).toBe('done');
  });

  it('stops before reviewing when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const onProgress = vi.fn();
    const result = await runReview(backendFor([]), {
      cwd: '/repo',
      runner: gitRunner,
      pipeline: {
        config: { model: 'm' },
        signal: ac.signal,
        observer: { readFile: async () => FILE },
      },
      vote: { groupSize: 1 },
      onProgress,
    });
    expect(result.reviews).toHaveLength(0);
  });
});

describe('toDiagnostics', () => {
  const mk = (over: Partial<ReviewIssue>): ReviewIssue => ({
    id: 'x',
    file: 'a.ts',
    line: 2,
    endLine: 2,
    description: 'desc',
    severity: 'high',
    category: 'bug',
    ...over,
  });

  it('maps security→error, issue→warning, potential→information and shows votes', () => {
    const result = {
      reviews: [],
      files: ['a.ts'],
      issues: [
        mk({ category: 'security', votes: 1, groupSize: 5 }),
        mk({ category: 'bug', votes: 4, groupSize: 5 }),
      ],
      potentialIssues: [mk({ category: 'bug', line: 9, votes: 3, groupSize: 5 })],
    };
    const diags = toDiagnostics(result);
    expect(diags.find((d) => d.category === 'security')?.severity).toBe('error');
    expect(diags.find((d) => d.category === 'bug' && d.line === 2)?.severity).toBe('warning');
    expect(diags.find((d) => d.line === 9)?.severity).toBe('information');
    expect(diags[0]?.message.startsWith('[1/5] ')).toBe(true);
  });
});

describe('buildFixEdit', () => {
  const base: ReviewIssue = {
    id: 'x',
    file: 'a.ts',
    line: 2,
    description: 'off by one',
    severity: 'high',
    category: 'bug',
    quotedSpan: 'return arr[i + 1];',
    proposedFix: 'return arr[i];',
  };

  it('replaces the quoted span with the proposed fix', () => {
    const edit = buildFixEdit(base, FILE);
    expect(edit?.path).toBe('a.ts');
    expect(edit?.content).toContain('return arr[i];');
    expect(edit?.content).not.toContain('return arr[i + 1];');
  });

  it('returns null when there is no proposed fix or the span drifted', () => {
    expect(buildFixEdit({ ...base, proposedFix: undefined }, FILE)).toBeNull();
    expect(buildFixEdit({ ...base, quotedSpan: 'nonexistent code' }, FILE)).toBeNull();
  });
});
