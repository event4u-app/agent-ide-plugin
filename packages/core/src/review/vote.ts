/**
 * Group-vote self-consistency filter (road-to-code-review.md Phase 3,
 * T-CR-301 / T-CR-303 / T-CR-305).
 *
 * The mechanism that makes the reviewer trustworthy: run the Phase-2 chain N
 * times, cluster semantically-equivalent issues across runs, and keep a
 * cluster only if a majority of runs produced it. Port of `group_vote_review_pr`
 * (`review_utils.py:1016`).
 *
 * Clustering uses the n-gram fallback (`clustering.ts`) until the Phase-8
 * embedder lands; swap the `SimilarityStrategy` to switch.
 *
 * AI-Council (codex + gemini, 2026-05-29): the five runs of one prompt are NOT
 * independent — vary the sampling temperature across runs so a correlated
 * hallucination is less likely to sweep 4/5. Every kept finding already maps
 * to a real changed line (Phase 2 guarantees it).
 */

import type { LlmBackend } from '../llm/backend.js';
import type { FileChange, Review, ReviewIssue } from './types.js';
import { SEVERITY_RANK } from './types.js';
import { reviewGroup, type ReviewPipelineOptions } from './pipeline.js';
import {
  clusterIssues,
  NgramJaccardSimilarity,
  type SimilarityStrategy,
  type IssueCluster,
} from './clustering.js';

export interface GroupVoteOptions {
  /** Runs per file group (sweep's default). */
  groupSize?: number;
  /** ≥ this many votes → high-confidence `issues` (sweep's LABEL_THRESHOLD). */
  labelThreshold?: number;
  /** ≥ this many votes (below labelThreshold) → `potentialIssues`. */
  potentialThreshold?: number;
  /** Base temperature; each run adds a per-run delta for vote independence. */
  baseTemperature?: number;
  temperatureStep?: number;
  /** Max concurrent runs (worker pool — the 5 runs overlap). */
  concurrency?: number;
  /** Clustering strategy; defaults to the n-gram Jaccard fallback. */
  strategy?: SimilarityStrategy;
}

const DEFAULTS = {
  groupSize: 5,
  labelThreshold: 4,
  potentialThreshold: 3,
  baseTemperature: 0.2,
  temperatureStep: 0.15,
  concurrency: 5,
};

/** Run `fn` over `items` with a bounded number of concurrent promises. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

function withVotes(issue: ReviewIssue, votes: number, groupSize: number): ReviewIssue {
  return { ...issue, votes, groupSize, confidence: votes / groupSize };
}

function bySeverityDesc(a: ReviewIssue, b: ReviewIssue): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
}

/**
 * Run the group-vote review over a single file group. Each cluster's vote
 * count gates its bucket; the representative carries `votes:N/groupSize` so
 * the UI can show "4/5 reviewers flagged this" (T-CR-305 — never hide it).
 */
export async function groupVoteReview(
  backend: LlmBackend,
  files: string[],
  changes: FileChange[],
  pipelineOptions: ReviewPipelineOptions,
  voteOptions: GroupVoteOptions = {},
): Promise<Review> {
  const groupSize = voteOptions.groupSize ?? DEFAULTS.groupSize;
  const labelThreshold = voteOptions.labelThreshold ?? DEFAULTS.labelThreshold;
  const potentialThreshold = voteOptions.potentialThreshold ?? DEFAULTS.potentialThreshold;
  const baseTemp = voteOptions.baseTemperature ?? DEFAULTS.baseTemperature;
  const tempStep = voteOptions.temperatureStep ?? DEFAULTS.temperatureStep;
  const concurrency = voteOptions.concurrency ?? DEFAULTS.concurrency;
  const strategy = voteOptions.strategy ?? new NgramJaccardSimilarity();

  // Single-pass shortcut: groupSize 1 disables the vote (a fast review).
  if (groupSize <= 1) {
    const review = await reviewGroup(backend, files, changes, pipelineOptions);
    return {
      ...review,
      issues: review.issues.map((i) => withVotes(i, 1, 1)),
      potentialIssues: review.potentialIssues.map((i) => withVotes(i, 1, 1)),
    };
  }

  const runConfigs = Array.from({ length: groupSize }, (_, run) => run);
  const runReviews = await mapWithConcurrency(runConfigs, concurrency, async (run) => {
    const temperature = Math.min(1, baseTemp + run * tempStep);
    return reviewGroup(backend, files, changes, {
      ...pipelineOptions,
      config: { ...pipelineOptions.config, temperature },
    });
  });

  // Collect every surfaced candidate across runs, tagged with its run index.
  const tagged: ReviewIssue[] = [];
  runReviews.forEach((review, run) => {
    for (const issue of [...review.issues, ...review.potentialIssues]) {
      tagged.push({ ...issue, sourceRun: run });
    }
  });

  const clusters = clusterIssues(tagged, strategy);
  const issues: ReviewIssue[] = [];
  const potentialIssues: ReviewIssue[] = [];

  for (const cluster of clusters) {
    const rep = withVotes(cluster.representative, cluster.votes, groupSize);
    const isSecurity = rep.category === 'security';
    if (cluster.votes >= labelThreshold) {
      issues.push(rep);
    } else if (cluster.votes >= potentialThreshold || isSecurity) {
      // Security findings are never silently dropped — they surface as
      // potential even on a single vote (deliberate divergence from sweep).
      potentialIssues.push(rep);
    }
    // Below the potential threshold and not security → dropped as noise.
  }

  issues.sort(bySeverityDesc);
  potentialIssues.sort(bySeverityDesc);

  return {
    files,
    diffSummary: runReviews[0]?.diffSummary ?? '',
    issues,
    potentialIssues,
  };
}

export type { IssueCluster };
