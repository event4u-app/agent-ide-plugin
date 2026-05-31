import type { ToolReview } from '@event4u-agent/protocol';
import type { WriteFilesPlan } from './write-files.js';

/**
 * T-PRD02 — multi-file diff review payload.
 *
 * Maps a resolved {@link WriteFilesPlan} to the {@link ToolReview} the Core
 * attaches to an `approvalRequested` tool-call event, so the IDE can render a
 * per-file diff the user accepts or rejects before anything is written. Pure
 * projection — no disk access; the plan already carries every unified diff.
 *
 * Only the cleanly-resolved `files` of the plan are surfaced; unresolved edits
 * (`suggestion` / `not_found` / `ambiguous`) never reach the review card — the
 * agent loop re-prompts on those rather than asking the user to approve a
 * partial write.
 */
export function planToReview(plan: WriteFilesPlan): ToolReview {
  return {
    kind: 'diff',
    files: plan.files.map((file) => ({
      path: file.path,
      diff: file.diff,
      isNewFile: file.isNewFile,
    })),
  };
}
