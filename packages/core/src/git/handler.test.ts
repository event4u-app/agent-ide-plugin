import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from '../llm/backend.js';
import type { GitRunner } from '../commands/commit.js';
import { TrackingDb } from '../tracking/db.js';
import { CapsEvaluator } from '../tracking/caps.js';
import { PricingBook } from '../pricing/loader.js';
import { GitHandler, GitRequestError } from './handler.js';
import { resolveReviewSettings } from '../review/config.js';

/**
 * A backend that returns one scripted reply per `stream()` call, clamping to
 * the last reply once the queue is exhausted (so the 5-run review just repeats
 * its empty reply). No tool calls → the review pipeline yields zero findings.
 */
function scriptedBackend(...replies: string[]): LlmBackend {
  let i = 0;
  return {
    id: 'fake',
    mode: 'api',
    async *stream(_req: LlmRequest): AsyncIterable<LlmStreamEvent> {
      const text = replies[Math.min(i, replies.length - 1)] ?? '';
      i += 1;
      yield { kind: 'text_delta', text };
      yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
`;

// readCommitLog format is `%H\x1f%s\x1f%b\x1e`; newest commit first.
const LOG = `H1\x1ffeat: add foo\x1fwhy it matters\x1e\nH2\x1ffix: a bug\x1f\x1e\n`;

/** A runner that answers `git diff` with DIFF and `git log` with LOG. */
function fakeRunner(diff = DIFF, log = LOG): GitRunner {
  return {
    run: (args: string[]) => {
      if (args[0] === 'log') return Promise.resolve({ stdout: log, stderr: '', exitCode: 0 });
      return Promise.resolve({ stdout: diff, stderr: '', exitCode: 0 });
    },
  };
}

function makeHandler(backend: LlmBackend, runner: GitRunner = fakeRunner()): GitHandler {
  return new GitHandler({
    resolveBackend: () => backend,
    resolveModel: () => 'claude-sonnet-4-6',
    defaultCwd: '/repo',
    runner,
  });
}

describe('GitHandler.commitMessage', () => {
  it('parses a valid Conventional-Commit reply on the first attempt', async () => {
    const handler = makeHandler(scriptedBackend('feat(git): wire git-loop transport methods'));
    const res = await handler.commitMessage({ cwd: '/repo' });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(res.message).toMatchObject({ type: 'feat', scope: 'git', breaking: false });
    expect(res.text).toBe('feat(git): wire git-loop transport methods');
    expect(res.errors).toEqual([]);
  });

  it('re-prompts once on a malformed reply, then succeeds (bounded D1)', async () => {
    const handler = makeHandler(
      scriptedBackend('not a commit at all', 'fix(core): correct the thing'),
    );
    const res = await handler.commitMessage({ cwd: '/repo' });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.message?.type).toBe('fix');
  });

  it('returns a structured failure after exhausting the attempt budget', async () => {
    const handler = makeHandler(scriptedBackend('still not valid'));
    const res = await handler.commitMessage({ cwd: '/repo' });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(2);
    expect(res.message).toBeNull();
    expect(res.text).toBe('');
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('re-emits `!` for a breaking change driven by the header bang', async () => {
    const handler = makeHandler(scriptedBackend('feat(api)!: drop the legacy field'));
    const res = await handler.commitMessage({ cwd: '/repo' });
    expect(res.ok).toBe(true);
    expect(res.message?.breaking).toBe(true);
    expect(res.text).toBe('feat(api)!: drop the legacy field');
  });

  it('reports no-changes without calling the model', async () => {
    const handler = makeHandler(scriptedBackend('feat: unused'), fakeRunner('', LOG));
    const res = await handler.commitMessage({ cwd: '/repo' });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(0);
    expect(res.errors).toEqual(['no changes in the selected diff source']);
  });

  it('rejects a range source with no base ref', async () => {
    const handler = makeHandler(scriptedBackend('feat: x'));
    await expect(handler.commitMessage({ cwd: '/repo', source: 'range' })).rejects.toBeInstanceOf(
      GitRequestError,
    );
  });
});

describe('GitHandler.prDescription', () => {
  it('sanitises the body (attribution + emoji) and surfaces warnings', async () => {
    const reply = [
      '## Summary',
      'Adds foo. 🚀',
      '',
      'Generated with Claude Code',
      '',
      '## Changes',
      '- thing',
    ].join('\n');
    const handler = makeHandler(scriptedBackend(reply));
    const res = await handler.prDescription({ cwd: '/repo', base: 'main' });
    expect(res.body).not.toContain('🚀');
    expect(res.body).not.toContain('Generated with');
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.commitCount).toBe(2);
    expect(res.truncated).toBe(false);
  });

  it('derives an editable title candidate from the newest commit subject', async () => {
    const handler = makeHandler(scriptedBackend('## Summary\nbody'));
    const res = await handler.prDescription({ cwd: '/repo', base: 'main' });
    expect(res.title).toBe('feat: add foo');
  });
});

describe('GitHandler.reviewSummary', () => {
  it('runs the review engine and folds it into a wire summary', async () => {
    // A reply with no tool call → the review pipeline yields zero findings.
    const handler = makeHandler(scriptedBackend(''));
    const res = await handler.reviewSummary({ cwd: '/repo', source: 'unstaged' });
    expect(res.filesChanged).toBe(1);
    expect(res.additions).toBe(2);
    expect(res.deletions).toBe(1);
    expect(res.totalFindings).toBe(0);
    expect(res.topFindings).toEqual([]);
    // Exhaustive per-severity buckets even at zero.
    expect(res.findingsBySeverity.map((s) => s.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
      'info',
    ]);
    expect(res.findingsBySeverity.every((s) => s.count === 0)).toBe(true);
  });
});

describe('GitHandler.reviewSummary — Phase-5 config + rules wiring (T-CR-501/502)', () => {
  /** Records the system prompt of every stage call; returns no findings. */
  function capturingBackend(systems: string[]): LlmBackend {
    return {
      id: 'fake',
      mode: 'api',
      async *stream(req: LlmRequest): AsyncIterable<LlmStreamEvent> {
        systems.push(req.system ?? '');
        yield { kind: 'text_delta', text: '' };
        yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
  }

  /** Stage-aware backend that emits the given findings (single-pass review). */
  function findingsBackend(issues: unknown[]): LlmBackend {
    return {
      id: 'fake',
      mode: 'api',
      async *stream(req: LlmRequest): AsyncIterable<LlmStreamEvent> {
        const sys = req.system ?? '';
        let tool: { name: string; input: unknown };
        if (sys.includes('skeptical second reviewer')) {
          const content =
            typeof req.messages[0]?.content === 'string' ? req.messages[0].content : '';
          const ids = [...content.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
          tool = {
            name: 'submit_decisions',
            input: { decisions: ids.map((id) => ({ issueId: id, keep: true })) },
          };
        } else if (sys.includes('stress-testing')) {
          tool = { name: 'submit_findings', input: { changeSummary: '', issues: [] } };
        } else {
          tool = { name: 'submit_findings', input: { changeSummary: 'sums up', issues } };
        }
        yield { kind: 'tool_use_start', id: 'x', name: tool.name };
        yield { kind: 'tool_use_end', id: 'x', name: tool.name, input: tool.input };
        yield { kind: 'stop', reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } };
      },
    };
  }

  // Findings quote lines present in the test DIFF's hunks, so span validation
  // resolves them via the hunk fallback (no observer.readFile needed).
  const LOW_BUG = {
    file: 'src/foo.ts',
    startLine: 3,
    endLine: 3,
    verbatimSnippet: 'const c = 4;',
    description: 'unused const',
    severity: 'low',
    category: 'bug',
    confidence: 0.9,
  };
  const LOW_SECURITY = {
    file: 'src/foo.ts',
    startLine: 2,
    endLine: 2,
    verbatimSnippet: 'const b = 3;',
    description: 'weak value',
    severity: 'low',
    category: 'security',
    confidence: 0.9,
  };

  it('threads the workspace review rules into the Stage-1 prompt (T-CR-501)', async () => {
    const systems: string[] = [];
    const handler = new GitHandler({
      resolveBackend: () => capturingBackend(systems),
      resolveModel: () => 'claude-sonnet-4-6',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      loadReviewRules: async () => 'PROJECT-RULE-ZZZ: forbid magic numbers',
      loadReviewSettings: async () => resolveReviewSettings(),
    });
    await handler.reviewSummary({ cwd: '/repo', source: 'unstaged' });
    // Stage 1 ('senior code reviewer') carries the project rules; the rules are
    // only ever injected into that stage's system prompt.
    const stage1 = systems.find((s) => s.includes('senior code reviewer'));
    expect(stage1).toContain('PROJECT-RULE-ZZZ');
  });

  it('does not inject a rules block when no review-rules.md is present', async () => {
    const systems: string[] = [];
    const handler = new GitHandler({
      resolveBackend: () => capturingBackend(systems),
      resolveModel: () => 'claude-sonnet-4-6',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      loadReviewRules: async () => undefined,
      loadReviewSettings: async () => resolveReviewSettings(),
    });
    await handler.reviewSummary({ cwd: '/repo', source: 'unstaged' });
    expect(systems.every((s) => !s.includes('Project-specific review rules'))).toBe(true);
  });

  it('passes the settings group_size through as the vote group size (T-CR-502)', async () => {
    // groupSize 5 runs the review 5× per group; groupSize 1 disables the vote
    // (one pass). Equal scripted replies → call count scales exactly 5×.
    const calls = { one: 0, five: 0 };
    const countingBackend = (counter: { n: number }): LlmBackend => ({
      id: 'fake',
      mode: 'api',
      async *stream(_req: LlmRequest): AsyncIterable<LlmStreamEvent> {
        counter.n += 1;
        yield { kind: 'text_delta', text: '' };
        yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      },
    });
    const c1 = { n: 0 };
    const c5 = { n: 0 };
    await new GitHandler({
      resolveBackend: () => countingBackend(c1),
      resolveModel: () => 'm',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      loadReviewSettings: async () => resolveReviewSettings({ group_size: 1 }),
    }).reviewSummary({ cwd: '/repo', source: 'unstaged' });
    await new GitHandler({
      resolveBackend: () => countingBackend(c5),
      resolveModel: () => 'm',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      loadReviewSettings: async () => resolveReviewSettings({ group_size: 5 }),
    }).reviewSummary({ cwd: '/repo', source: 'unstaged' });
    calls.one = c1.n;
    calls.five = c5.n;
    expect(calls.one).toBeGreaterThan(0);
    expect(calls.five).toBe(calls.one * 5);
  });

  it('applies the severity floor before summarising, but never hides security (T-CR-502)', async () => {
    // No floor (info): both the low bug and low security finding survive.
    const open = await new GitHandler({
      resolveBackend: () => findingsBackend([LOW_BUG, LOW_SECURITY]),
      resolveModel: () => 'm',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      loadReviewSettings: async () =>
        resolveReviewSettings({ group_size: 1, severity_floor: 'info' }),
    }).reviewSummary({ cwd: '/repo', source: 'unstaged' });
    expect(open.totalFindings).toBe(2);

    // Floor 'high' drops the low *bug*, but the low *security* finding is exempt
    // (security_always_error defaults on) — the council-flagged trap.
    const floored = await new GitHandler({
      resolveBackend: () => findingsBackend([LOW_BUG, LOW_SECURITY]),
      resolveModel: () => 'm',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      loadReviewSettings: async () =>
        resolveReviewSettings({ group_size: 1, severity_floor: 'high' }),
    }).reviewSummary({ cwd: '/repo', source: 'unstaged' });
    expect(floored.totalFindings).toBe(1);
    expect(floored.topFindings).toHaveLength(1);
    expect(floored.topFindings[0]?.category).toBe('security');
    expect(floored.topFindings[0]?.severity).toBe('low');
  });
});

describe('GitHandler.reviewSummary — tracked observer wiring (T-CR-206)', () => {
  const PRICING_YAML = `
version: 3
last_updated: '2026-05-29'
currency: USD
models:
  - id: claude-sonnet-4-6
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
subscriptions: []
`;
  const pricing = PricingBook.parse(PRICING_YAML);

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-git-review-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function trackedHandler(extra: { caps?: CapsEvaluator } = {}): {
    handler: GitHandler;
    tracking: TrackingDb;
  } {
    const tracking = new TrackingDb({ baseDir: dir });
    const handler = new GitHandler({
      resolveBackend: () => scriptedBackend(''),
      resolveModel: () => 'claude-sonnet-4-6',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      tracking,
      pricing,
      ...(extra.caps ? { caps: extra.caps } : {}),
    });
    return { handler, tracking };
  }

  it('records a priced activity:"review" step event under a stable review:<cwd> id', async () => {
    const { handler, tracking } = trackedHandler();
    const res = await handler.reviewSummary({ cwd: '/repo', source: 'unstaged' });
    expect(res.filesChanged).toBe(1);

    const steps = await tracking.readSteps();
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.activity === 'review')).toBe(true);
    expect(steps.every((s) => s.conversation_id === 'review:/repo')).toBe(true);
    expect(steps.every((s) => s.mode === 'api')).toBe(true);
    // Priced from the pricing book → a non-negative cost is recorded.
    expect(steps.every((s) => typeof s.usd === 'number')).toBe(true);
    expect(steps.every((s) => s.pricing_book_version === 3)).toBe(true);
  });

  it('blocks a cap-blowing review and surfaces a coded cost_cap_blocked error', async () => {
    // hard_block at $0 → any positive projection trips the gate pre-stage.
    const caps = new CapsEvaluator(
      { single_step: { hard_block_above_usd: 0 }, daily: {} },
      pricing,
    );
    const { handler, tracking } = trackedHandler({ caps });
    await expect(handler.reviewSummary({ cwd: '/repo', source: 'unstaged' })).rejects.toMatchObject(
      { name: 'GitRequestError', code: 'cost_cap_blocked' },
    );
    // Blocked PRE-stage → no spend recorded.
    expect(await tracking.readSteps()).toEqual([]);
  });

  it('runs untracked (no throw, no step events) when no pricing book is present', async () => {
    const tracking = new TrackingDb({ baseDir: dir });
    const handler = new GitHandler({
      resolveBackend: () => scriptedBackend(''),
      resolveModel: () => 'claude-sonnet-4-6',
      defaultCwd: '/repo',
      runner: fakeRunner(),
      tracking, // pricing absent → observer not built (recording no-ops gate)
    });
    const res = await handler.reviewSummary({ cwd: '/repo', source: 'unstaged' });
    expect(res.filesChanged).toBe(1);
    expect(await tracking.readSteps()).toEqual([]);
  });
});

describe('GitHandler.reviewApplyFix (T-CR-404)', () => {
  const FILE = 'src/foo.ts';
  const ORIGINAL = 'const a = 1;\nconst b = 2;\nexport { a };\n';

  it('builds an approval diff when the span matches the current file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-fix-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, FILE), ORIGINAL, 'utf8');

    const handler = makeHandler(scriptedBackend(''));
    const res = await handler.reviewApplyFix({
      cwd: dir,
      file: FILE,
      quotedSpan: 'const b = 2;',
      proposedFix: 'const b = 99;',
    });

    expect(res.applicable).toBe(true);
    expect(res.review?.kind).toBe('diff');
    expect(res.review?.files).toHaveLength(1);
    expect(res.review?.files[0]?.path).toBe(FILE);
    expect(res.review?.files[0]?.isNewFile).toBe(false);
    expect(res.review?.files[0]?.diff).toContain('const b = 99;');
    expect(res.review?.files[0]?.diff).toContain('-const b = 2;');
  });

  it('reports span_drift when the quoted span no longer matches the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-fix-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, FILE), ORIGINAL, 'utf8');

    const handler = makeHandler(scriptedBackend(''));
    const res = await handler.reviewApplyFix({
      cwd: dir,
      file: FILE,
      quotedSpan: 'const b = 7;', // edited away since the review
      proposedFix: 'const b = 99;',
    });

    expect(res.applicable).toBe(false);
    expect(res.reason).toBe('span_drift');
    expect(res.review).toBeUndefined();
  });

  it('reports no_op when the proposed fix equals the current span', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-fix-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, FILE), ORIGINAL, 'utf8');

    const handler = makeHandler(scriptedBackend(''));
    const res = await handler.reviewApplyFix({
      cwd: dir,
      file: FILE,
      quotedSpan: 'const b = 2;',
      proposedFix: 'const b = 2;',
    });

    expect(res.applicable).toBe(false);
    expect(res.reason).toBe('no_op');
  });

  it('reports file_not_found when the target file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-fix-'));
    const handler = makeHandler(scriptedBackend(''));
    const res = await handler.reviewApplyFix({
      cwd: dir,
      file: 'src/missing.ts',
      quotedSpan: 'const b = 2;',
      proposedFix: 'const b = 99;',
    });

    expect(res.applicable).toBe(false);
    expect(res.reason).toBe('file_not_found');
  });

  it('refuses a path that escapes the workspace root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-fix-'));
    const handler = makeHandler(scriptedBackend(''));
    const res = await handler.reviewApplyFix({
      cwd: dir,
      file: '../escape.ts',
      quotedSpan: 'secret',
      proposedFix: 'leak',
    });

    expect(res.applicable).toBe(false);
    expect(res.reason).toBe('path_escapes_workspace');
  });
});
