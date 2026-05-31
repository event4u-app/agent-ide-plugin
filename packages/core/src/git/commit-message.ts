/**
 * Commit-message builder (product-readiness Phase 4, T-PRD14 core).
 *
 * From the staged (default) / working diff, build the LLM turn that proposes a
 * Conventional-Commit message, and parse + validate the model's reply. The Core
 * NEVER commits — it produces text the user edits and accepts (`commit-policy`).
 *
 * AI council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31, UNANIMOUS on
 * fork B): FAIL HARD on a malformed reply — `parseCommitMessage` returns
 * structured errors and the caller re-prompts, rather than synthesising a
 * commit from a brittle path/add-del heuristic that mislabels refactors. The
 * diff is rendered with the shipped `renderNumberedHunks` so the model reasons
 * over real lines, exactly like the review prompts.
 */

import type { ChatMessage } from '@event4u-agent/protocol';
import type { FileChange } from '../review/types.js';
import { renderNumberedHunks } from '../review/prompts.js';
import { changedFiles } from '../review/diff-source.js';
import { hasEmoji } from './text-rules.js';

/** The Conventional-Commit types the parser accepts. */
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;
export type ConventionalCommitType = (typeof CONVENTIONAL_TYPES)[number];

/** Git's 72-column hard limit for a subject line (the 50/72 rule). */
export const MAX_HEADER_LENGTH = 72;

export interface ParsedCommitMessage {
  type: ConventionalCommitType;
  /** Optional `(scope)` — `undefined` when the header carried none. */
  scope?: string;
  /** `true` when the header used `!` or the body has a `BREAKING CHANGE:` footer. */
  breaking: boolean;
  /** The header text after `type(scope): `. */
  subject: string;
  /** Body below the header (blank-line-separated), or `undefined`. */
  body?: string;
}

export type CommitMessageParseResult =
  | { ok: true; message: ParsedCommitMessage }
  | { ok: false; errors: string[] };

const HEADER_RE = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const TYPE_SET = new Set<string>(CONVENTIONAL_TYPES);

/**
 * Parse + validate a model-emitted commit message. Returns `{ ok: false,
 * errors }` on any violation so the caller re-prompts — no silent synthesis.
 */
export function parseCommitMessage(raw: string): CommitMessageParseResult {
  const errors: string[] = [];
  const cleaned = stripCodeFence(raw).trim();
  if (cleaned.length === 0) {
    return { ok: false, errors: ['message is empty'] };
  }

  const lines = cleaned.split('\n');
  const header = (lines[0] ?? '').trim();
  const match = HEADER_RE.exec(header);
  if (!match) {
    return {
      ok: false,
      errors: ['header is not Conventional-Commit shape: `type(scope): subject`'],
    };
  }

  const [, type, scope, bang, subjectRaw] = match;
  const subject = (subjectRaw ?? '').trim();

  if (!TYPE_SET.has(type ?? '')) {
    errors.push(`type "${type}" is not one of: ${CONVENTIONAL_TYPES.join(', ')}`);
  }
  if (subject.length === 0) {
    errors.push('subject is empty');
  }
  if (header.length > MAX_HEADER_LENGTH) {
    errors.push(`header is ${header.length} chars (max ${MAX_HEADER_LENGTH})`);
  }
  if (hasEmoji(header)) {
    errors.push('subject must be emoji-free (house rule)');
  }

  // Body = everything after the header, dropping exactly one separator blank line.
  const rest = lines.slice(1);
  while (rest.length > 0 && (rest[0] ?? '').trim() === '') rest.shift();
  const body = rest.join('\n').trim();
  const breaking = bang === '!' || /^BREAKING CHANGE:/m.test(body);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    message: {
      type: type as ConventionalCommitType,
      ...(scope ? { scope } : {}),
      breaking,
      subject,
      ...(body.length > 0 ? { body } : {}),
    },
  };
}

export interface CommitMessagePromptOptions {
  /** Current branch — surfaced as context, never used to derive the type. */
  branch?: string;
  /** Free-text steer appended to the turn ("focus on the API change"). */
  extraInstruction?: string;
  /** Cap on rendered files to bound the prompt (default 50). */
  maxFiles?: number;
}

const SYSTEM_PROMPT = [
  'You write a single Conventional-Commit message for a staged change set.',
  '',
  'Rules:',
  `- Header: \`type(scope): subject\`. type ∈ {${CONVENTIONAL_TYPES.join(', ')}}.`,
  `- Subject: imperative mood, no trailing period, header ≤ ${MAX_HEADER_LENGTH} chars.`,
  '- Add `!` after the scope for a breaking change, and a `BREAKING CHANGE:` body footer.',
  '- Body (optional): explain WHY, not what; wrap prose; blank line after the header.',
  '- No emoji anywhere. No attribution footer ("Generated with…", "Co-authored-by: <AI>").',
  '- Output ONLY the commit message — no code fences, no preamble.',
].join('\n');

/**
 * Build the chat turn that proposes a commit message from a parsed diff. Pure
 * over `FileChange[]` (use `getDiff` from `review/diff-source` to obtain it),
 * so it is unit-testable with diff fixtures and no git process.
 */
export function buildCommitMessagePrompt(
  changes: FileChange[],
  opts: CommitMessagePromptOptions = {},
): ChatMessage[] {
  const maxFiles = opts.maxFiles ?? 50;
  const shown = changes.slice(0, maxFiles);
  const truncated = changes.length - shown.length;

  const sections: string[] = [
    'Propose a Conventional-Commit message for the staged changes below.',
  ];
  if (opts.branch) sections.push(`\n### Branch\n${opts.branch}`);

  const files = changedFiles(changes);
  sections.push(`\n### Files (${files.length})\n${files.map((f) => `- ${f}`).join('\n')}`);

  const rendered = shown.map((c) => renderNumberedHunks(c)).join('\n\n');
  sections.push(`\n### Diff\n${rendered}`);
  if (truncated > 0) {
    sections.push(`\n(${truncated} more file(s) omitted from the diff to bound the prompt.)`);
  }
  const extra = opts.extraInstruction?.trim();
  if (extra) sections.push(`\n### Extra instruction\n${extra}`);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n').trim() },
  ];
}

/** Strip a single surrounding ```fenced``` block, if the model wrapped its reply. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNl = trimmed.indexOf('\n');
  if (firstNl === -1) return trimmed;
  const closing = trimmed.lastIndexOf('```');
  if (closing <= firstNl) return trimmed;
  return trimmed.slice(firstNl + 1, closing).trim();
}
