/**
 * PR-description builder (product-readiness Phase 4, T-PRD15 core).
 *
 * From the branch diff (a `range` source) + the commit log, build the LLM turn
 * that drafts a PR body, and sanitise the model's reply against the house
 * rules. The Core never opens a PR — it produces editable text.
 *
 * AI council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31, UNANIMOUS):
 *  - fork C: `sanitizePrBody` STRIPS (lossy) and returns `{ body, warnings }`
 *    — deterministic compliance beats trusting the model;
 *  - trap (both): `readCommitLog` is bounded (default 30 commits, body capped)
 *    so a long-running branch can't blow the prompt budget — `truncated`
 *    signals when older commits were dropped;
 *  - trap (codex): sanitise the PR TITLE too, not only the body.
 */

import type { ChatMessage } from '@event4u-agent/protocol';
import type { FileChange } from '../review/types.js';
import { defaultGitRunner, type GitRunner } from '../commands/commit.js';
import { changedFiles } from '../review/diff-source.js';
import { collapseBlankLines, stripAttributionLines, stripDecorativeEmoji } from './text-rules.js';

export interface CommitLogEntry {
  /** Full 40-char commit hash. */
  hash: string;
  subject: string;
  /** Commit body, capped to `maxBodyChars`; empty when the commit had none. */
  body: string;
}

export interface CommitLog {
  entries: CommitLogEntry[];
  /** Total commits in `base..head` before the `maxCommits` cap. */
  total: number;
  /** `true` when older commits were dropped to honour `maxCommits`. */
  truncated: boolean;
}

export interface CommitLogOptions {
  /** Newest-N commits to keep (default 30). */
  maxCommits?: number;
  /** Per-commit body cap in chars (default 500). */
  maxBodyChars?: number;
}

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

/**
 * Read the commit log for `base..head` via the injectable `GitRunner`. Bounded
 * by construction — keeps the newest `maxCommits` and caps each body.
 */
export async function readCommitLog(
  cwd: string,
  base: string,
  head = 'HEAD',
  runner: GitRunner = defaultGitRunner,
  opts: CommitLogOptions = {},
): Promise<CommitLog> {
  const maxCommits = opts.maxCommits ?? 30;
  const maxBodyChars = opts.maxBodyChars ?? 500;
  const format = `--format=%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
  const result = await runner.run(['log', '--no-color', format, `${base}..${head}`], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git log failed (${result.exitCode}): ${result.stderr.trim()}`);
  }

  const records = result.stdout
    .split(RECORD_SEP)
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r.trim().length > 0);
  const total = records.length;
  const kept = records.slice(0, maxCommits);
  const entries: CommitLogEntry[] = kept.map((record) => {
    const [hash = '', subject = '', body = ''] = record.split(FIELD_SEP);
    const trimmedBody = body.trim();
    return {
      hash: hash.trim(),
      subject: subject.trim(),
      body:
        trimmedBody.length > maxBodyChars ? `${trimmedBody.slice(0, maxBodyChars)}…` : trimmedBody,
    };
  });

  return { entries, total, truncated: total > kept.length };
}

export interface PrDescriptionPromptOptions {
  branch?: string;
  /** The merge base / target ref (e.g. `main`) — context only. */
  base?: string;
  extraInstruction?: string;
}

const SYSTEM_PROMPT = [
  'You draft a pull-request description in GitHub-flavoured Markdown.',
  '',
  'Structure:',
  '- `## Summary` — 1-3 sentences on what the PR does and why.',
  '- `## Changes` — bullet list of the notable changes.',
  '- `## Testing` — how it was verified.',
  '',
  'Rules:',
  '- No decorative emoji. No attribution footer ("Generated with…", "Co-authored-by: <AI>").',
  '- No marketing fluff; describe the change, not its importance.',
  '- Output ONLY the description body — no PR title line, no code fences.',
].join('\n');

/**
 * Build the chat turn that drafts a PR body. Pure over the diff + log so it is
 * unit-testable; obtain `changes` via `getDiff({ mode: 'range', base })` and
 * `log` via `readCommitLog`.
 */
export function buildPrDescriptionPrompt(
  changes: FileChange[],
  log: CommitLog,
  opts: PrDescriptionPromptOptions = {},
): ChatMessage[] {
  const sections: string[] = ['Draft a PR description for the branch below.'];
  if (opts.branch) sections.push(`\n### Branch\n${opts.branch}`);
  if (opts.base) sections.push(`\n### Target\n${opts.base}`);

  const commitLines = log.entries.map((c) => `- ${c.subject}`).join('\n');
  const commitHeader = log.truncated
    ? `### Commits (${log.entries.length} of ${log.total}, older omitted)`
    : `### Commits (${log.entries.length})`;
  sections.push(`\n${commitHeader}\n${commitLines || '(none)'}`);

  sections.push(`\n### Changed files (${changes.length})\n${formatDiffstat(changes)}`);

  const extra = opts.extraInstruction?.trim();
  if (extra) sections.push(`\n### Extra instruction\n${extra}`);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n').trim() },
  ];
}

export interface SanitizeResult {
  body: string;
  /** Human-readable notes on what was stripped (empty → nothing changed). */
  warnings: string[];
}

/**
 * Enforce the house rules on a model-drafted PR body: drop AI-attribution
 * lines, strip decorative emoji (functional ❌ ✅ ⚠️ survive), collapse the
 * blank-line runs left behind. Lossy and deterministic.
 */
export function sanitizePrBody(raw: string): SanitizeResult {
  const warnings: string[] = [];
  const { text: noAttribution, removed } = stripAttributionLines(raw);
  if (removed > 0) warnings.push(`removed ${removed} attribution line(s)`);

  const noEmoji = stripDecorativeEmoji(noAttribution, { keepStatus: true });
  if (noEmoji !== noAttribution) warnings.push('removed decorative emoji');

  const body = `${collapseBlankLines(noEmoji).trim()}\n`;
  return { body, warnings };
}

/**
 * Enforce the house rules on a PR title: single line, fully emoji-free
 * (titles allow no emoji at all), attribution stripped.
 */
export function sanitizePrTitle(raw: string): { title: string; warnings: string[] } {
  const warnings: string[] = [];
  const firstLine = (raw.split('\n')[0] ?? '').trim();
  const { text: noAttribution, removed } = stripAttributionLines(firstLine);
  if (removed > 0) warnings.push('removed attribution from title');

  const noEmoji = stripDecorativeEmoji(noAttribution, { keepStatus: false });
  if (noEmoji !== noAttribution) warnings.push('removed emoji from title');

  const title = noEmoji.replace(/\s+/g, ' ').trim();
  return { title, warnings };
}

/** Compact per-file diffstat (`+adds / -dels` from the parsed hunks). */
function formatDiffstat(changes: FileChange[]): string {
  if (changes.length === 0) return '(no changes)';
  return changedFiles(changes)
    .map((file, i) => {
      const change = changes[i] as FileChange;
      if (change.binary) return `- ${file} (binary)`;
      let adds = 0;
      let dels = 0;
      for (const hunk of change.hunks) {
        for (const c of hunk.changes) {
          if (c.kind === 'add') adds += 1;
          else if (c.kind === 'del') dels += 1;
        }
      }
      return `- ${file} (+${adds} / -${dels}, ${change.status})`;
    })
    .join('\n');
}
