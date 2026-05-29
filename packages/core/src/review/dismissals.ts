/**
 * Dedup against prior review (road-to-code-review.md Phase 5, T-CR-504).
 *
 * Within a session, do not re-surface a finding the user already dismissed
 * for the SAME unchanged hunk. The dismissal key binds to the hunk content,
 * so once the hunk changes the dismissal no longer applies and the finding
 * can resurface. Local-only state under `.event4u-agent/`.
 */

import { z } from 'zod';
import type { ReviewIssue } from './types.js';

const DismissalSchema = z.object({
  file: z.string(),
  /** Stable hash of the surrounding hunk content. */
  hunkHash: z.string(),
  /** Normalized finding description. */
  descriptionKey: z.string(),
});
export type Dismissal = z.infer<typeof DismissalSchema>;

export const DismissalsFileSchema = z.object({
  version: z.literal(1).default(1),
  dismissals: z.array(DismissalSchema).default([]),
});
export type DismissalsFile = z.infer<typeof DismissalsFileSchema>;

/** Cheap, stable, non-cryptographic string hash (FNV-1a). */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function normalizeDescription(description: string): string {
  return description.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Build the dismissal record for a finding against its current hunk content. */
export function dismissalFor(issue: ReviewIssue, hunkContent: string): Dismissal {
  return {
    file: issue.file,
    hunkHash: hashString(hunkContent),
    descriptionKey: normalizeDescription(issue.description),
  };
}

/** JSON keying avoids any delimiter collision with spaces in the description. */
function keyOf(d: Dismissal): string {
  return JSON.stringify([d.file, d.hunkHash, d.descriptionKey]);
}

/**
 * In-memory dismissal set. The host loads it from
 * `.event4u-agent/review-dismissals.json` and persists on change; the store
 * itself is pure so it is trivially testable.
 */
export class DismissalStore {
  private readonly records = new Map<string, Dismissal>();

  constructor(initial: Dismissal[] = []) {
    for (const d of initial) this.records.set(keyOf(d), d);
  }

  static fromJson(json: unknown): DismissalStore {
    const parsed = DismissalsFileSchema.safeParse(json);
    return new DismissalStore(parsed.success ? parsed.data.dismissals : []);
  }

  toJson(): DismissalsFile {
    return { version: 1, dismissals: [...this.records.values()] };
  }

  dismiss(issue: ReviewIssue, hunkContent: string): void {
    const d = dismissalFor(issue, hunkContent);
    this.records.set(keyOf(d), d);
  }

  isDismissed(issue: ReviewIssue, hunkContent: string): boolean {
    return this.records.has(keyOf(dismissalFor(issue, hunkContent)));
  }

  /** Drop findings the user already dismissed for the same unchanged hunk. */
  filter(issues: ReviewIssue[], hunkContentFor: (issue: ReviewIssue) => string): ReviewIssue[] {
    return issues.filter((issue) => !this.isDismissed(issue, hunkContentFor(issue)));
  }
}
