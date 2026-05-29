import type { ConfigNode } from '../config/agent-config-walker.js';

/**
 * T-402 — Slash-command picker.
 *
 * Pure-function fuzzy filter over the agent-config command index. The chat
 * UI renders the overlay; this layer only owns the matching + ranking, so
 * tests don't need a webview.
 *
 * Roadmap calls for "favourites" if Phase 0 Spike 0.5 demanded it. Phase 0
 * shipped without an explicit favourites verdict, so v0 returns
 * alphabetic-first ordering for unranked queries; favourites land in v1.0
 * Sprint 12 (per-CLI gear panel sweep) when the user-pin store gains a UI.
 */

export interface PickerItem {
  /** Command name without the leading slash, e.g. `commit`. */
  name: string;
  /** First non-empty line of frontmatter `description`. */
  description: string;
  /** Source path for click-through; the picker passes it as-is. */
  path: string;
}

export interface PickerResult extends PickerItem {
  /** Higher is better. 0 means a non-fuzzy alphabetic listing. */
  score: number;
}

/**
 * Convert a walker output into picker items. Commands without a description
 * fall back to the first markdown heading; if neither exists, an empty
 * description ships (the UI shows just the slash-name).
 */
export function commandsToPickerItems(nodes: readonly ConfigNode[]): PickerItem[] {
  return nodes
    .filter((n) => n.kind === 'command')
    .map((node) => {
      const fm = node.frontmatter as { description?: unknown; name?: unknown };
      const description =
        (typeof fm.description === 'string' && fm.description.trim().length > 0
          ? firstLine(fm.description)
          : firstHeading(node.body)) ?? '';
      const name = typeof fm.name === 'string' && fm.name.trim().length > 0 ? fm.name : node.name;
      return { name, description, path: node.absPath };
    });
}

/**
 * Filter + rank items against a (possibly empty) query string. Empty query
 * returns the full list alphabetically. Non-empty query uses a subsequence
 * score: every character of the query must appear in order; consecutive
 * matches boost the score; a starts-with match boosts further; case is
 * ignored.
 */
export function pickCommands(items: readonly PickerItem[], query: string): PickerResult[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ ...item, score: 0 }));
  }
  const scored: PickerResult[] = [];
  for (const item of items) {
    const score = fuzzyScore(item.name.toLowerCase(), q);
    if (score > 0) scored.push({ ...item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored;
}

function fuzzyScore(target: string, query: string): number {
  if (query.length === 0) return 1;
  let ti = 0;
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  while (ti < target.length && qi < query.length) {
    if (target[ti] === query[qi]) {
      score += 2 + consecutive;
      consecutive += 2;
      qi += 1;
    } else {
      consecutive = 0;
    }
    ti += 1;
  }
  if (qi < query.length) return 0;
  // Prefix bonus.
  if (target.startsWith(query)) score += 10;
  return score;
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function firstHeading(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').trim();
    }
  }
  return undefined;
}
