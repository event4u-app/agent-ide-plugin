/**
 * Code-Review data model (road-to-code-review.md Phase 1, T-CR-102 / T-CR-103).
 *
 * A hunk-level model of "what changed" that the review prompts consume, plus
 * the issue shape the whole pipeline emits. Ported from sweepai/sweep's
 * `dataclasses/codereview.py` (`Patch` / `PRChange` / `CodeReviewIssue`),
 * adapted to IDE-local, diff-driven use.
 *
 * AI-Council (codex + gemini, 2026-05-29) convergence folded in:
 *  - `category` is first-class so the security exemption (Stage 3) has a
 *    field to key on.
 *  - `line` is nullable until the line-mapping step resolves a model-quoted
 *    span to a real new-file line — never trust a model-emitted line number.
 *  - model-emitted confidence (`modelConfidence`, noisy) is kept separate
 *    from the vote-derived `confidence` (Phase 3).
 *  - `potentialIssues[]` carries the same shape as `issues[]`, not a weaker
 *    one.
 */

/** Ranked high → low. Used for the Stage 4 severity sort. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Severity ordering for sorts — higher number = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Issue category. `security` is load-bearing: the Stage 3 critical pass must
 * never down-weight a `security` finding (deliberate divergence from sweep,
 * see road-to-code-review.md Context).
 */
export type IssueCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'concurrency'
  | 'correctness'
  | 'style'
  | 'other';

/** One line inside a hunk, tagged with its role and resolved line numbers. */
export interface HunkChange {
  kind: 'add' | 'del' | 'context';
  /** 1-based old-file line; `null` for added lines. */
  oldLine: number | null;
  /** 1-based new-file line; `null` for deleted lines. */
  newLine: number | null;
  /** Line text without the leading `+` / `-` / ` ` marker. */
  text: string;
}

/** A unified-diff hunk: a contiguous changed region of one file. */
export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** The `@@ … @@` section heading (often the enclosing function) — context. */
  section: string;
  changes: HunkChange[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

/**
 * One changed file. Hunk-level granularity is what lets the review prompt
 * reason about one change at a time and map a finding back to a real line.
 */
export interface FileChange {
  /** New path (or the old path for a pure deletion). */
  file: string;
  /** Previous path — only set for renames / copies. */
  oldFile?: string;
  status: FileStatus;
  /** `true` when git reported a binary diff — no hunks, never reviewed. */
  binary: boolean;
  hunks: Hunk[];
}

/**
 * A single review finding. `line` anchors a diagnostic to the new-file line.
 * Ported from `CodeReviewIssue` (`dataclasses/codereview.py:4`) plus our
 * `severity` / `category` / vote metadata.
 */
export interface ReviewIssue {
  /** Stable within a run — `${file}:${stage}:${index}` style. */
  id: string;
  file: string;
  /** 1-based new-file line. `null` until line-mapping resolves the span. */
  line: number | null;
  /** Last line of the span when it covers more than one line. */
  endLine?: number | null;
  /** Verbatim code the model quoted — validated against the real new file. */
  quotedSpan?: string;
  description: string;
  severity: Severity;
  category: IssueCategory;
  /** Model self-rated confidence (0..1). Noisy — never the trust signal. */
  modelConfidence?: number;
  /** Vote-derived confidence (Phase 3). The real trust signal. */
  confidence?: number;
  /** How many of `groupSize` runs produced this cluster (Phase 3). */
  votes?: number;
  groupSize?: number;
  /** Which parallel run produced it (Phase 3 provenance). */
  sourceRun?: number;
  /** Which pipeline stage emitted it (Phase 2 provenance). */
  stage?: string;
  /** Optional model-proposed replacement for the span (never auto-applied). */
  proposedFix?: string;
}

/**
 * A review over one coherent file group (T-CR-104 clusters related files so a
 * prompt sees a group, not a file in isolation). `issues` are high-confidence;
 * `potentialIssues` are near-threshold (sweep's two-bucket split).
 */
export interface Review {
  /** Files covered by this review group. */
  files: string[];
  diffSummary: string;
  issues: ReviewIssue[];
  potentialIssues: ReviewIssue[];
}
