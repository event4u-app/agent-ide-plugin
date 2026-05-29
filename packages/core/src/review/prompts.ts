/**
 * Review-prompt builders (road-to-code-review.md Phase 2).
 *
 * Ports sweep's `review_prompts.py` staged reasoning, dropping the
 * GitHub/`SWEEP.md` specifics and the hand-rolled XML. The prompt rules that
 * still hold are kept verbatim in spirit:
 *  - only merge-blocking FUNCTIONAL issues, no style nits;
 *  - assume existing (unchanged) code is correct;
 *  - "not enough information" is NOT an issue.
 *
 * AI-Council (codex + gemini, 2026-05-29): present LINE-NUMBERED hunks so the
 * model can anchor a finding to a real new-file line instead of inventing one.
 */

import type { FileChange } from './types.js';

/**
 * Render a file's hunks with explicit new-file line numbers on every kept
 * line, so the model quotes real lines. Deleted lines are shown (prefixed
 * `-`) without a number; added/context lines carry their new-file number.
 */
export function renderNumberedHunks(change: FileChange): string {
  if (change.binary) return `### ${change.file} (binary — not reviewable)`;
  const out: string[] = [`### ${change.file}${change.oldFile ? ` (was ${change.oldFile})` : ''}`];
  for (const hunk of change.hunks) {
    out.push(hunk.section ? `@@ ${hunk.section}` : '@@');
    for (const c of hunk.changes) {
      if (c.kind === 'del') {
        out.push(`      - ${c.text}`);
      } else {
        const marker = c.kind === 'add' ? '+' : ' ';
        const num = String(c.newLine).padStart(5, ' ');
        out.push(`${num} ${marker} ${c.text}`);
      }
    }
  }
  return out.join('\n');
}

/** Render an entire file group as numbered hunks for a single prompt. */
export function renderGroup(files: string[], changes: FileChange[]): string {
  const byPath = new Map(changes.map((c) => [c.file, c]));
  return files
    .map((f) => byPath.get(f))
    .filter((c): c is FileChange => c !== undefined)
    .map(renderNumberedHunks)
    .join('\n\n');
}

const FUNCTIONAL_RULES = [
  'Report only merge-blocking FUNCTIONAL issues: logic errors, null/undefined',
  'dereferences, off-by-one, missing error handling, race conditions, resource',
  'leaks, broken invariants, and security problems.',
  'Assume existing (unchanged) code is correct — only review the changed lines',
  'and the obligations they create.',
  'Do NOT report style, formatting, naming, or preference nits.',
  'If you are not sure there is a bug, do NOT report it ("not enough',
  'information" is not an issue).',
  'For every issue, quote the EXACT new-file code in verbatimSnippet (1–8',
  'contiguous lines) and give its new-file startLine/endLine. If you cannot',
  'quote an exact span, do not report the issue.',
].join(' ');

export function stage1System(rules?: string): string {
  const base =
    'You are a meticulous senior code reviewer examining a working-tree diff. ' +
    FUNCTIONAL_RULES +
    ' Call submit_findings exactly once with your changeSummary and issues.';
  return rules ? `${base}\n\nProject-specific review rules:\n${rules}` : base;
}

export function stage1User(files: string[], changes: FileChange[]): string {
  return [
    'Review the following change. Lines are prefixed with their new-file line',
    'number; `+` marks added lines, `-` marks removed lines (no number).',
    '',
    renderGroup(files, changes),
  ].join('\n');
}

export function stage2System(): string {
  return (
    'You are stress-testing a code change for edge cases. Generate pointed ' +
    'Yes/No questions about concurrency, null/undefined handling, off-by-one, ' +
    'boundary conditions, and error paths, phrased so that "yes" means THERE ' +
    'IS A BUG. Then answer each. Only a "yes" answer with a concrete, ' +
    'line-anchored issue counts — report it via submit_findings. "Unknown" or ' +
    '"no" never produces an issue. Quote exact new-file spans.'
  );
}

export function stage2User(files: string[], changes: FileChange[], changeSummary: string): string {
  return [
    `Change summary from the first reviewer:\n${changeSummary}`,
    '',
    'Now find edge-case bugs in the change below (numbered new-file lines):',
    '',
    renderGroup(files, changes),
  ].join('\n');
}

export function stage3System(): string {
  return (
    'You are a skeptical second reviewer. For each candidate issue, decide ' +
    'whether it is a SEVERE, merge-blocking defect that you are confident ' +
    'about. Drop weak, speculative, or non-blocking findings. Be strict — a ' +
    'false positive is worse than a miss. Call submit_decisions once. ' +
    '(Security findings are handled separately and are never dropped here.)'
  );
}

export function stage3User(
  files: string[],
  changes: FileChange[],
  candidates: Array<{ id: string; description: string; severity: string; category: string }>,
): string {
  const list = candidates
    .map((c) => `- [${c.id}] (${c.severity}/${c.category}) ${c.description}`)
    .join('\n');
  return [
    'Candidate issues to re-litigate:',
    list || '(none)',
    '',
    'The change under review (numbered new-file lines):',
    '',
    renderGroup(files, changes),
  ].join('\n');
}
