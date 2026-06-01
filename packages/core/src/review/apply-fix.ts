/**
 * Apply-fix edit construction (road-to-code-review.md Phase 4, core of
 * T-CR-404).
 *
 * A review NEVER writes. When the model proposed a fix, this builds the
 * `WriteFileArgs` for the existing permission-gated `WriteFileTool` (MVP
 * T-303), which produces the preview diff, routes through the diff-approval
 * gate, and records the audit entry — unchanged. The review just hands the
 * apply pipeline a proposed edit; the user still approves it.
 *
 * The edit replaces the finding's quoted span with the proposed fix. If the
 * span cannot be located in the current file content, no edit is produced —
 * the same strict contract as line-mapping.
 */

import type { WriteFileArgs } from '../tools/write-file.js';
import type { ReviewIssue } from './types.js';

/** The finding fields apply-fix reads — the whole `ReviewIssue` is not needed. */
export type FixableFinding = Pick<ReviewIssue, 'file' | 'quotedSpan' | 'proposedFix'>;

/**
 * Build the write args for a finding's proposed fix, or `null` when there is
 * no fix or the span no longer matches the file.
 */
export function buildFixEdit(issue: FixableFinding, fileContent: string): WriteFileArgs | null {
  if (!issue.proposedFix || !issue.quotedSpan) return null;
  const idx = fileContent.indexOf(issue.quotedSpan);
  if (idx === -1) return null; // span drifted — refuse to guess
  const content =
    fileContent.slice(0, idx) +
    issue.proposedFix +
    fileContent.slice(idx + issue.quotedSpan.length);
  if (content === fileContent) return null; // no-op fix
  return { path: issue.file, content };
}
