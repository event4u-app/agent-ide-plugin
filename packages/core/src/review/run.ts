/**
 * Review run orchestrator (road-to-code-review.md Phase 4, core of T-CR-401 /
 * T-CR-405).
 *
 * Ties the whole engine together: working-tree diff → file grouping →
 * per-group group-vote review → flattened findings. This is what an IDE
 * "Review changes" action calls; the action registration itself (JetBrains
 * `AnAction`, VS Code command) is the client/IDE-runtime layer on top.
 *
 * Streaming progress (T-CR-405) is emitted via `onProgress`; cancellation
 * (Stop button, MVP T-412) threads through `pipeline.signal` down to every
 * backend stream, so stopping the run cancels the in-flight LLM calls.
 */

import type { LlmBackend } from '../llm/backend.js';
import { defaultGitRunner, type GitRunner } from '../commands/commit.js';
import type { Review, ReviewIssue } from './types.js';
import { getDiff, type DiffSource } from './diff-source.js';
import { groupFiles } from './grouping.js';
import { groupVoteReview, type GroupVoteOptions } from './vote.js';
import type { ReviewPipelineOptions } from './pipeline.js';

export interface RunReviewProgress {
  phase: 'diffing' | 'reviewing' | 'done';
  totalGroups: number;
  completedGroups: number;
  /** Runs per group — surfaced so the UI can show "3/5 perspectives". */
  groupSize: number;
}

export interface RunReviewOptions {
  cwd: string;
  source?: DiffSource;
  pipeline: ReviewPipelineOptions;
  vote?: GroupVoteOptions;
  runner?: GitRunner;
  /** Import-edge adjacency for richer grouping (Context Engine, when present). */
  importEdges?: Map<string, string[]>;
  onProgress?(progress: RunReviewProgress): void;
}

export interface RunReviewResult {
  reviews: Review[];
  /** High-confidence findings flattened across every group. */
  issues: ReviewIssue[];
  potentialIssues: ReviewIssue[];
  /** Reviewed file paths. */
  files: string[];
}

/**
 * Run a full review over the working-tree diff. Groups are reviewed in order;
 * within a group the `groupSize` runs overlap (see `groupVoteReview`).
 */
export async function runReview(
  backend: LlmBackend,
  options: RunReviewOptions,
): Promise<RunReviewResult> {
  const groupSize = options.vote?.groupSize ?? 5;
  options.onProgress?.({ phase: 'diffing', totalGroups: 0, completedGroups: 0, groupSize });

  const changes = await getDiff(
    options.cwd,
    options.source ?? { mode: 'unstaged' },
    options.runner ?? defaultGitRunner,
  );
  const groups = groupFiles(changes, { importEdges: options.importEdges });

  const reviews: Review[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (options.pipeline.signal?.aborted) break;
    options.onProgress?.({
      phase: 'reviewing',
      totalGroups: groups.length,
      completedGroups: i,
      groupSize,
    });
    const group = groups[i] as string[];
    const review = await groupVoteReview(backend, group, changes, options.pipeline, options.vote);
    reviews.push(review);
  }

  options.onProgress?.({
    phase: 'done',
    totalGroups: groups.length,
    completedGroups: reviews.length,
    groupSize,
  });

  return {
    reviews,
    issues: reviews.flatMap((r) => r.issues),
    potentialIssues: reviews.flatMap((r) => r.potentialIssues),
    files: reviews.flatMap((r) => r.files),
  };
}
