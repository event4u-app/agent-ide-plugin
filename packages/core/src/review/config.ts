/**
 * Review configuration (road-to-code-review.md Phase 5, T-CR-502).
 *
 * The schema + resolver are pure core; the settings UI that writes these
 * values follows the MVP T-204 pattern (client). Divergence #4 from sweep:
 * eps / threshold / group_size are configurable, not hard-coded.
 */

import { z } from 'zod';
import type { GroupVoteOptions } from './vote.js';
import type { ReviewIssue, Severity } from './types.js';
import { SEVERITY_RANK } from './types.js';

export const ReviewSettingsSchema = z
  .object({
    /** Runs per group. Lower for cost; 1 disables the vote (fast single-pass). */
    group_size: z.number().int().positive().default(5),
    /** Votes needed to land in `issues`. */
    label_threshold: z.number().int().positive().default(4),
    /** Votes needed to land in `potentialIssues`. */
    potential_threshold: z.number().int().positive().default(3),
    /** Hide findings below this severity (e.g. drop `info`). */
    severity_floor: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('info'),
    /** Security findings always render as Error (never down-weighted). */
    security_always_error: z.boolean().default(true),
    /** Opt-in background review when files are staged (T-CR-503). */
    auto_review_on_stage: z.boolean().default(false),
  })
  .default({});

export type ReviewSettings = z.infer<typeof ReviewSettingsSchema>;

/** Parse a raw settings block (e.g. the `review:` section), applying defaults. */
export function resolveReviewSettings(raw?: unknown): ReviewSettings {
  return ReviewSettingsSchema.parse(raw ?? {});
}

/** Map settings to the group-vote options the pipeline consumes. */
export function voteOptionsFromSettings(settings: ReviewSettings): GroupVoteOptions {
  return {
    groupSize: settings.group_size,
    labelThreshold: settings.label_threshold,
    potentialThreshold: settings.potential_threshold,
  };
}

/**
 * Drop findings below the severity floor. Security findings are exempt when
 * `security_always_error` is on — they are never hidden by the floor.
 */
export function applySeverityFloor(issues: ReviewIssue[], settings: ReviewSettings): ReviewIssue[] {
  const floor = SEVERITY_RANK[settings.severity_floor as Severity];
  return issues.filter((issue) => {
    if (settings.security_always_error && issue.category === 'security') return true;
    return SEVERITY_RANK[issue.severity] >= floor;
  });
}
