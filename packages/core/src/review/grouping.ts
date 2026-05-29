/**
 * File grouping (road-to-code-review.md Phase 1, T-CR-104).
 *
 * Clusters related changed files so a single review prompt sees a coherent
 * group, not one file in isolation. Port of sweep's `GroupedFilesForReview` /
 * `cluster_patches` (`review_utils.py:1245`).
 *
 * v0 heuristic: same directory. The richer heuristic (import-edge clustering
 * via the Context Engine symbol index, road-to-v1-0.md Phase 6) is gated on
 * that index existing — when absent we fall back to directory-only, which is
 * the deliberate v0 per the roadmap.
 */

import type { FileChange } from './types.js';

export interface GroupingOptions {
  /**
   * Optional import-edge adjacency: `file -> files it imports / is imported
   * by`. When provided, files connected by an edge join the same group even
   * across directories. Supplied by the Context Engine index when available.
   */
  importEdges?: Map<string, string[]>;
  /** Cap on files per group so a giant directory does not become one prompt. */
  maxGroupSize?: number;
}

const DEFAULT_MAX_GROUP_SIZE = 8;

/** Directory portion of a POSIX-style path (`a/b/c.ts` -> `a/b`). */
export function dirOf(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx === -1 ? '.' : file.slice(0, idx);
}

/**
 * Group changed files. Binary files are reviewed in no group (excluded). The
 * result is a list of groups, each a list of file paths, in stable order.
 */
export function groupFiles(files: FileChange[], options: GroupingOptions = {}): string[][] {
  const reviewable = files.filter((f) => !f.binary && f.status !== 'deleted');
  const paths = reviewable.map((f) => f.file);
  const maxGroupSize = options.maxGroupSize ?? DEFAULT_MAX_GROUP_SIZE;

  // Union-find over the file set; union by directory, then by import edge.
  const parent = new Map<string, string>();
  for (const p of paths) parent.set(p, p);
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // 1. Same directory.
  const byDir = new Map<string, string[]>();
  for (const p of paths) {
    const d = dirOf(p);
    const list = byDir.get(d) ?? [];
    list.push(p);
    byDir.set(d, list);
  }
  for (const list of byDir.values()) {
    for (let i = 1; i < list.length; i++) union(list[0] as string, list[i] as string);
  }

  // 2. Import edges (only between files that are both in the change set).
  if (options.importEdges) {
    const inSet = new Set(paths);
    for (const [from, tos] of options.importEdges) {
      if (!inSet.has(from)) continue;
      for (const to of tos) if (inSet.has(to)) union(from, to);
    }
  }

  // Collect groups in first-seen order for stable output.
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const root = find(p);
    const list = groups.get(root) ?? [];
    list.push(p);
    groups.set(root, list);
  }

  // Split oversized groups into chunks so one prompt stays bounded.
  const result: string[][] = [];
  for (const list of groups.values()) {
    if (list.length <= maxGroupSize) {
      result.push(list);
      continue;
    }
    for (let i = 0; i < list.length; i += maxGroupSize) {
      result.push(list.slice(i, i + maxGroupSize));
    }
  }
  return result;
}
