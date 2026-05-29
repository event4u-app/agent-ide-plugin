/**
 * Working-tree diff source (road-to-code-review.md Phase 1, T-CR-101 / T-CR-102).
 *
 * Produces a structured `FileChange[]` from one of: staged (`git diff
 * --cached`), unstaged (`git diff`), or a ref range (`git diff <base>...<head>`).
 * Shells out to `git` via the same `GitRunner` abstraction `/commit` uses
 * (MVP T-403), so it is fully unit-testable with an injected runner.
 *
 * A review is read-only by construction — this module only reads `git`.
 */

import { defaultGitRunner, type GitRunner } from '../commands/commit.js';
import type { FileChange, Hunk, HunkChange } from './types.js';

export type DiffSource =
  | { mode: 'staged' }
  | { mode: 'unstaged' }
  | { mode: 'range'; base: string; head?: string };

/** Build the `git diff` argv for a given source. */
export function diffArgs(source: DiffSource): string[] {
  // `--no-color` / `--no-ext-diff` keep the output machine-parseable;
  // `-M` enables rename detection; `--unified=3` gives the model context.
  const base = ['diff', '--no-color', '--no-ext-diff', '-M', '--unified=3'];
  switch (source.mode) {
    case 'staged':
      return [...base, '--cached'];
    case 'unstaged':
      return base;
    case 'range':
      return [...base, `${source.base}...${source.head ?? 'HEAD'}`];
  }
}

/** Run `git diff` for the given source and parse it into `FileChange[]`. */
export async function getDiff(
  cwd: string,
  source: DiffSource = { mode: 'unstaged' },
  runner: GitRunner = defaultGitRunner,
): Promise<FileChange[]> {
  const result = await runner.run(diffArgs(source), cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed (${result.exitCode}): ${result.stderr.trim()}`);
  }
  return parseUnifiedDiff(result.stdout);
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse `git diff` unified output into `FileChange[]` with per-row old/new
 * line numbers. Handles added / deleted / renamed / copied / binary files.
 */
export function parseUnifiedDiff(diff: string): FileChange[] {
  const files: FileChange[] = [];
  const lines = diff.split('\n');
  let current: FileChange | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const closeHunk = (): void => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = (): void => {
    closeHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      closeFile();
      const { aPath, bPath } = parseDiffGitHeader(line);
      current = {
        file: bPath ?? aPath ?? 'unknown',
        status: 'modified',
        binary: false,
        hunks: [],
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldFile = line.slice('rename from '.length).trim();
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.file = line.slice('rename to '.length).trim();
      continue;
    }
    if (line.startsWith('copy from ')) {
      current.status = 'copied';
      current.oldFile = line.slice('copy from '.length).trim();
      continue;
    }
    if (line.startsWith('copy to ')) {
      current.file = line.slice('copy to '.length).trim();
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = stripDiffPathPrefix(line.slice(4).trim());
      if (p && p !== '/dev/null' && !current.oldFile) current.oldFile = p;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = stripDiffPathPrefix(line.slice(4).trim());
      if (p && p !== '/dev/null') current.file = p;
      continue;
    }

    const headerMatch = HUNK_HEADER.exec(line);
    if (headerMatch) {
      closeHunk();
      const oldStart = Number(headerMatch[1]);
      const oldCount = headerMatch[2] === undefined ? 1 : Number(headerMatch[2]);
      const newStart = Number(headerMatch[3]);
      const newCount = headerMatch[4] === undefined ? 1 : Number(headerMatch[4]);
      hunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        section: (headerMatch[5] ?? '').trim(),
        changes: [],
      };
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    if (!hunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const marker = line[0];
    const text = line.slice(1);
    let change: HunkChange | null = null;
    if (marker === '+') {
      change = { kind: 'add', oldLine: null, newLine, text };
      newLine += 1;
    } else if (marker === '-') {
      change = { kind: 'del', oldLine, newLine: null, text };
      oldLine += 1;
    } else if (marker === ' ') {
      change = { kind: 'context', oldLine, newLine, text };
      oldLine += 1;
      newLine += 1;
    }
    if (change) hunk.changes.push(change);
  }

  closeFile();
  return files;
}

function parseDiffGitHeader(line: string): { aPath: string | null; bPath: string | null } {
  // `diff --git a/path/to b/path/to` — paths may contain spaces, so anchor on
  // the ` b/` boundary from the right.
  const body = line.slice('diff --git '.length);
  const bIdx = body.lastIndexOf(' b/');
  if (bIdx === -1) return { aPath: null, bPath: null };
  const aRaw = body.slice(0, bIdx);
  const bRaw = body.slice(bIdx + 1);
  return { aPath: stripDiffPathPrefix(aRaw), bPath: stripDiffPathPrefix(bRaw) };
}

function stripDiffPathPrefix(path: string): string {
  if (path === '/dev/null') return path;
  // Strip the leading `a/` or `b/` git prefix; tolerate quoted paths.
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) return unquoted.slice(2);
  return unquoted;
}

/** A flat, human-readable list of changed file paths — used in prompts/logs. */
export function changedFiles(files: FileChange[]): string[] {
  return files.map((f) => f.file);
}
