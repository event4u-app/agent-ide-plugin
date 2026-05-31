import { describe, expect, it } from 'vitest';
import type { GitRunner } from '../commands/commit.js';
import type { FileChange } from '../review/types.js';
import {
  buildPrDescriptionPrompt,
  readCommitLog,
  sanitizePrBody,
  sanitizePrTitle,
  type CommitLog,
} from './pr-description.js';

const RS = '\x1e';
const FS = '\x1f';

/** Build a fake `git log` stdout in the module's `%H\x1f%s\x1f%b\x1e` format. */
function fakeLog(commits: Array<{ hash: string; subject: string; body?: string }>): string {
  return commits.map((c) => `${c.hash}${FS}${c.subject}${FS}${c.body ?? ''}${RS}\n`).join('');
}

function runnerReturning(stdout: string, exitCode = 0): GitRunner {
  return { run: async () => ({ stdout, stderr: exitCode === 0 ? '' : 'boom', exitCode }) };
}

const FILE: FileChange = {
  file: 'packages/core/src/git/pr-description.ts',
  status: 'added',
  binary: false,
  hunks: [
    {
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 2,
      section: '',
      changes: [
        { kind: 'add', oldLine: null, newLine: 1, text: 'export const a = 1;' },
        { kind: 'add', oldLine: null, newLine: 2, text: 'export const b = 2;' },
      ],
    },
  ],
};

describe('readCommitLog', () => {
  it('parses hash / subject / body records', async () => {
    const runner = runnerReturning(
      fakeLog([
        { hash: 'a'.repeat(40), subject: 'feat: one', body: 'body one' },
        { hash: 'b'.repeat(40), subject: 'fix: two' },
      ]),
    );
    const log = await readCommitLog('/repo', 'main', 'HEAD', runner);
    expect(log.total).toBe(2);
    expect(log.truncated).toBe(false);
    expect(log.entries[0]).toEqual({
      hash: 'a'.repeat(40),
      subject: 'feat: one',
      body: 'body one',
    });
    expect(log.entries[1]?.body).toBe('');
  });

  it('caps at maxCommits and flags truncation', async () => {
    const runner = runnerReturning(
      fakeLog([
        { hash: '1'.repeat(40), subject: 'a' },
        { hash: '2'.repeat(40), subject: 'b' },
        { hash: '3'.repeat(40), subject: 'c' },
      ]),
    );
    const log = await readCommitLog('/repo', 'main', 'HEAD', runner, { maxCommits: 2 });
    expect(log.total).toBe(3);
    expect(log.entries).toHaveLength(2);
    expect(log.truncated).toBe(true);
  });

  it('caps a long body', async () => {
    const runner = runnerReturning(
      fakeLog([{ hash: 'c'.repeat(40), subject: 's', body: 'x'.repeat(20) }]),
    );
    const log = await readCommitLog('/repo', 'main', 'HEAD', runner, { maxBodyChars: 5 });
    expect(log.entries[0]?.body).toBe('xxxxx…');
  });

  it('throws on a non-zero git exit', async () => {
    await expect(readCommitLog('/repo', 'main', 'HEAD', runnerReturning('', 128))).rejects.toThrow(
      /git log failed/,
    );
  });
});

describe('buildPrDescriptionPrompt', () => {
  const log: CommitLog = {
    entries: [
      { hash: 'a'.repeat(40), subject: 'feat: one', body: '' },
      { hash: 'b'.repeat(40), subject: 'fix: two', body: '' },
    ],
    total: 2,
    truncated: false,
  };

  it('lists commits, changed files, and a diffstat', () => {
    const [system, user] = buildPrDescriptionPrompt([FILE], log, {
      branch: 'feat/x',
      base: 'main',
    });
    expect(system?.content).toMatch(/## Summary/);
    expect(user?.content).toContain('feat: one');
    expect(user?.content).toContain('packages/core/src/git/pr-description.ts (+2 / -0, added)');
    expect(user?.content).toContain('main');
  });

  it('marks truncated commit history', () => {
    const truncated: CommitLog = { ...log, total: 9, truncated: true };
    const [, user] = buildPrDescriptionPrompt([FILE], truncated);
    expect(user?.content).toMatch(/2 of 9, older omitted/);
  });
});

describe('sanitizePrBody', () => {
  it('strips attribution footers and decorative emoji, surfaces warnings', () => {
    const raw = [
      '## Summary 🚀',
      '',
      'Adds the git loop.',
      '',
      '🤖 Generated with Claude Code',
      'Co-authored-by: Claude <noreply@anthropic.com>',
    ].join('\n');
    const { body, warnings } = sanitizePrBody(raw);
    expect(body).not.toMatch(/🚀|🤖/);
    expect(body).not.toMatch(/co-authored-by/i);
    expect(body).toContain('## Summary');
    expect(body.endsWith('\n')).toBe(true);
    expect(warnings).toContain('removed decorative emoji');
    expect(warnings.some((w) => /attribution/.test(w))).toBe(true);
  });

  it('keeps functional status markers and reports no warnings on clean input', () => {
    const { body, warnings } = sanitizePrBody('## Summary\n\nAll checks ✅ pass.');
    expect(body).toContain('✅');
    expect(warnings).toEqual([]);
  });
});

describe('sanitizePrTitle', () => {
  it('removes all emoji and collapses whitespace', () => {
    const { title, warnings } = sanitizePrTitle('🚀  feat: ship   the   thing ✅');
    expect(title).toBe('feat: ship the thing');
    expect(warnings).toContain('removed emoji from title');
  });

  it('takes only the first line', () => {
    expect(sanitizePrTitle('feat: a\nsecond line').title).toBe('feat: a');
  });
});
