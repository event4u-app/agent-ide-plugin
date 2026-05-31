/**
 * Review-mode change summary (product-readiness Phase 4, T-PRD16 core).
 *
 * The `Review` agent mode (`agent/modes.ts`) runs the shipped review engine
 * (`review/run.ts` `runReview`) over the current diff; this folds the
 * `RunReviewResult` + the source `FileChange[]` into a compact `ChangeSummary`
 * the IDE renders as a change-summary card.
 *
 * AI council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31, UNANIMOUS on
 * fork D): PURE DERIVATION — no extra LLM call. The findings already exist;
 * aggregating them is deterministic and zero-cost. Trap (codex): the
 * per-severity counts are exhaustive and stable — every `Severity` key is
 * present even at zero — so the card never has to guess a missing bucket.
 */

import type { FileChange, ReviewIssue, Severity } from '../review/types.js';
import { SEVERITY_RANK } from '../review/types.js';
import type { RunReviewResult } from '../review/run.js';

export interface ChangeSummary {
  /** Files in the reviewed diff. */
  filesChanged: number;
  /** Added / deleted line counts across all hunks. */
  additions: number;
  deletions: number;
  /** Exhaustive per-severity finding counts (every key present, 0 when none). */
  findingsBySeverity: Record<Severity, number>;
  /** Total high-confidence findings. */
  totalFindings: number;
  /** Near-threshold findings (the review engine's second bucket). */
  potentialFindings: number;
  /** Highest-severity findings first, capped at `topN`. */
  topFindings: ReviewIssue[];
}

export interface SummarizeOptions {
  /** How many findings to surface in `topFindings` (default 5). */
  topN?: number;
}

const ALL_SEVERITIES = Object.keys(SEVERITY_RANK) as Severity[];

/** Derive a {@link ChangeSummary} from a completed review + its source diff. */
export function summarizeReview(
  result: RunReviewResult,
  changes: FileChange[],
  opts: SummarizeOptions = {},
): ChangeSummary {
  const topN = opts.topN ?? 5;

  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    for (const hunk of change.hunks) {
      for (const c of hunk.changes) {
        if (c.kind === 'add') additions += 1;
        else if (c.kind === 'del') deletions += 1;
      }
    }
  }

  const findingsBySeverity = emptySeverityCounts();
  for (const issue of result.issues) {
    findingsBySeverity[issue.severity] += 1;
  }

  const topFindings = [...result.issues].sort(compareFindings).slice(0, topN);

  return {
    filesChanged: changes.length,
    additions,
    deletions,
    findingsBySeverity,
    totalFindings: result.issues.length,
    potentialFindings: result.potentialIssues.length,
    topFindings,
  };
}

/** A zero-initialised, exhaustive severity-count record. */
function emptySeverityCounts(): Record<Severity, number> {
  const counts = {} as Record<Severity, number>;
  for (const severity of ALL_SEVERITIES) counts[severity] = 0;
  return counts;
}

/** Sort findings by severity (high → low), then by vote-derived confidence. */
function compareFindings(a: ReviewIssue, b: ReviewIssue): number {
  const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (bySeverity !== 0) return bySeverity;
  return (b.confidence ?? 0) - (a.confidence ?? 0);
}
