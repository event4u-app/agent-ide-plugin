import { describe, expect, it } from 'vitest';
import type { FileChange, HunkChange } from '../review/types.js';
import {
  buildCommitMessagePrompt,
  MAX_HEADER_LENGTH,
  parseCommitMessage,
} from './commit-message.js';

function fileChange(file: string, lines: Array<[HunkChange['kind'], string]>): FileChange {
  const changes: HunkChange[] = lines.map(([kind, text], i) => ({
    kind,
    oldLine: kind === 'add' ? null : i + 1,
    newLine: kind === 'del' ? null : i + 1,
    text,
  }));
  return {
    file,
    status: 'modified',
    binary: false,
    hunks: [
      {
        oldStart: 1,
        oldCount: lines.length,
        newStart: 1,
        newCount: lines.length,
        section: '',
        changes,
      },
    ],
  };
}

const SAMPLE: FileChange[] = [
  fileChange('packages/core/src/git/commit-message.ts', [
    ['context', 'export function build() {'],
    ['add', '  return 1;'],
    ['del', '  return 0;'],
  ]),
];

describe('buildCommitMessagePrompt', () => {
  it('emits a system + user turn with the branch, files, and rendered diff', () => {
    const [system, user] = buildCommitMessagePrompt(SAMPLE, { branch: 'feat/git-loop' });
    expect(system?.role).toBe('system');
    expect(system?.content).toMatch(/Conventional-Commit/);
    expect(user?.role).toBe('user');
    expect(user?.content).toContain('feat/git-loop');
    expect(user?.content).toContain('packages/core/src/git/commit-message.ts');
    expect(user?.content).toContain('return 1;');
  });

  it('notes truncation when more files than maxFiles', () => {
    const many = [SAMPLE[0] as FileChange, fileChange('b.ts', [['add', 'x']])];
    const [, user] = buildCommitMessagePrompt(many, { maxFiles: 1 });
    expect(user?.content).toMatch(/1 more file\(s\) omitted/);
  });
});

describe('parseCommitMessage', () => {
  it('parses a valid header with scope', () => {
    const r = parseCommitMessage('feat(git): add commit-message builder');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.type).toBe('feat');
      expect(r.message.scope).toBe('git');
      expect(r.message.breaking).toBe(false);
      expect(r.message.subject).toBe('add commit-message builder');
      expect(r.message.body).toBeUndefined();
    }
  });

  it('parses a body and a BREAKING CHANGE footer as breaking', () => {
    const raw =
      'fix(api): drop legacy field\n\nWhy: nobody uses it.\n\nBREAKING CHANGE: removes the v1 field';
    const r = parseCommitMessage(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.breaking).toBe(true);
      expect(r.message.body).toContain('Why: nobody uses it.');
    }
  });

  it('treats a `!` marker as breaking', () => {
    const r = parseCommitMessage('feat(api)!: drop v1');
    expect(r.ok && r.message.breaking).toBe(true);
  });

  it('accepts a header without a scope', () => {
    const r = parseCommitMessage('docs: update readme');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message.scope).toBeUndefined();
  });

  it('strips a surrounding code fence', () => {
    const r = parseCommitMessage('```\nchore: tidy up\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message.type).toBe('chore');
  });

  it('rejects an unknown type', () => {
    const r = parseCommitMessage('wip: half a thing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/type "wip"/);
  });

  it('rejects a non-conventional header', () => {
    const r = parseCommitMessage('just some free text');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Conventional-Commit shape/);
  });

  it('rejects an empty message', () => {
    expect(parseCommitMessage('   ').ok).toBe(false);
  });

  it('rejects a header over the length limit', () => {
    const subject = 'a'.repeat(MAX_HEADER_LENGTH);
    const r = parseCommitMessage(`feat: ${subject}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/max 72/);
  });

  it('rejects an emoji in the subject', () => {
    const r = parseCommitMessage('feat: ✨ add sparkles');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/emoji-free/);
  });
});
