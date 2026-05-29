/**
 * Findings → IDE diagnostics mapping (road-to-code-review.md Phase 4,
 * core of T-CR-402).
 *
 * Produces a transport-neutral diagnostic shape both clients render natively:
 * JetBrains `HighlightInfo` / external annotations, VS Code
 * `DiagnosticCollection` entries. Severity mapping per the roadmap:
 *   security      → Error   (never down-weighted)
 *   issue bucket  → Warning
 *   potential     → Information
 *
 * The vote count rides in the message ("[4/5] …") so the trust signal is
 * visible even before the finding card renders (T-CR-305).
 */

import type { IssueCategory, ReviewIssue } from './types.js';
import type { RunReviewResult } from './run.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface ReviewDiagnostic {
  file: string;
  /** 1-based new-file line. */
  line: number;
  endLine: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
  category: IssueCategory;
  votes?: number;
  groupSize?: number;
}

const SOURCE = 'event4u review';

function votePrefix(issue: ReviewIssue): string {
  return issue.votes && issue.groupSize ? `[${issue.votes}/${issue.groupSize}] ` : '';
}

/** Map a single finding to a diagnostic. `bucket` selects the base severity. */
export function toDiagnostic(issue: ReviewIssue, bucket: 'issue' | 'potential'): ReviewDiagnostic {
  // Security is always an Error regardless of bucket; otherwise the bucket
  // chooses Warning (high-confidence) vs Information (near-threshold).
  const severity: DiagnosticSeverity =
    issue.category === 'security' ? 'error' : bucket === 'issue' ? 'warning' : 'information';
  return {
    file: issue.file,
    line: issue.line ?? 1,
    endLine: issue.endLine ?? issue.line ?? 1,
    severity,
    message: `${votePrefix(issue)}${issue.description}`,
    source: SOURCE,
    category: issue.category,
    votes: issue.votes,
    groupSize: issue.groupSize,
  };
}

/** Map a whole review result into a flat diagnostic list. */
export function toDiagnostics(result: RunReviewResult): ReviewDiagnostic[] {
  return [
    ...result.issues.map((i) => toDiagnostic(i, 'issue')),
    ...result.potentialIssues.map((i) => toDiagnostic(i, 'potential')),
  ];
}
