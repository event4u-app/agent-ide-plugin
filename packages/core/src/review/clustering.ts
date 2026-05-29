/**
 * Issue clustering for the group-vote filter (road-to-code-review.md Phase 3,
 * T-CR-302 / T-CR-303 / T-CR-304).
 *
 * The local ONNX embedder (road-to-v1-0.md Phase 8) does not exist yet, so we
 * ship the DEGRADED FALLBACK the roadmap mandates: cluster by normalized
 * issue-text n-gram Jaccard similarity instead of embedding cosine.
 *
 * AI-Council (codex + gemini, 2026-05-29) tuned the fallback so it neither
 * over-merges distinct bugs nor splits one bug across clusters:
 *  - the cluster key MUST include `file` + line proximity, NOT issue text
 *    alone (text Jaccard alone merges "missing null check" boilerplate);
 *  - normalize: lowercase, strip punctuation, mask numbers/string-literals,
 *    drop generic review filler words;
 *  - word 3-grams, with a token-set fallback for very short descriptions;
 *  - tiered thresholds by line distance; never cluster across files.
 *
 * The `SimilarityStrategy` seam lets a real embedding+cosine strategy drop in
 * once Phase 8 lands, without touching the clusterer.
 */

import type { ReviewIssue } from './types.js';

/** Generic review filler — carries no discriminating signal across findings. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'be',
  'this',
  'that',
  'it',
  'to',
  'of',
  'in',
  'on',
  'and',
  'or',
  'bug',
  'issue',
  'problem',
  'could',
  'may',
  'might',
  'should',
  'would',
  'missing',
  'incorrect',
  'potential',
  'possible',
  'here',
  'code',
  'line',
  'value',
]);

/** Normalize an issue's text for n-gram comparison. */
export function normalizeIssueText(issue: ReviewIssue): string {
  const raw = `${issue.description} ${issue.quotedSpan ?? ''}`.toLowerCase();
  return raw
    .replace(/`[^`]*`/g, ' ') // strip inline code fences
    .replace(/["'][^"']*["']/g, ' <str> ') // mask string literals
    .replace(/\b\d+(?:\.\d+)?\b/g, ' <num> ') // mask numbers
    .replace(/[^a-z0-9<>_ ]+/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Word n-grams; falls back to the token set when there are fewer than `n` tokens. */
export function ngrams(tokens: string[], n = 3): Set<string> {
  if (tokens.length < n) return new Set(tokens);
  const grams = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) grams.add(tokens.slice(i, i + n).join(' '));
  return grams;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface SimilarityStrategy {
  /** Continuous 0..1 similarity, used to pick a cluster's representative. */
  score(a: ReviewIssue, b: ReviewIssue): number;
  /** Whether two issues belong in the same cluster. */
  connected(a: ReviewIssue, b: ReviewIssue): boolean;
}

export interface NgramSimilarityOptions {
  /** Max new-file line distance to even consider clustering. */
  maxLineDistance?: number;
  /** Jaccard threshold when lines are very close (≤ nearLineDistance). */
  nearThreshold?: number;
  /** Jaccard threshold when lines are within maxLineDistance. */
  farThreshold?: number;
  nearLineDistance?: number;
  /** Threshold for the token-set fallback on short descriptions. */
  shortTextThreshold?: number;
}

/**
 * The n-gram Jaccard fallback strategy. Same-file + line-proximity gated, with
 * the council's tiered thresholds.
 */
export class NgramJaccardSimilarity implements SimilarityStrategy {
  private readonly cache = new Map<string, Set<string>>();
  private readonly opts: Required<NgramSimilarityOptions>;

  constructor(options: NgramSimilarityOptions = {}) {
    this.opts = {
      maxLineDistance: options.maxLineDistance ?? 5,
      nearThreshold: options.nearThreshold ?? 0.42,
      farThreshold: options.farThreshold ?? 0.55,
      nearLineDistance: options.nearLineDistance ?? 2,
      shortTextThreshold: options.shortTextThreshold ?? 0.65,
    };
  }

  private grams(issue: ReviewIssue): Set<string> {
    // Cache keyed by id+text hash so repeated comparisons are cheap (T-CR-302).
    const key = `${issue.id}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const grams = ngrams(tokenize(normalizeIssueText(issue)));
    this.cache.set(key, grams);
    return grams;
  }

  score(a: ReviewIssue, b: ReviewIssue): number {
    if (a.file !== b.file) return 0;
    return jaccard(this.grams(a), this.grams(b));
  }

  connected(a: ReviewIssue, b: ReviewIssue): boolean {
    if (a.file !== b.file) return false; // never cluster across files
    if (a.line === null || b.line === null) return false;
    const lineDist = Math.abs(a.line - b.line);
    if (lineDist > this.opts.maxLineDistance) return false;

    const ga = this.grams(a);
    const gb = this.grams(b);
    const sim = jaccard(ga, gb);

    // Very short descriptions: token-set Jaccard plus tight proximity.
    const isShort = ga.size < 3 || gb.size < 3;
    if (isShort) {
      return sim >= this.opts.shortTextThreshold && lineDist <= this.opts.nearLineDistance;
    }
    const threshold =
      lineDist <= this.opts.nearLineDistance ? this.opts.nearThreshold : this.opts.farThreshold;
    return sim >= threshold;
  }
}

export interface IssueCluster {
  members: ReviewIssue[];
  /** Distinct source runs that contributed — the vote count. */
  votes: number;
  representative: ReviewIssue;
}

/**
 * Cluster issues into connected components (DBSCAN-style, minSamples implicit
 * in the vote gate downstream). Votes = number of DISTINCT source runs in the
 * component, so one run producing two near-duplicates cannot inflate a vote.
 * The representative is the member with the highest mean similarity to its
 * siblings (T-CR-304 — the "consensus phrasing").
 */
export function clusterIssues(issues: ReviewIssue[], strategy: SimilarityStrategy): IssueCluster[] {
  const n = issues.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root] as number;
    let cur = x;
    while (parent[cur] !== root) {
      const next = parent[cur] as number;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (strategy.connected(issues[i] as ReviewIssue, issues[j] as ReviewIssue)) union(i, j);
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = components.get(root) ?? [];
    list.push(i);
    components.set(root, list);
  }

  const clusters: IssueCluster[] = [];
  for (const indices of components.values()) {
    const members = indices.map((i) => issues[i] as ReviewIssue);
    const runs = new Set(members.map((m) => m.sourceRun ?? -1));
    clusters.push({
      members,
      votes: runs.size,
      representative: pickRepresentative(members, strategy),
    });
  }
  return clusters;
}

/** Member with the highest mean similarity to its siblings. */
export function pickRepresentative(
  members: ReviewIssue[],
  strategy: SimilarityStrategy,
): ReviewIssue {
  if (members.length === 1) return members[0] as ReviewIssue;
  let best = members[0] as ReviewIssue;
  let bestMean = -1;
  for (const candidate of members) {
    let sum = 0;
    for (const other of members) {
      if (candidate === other) continue;
      sum += strategy.score(candidate, other);
    }
    const mean = sum / (members.length - 1);
    if (mean > bestMean) {
      bestMean = mean;
      best = candidate;
    }
  }
  return best;
}
