import type { ContextSnippetAnnotation, SnippetCategory } from '@event4u-agent/protocol';

import type { ChunkRef, FusedResult } from './hybrid.js';
import type { Snippet } from './snippet.js';

/**
 * T-1308 — context-snippet annotation builder (pure-core seam).
 *
 * Maps RRF-scored chunk refs (from {@link ContextEngine.hybridRetrieveScored})
 * into the `context-snippet` wire annotations a future IDE Context Side Bar
 * renders. AI council (codex-cli + gemini-cli, 2026-06-01): pure free function
 * over already-retrieved scored refs + an injected per-ref snippet resolver
 * (F2) — the engine keeps the retrieval state, this stays trivially unit
 * testable. The render half (badge opacity/colour/hover/search/click) is
 * IDE-deferred.
 *
 * Determinism contract: output preserves the scored-input order 1:1 (the
 * resolver expands ONE ref at a time — no cross-ref merge that would collapse
 * two scores into one snippet). `relevance` is min-max normalized over the set
 * (single / all-equal → `1`). Refs whose content the resolver cannot find are
 * dropped (a file may have been removed since indexing).
 */

/** Default preview bounds — keep the wire payload predictable per snippet. */
export const PREVIEW_MAX_LINES = 8;
export const PREVIEW_MAX_CHARS = 400;

export interface BuildContextSnippetsOptions {
  /** Max lines kept in the preview slice (default {@link PREVIEW_MAX_LINES}). */
  previewMaxLines?: number;
  /** Hard char cap on the preview slice (default {@link PREVIEW_MAX_CHARS}). */
  previewMaxChars?: number;
}

/**
 * Classify a file path into the coarse {@link SnippetCategory} that drives the
 * badge colour. Deterministic, case-insensitive, path-separator agnostic.
 * Order matters: dependency and test win over a generic source classification.
 * Classification is on the path's OWN segments only (never an absolute root
 * prefix), so a snippet under a workspace root that happens to live in
 * `/Users/x/node_modules/...` checkout is judged on its repo-relative shape.
 */
export function classifySnippet(filePath: string): SnippetCategory {
  const p = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = p.split('/').filter(Boolean);
  const base = segments[segments.length - 1] ?? '';

  if (segments.includes('node_modules') || segments.includes('vendor')) return 'dependency';
  if (
    segments.includes('test') ||
    segments.includes('tests') ||
    segments.includes('__tests__') ||
    /\.(test|spec)\./.test(base)
  ) {
    return 'test';
  }
  if (segments.includes('docs') || base.endsWith('.md') || base.endsWith('.mdx')) return 'docs';
  return 'source';
}

/**
 * Min-max normalize a list of raw scores into 0..1 `relevance`, index-aligned.
 * Single result or an all-equal set → every entry is `1` (no divide-by-zero,
 * and "nothing stands out" reads as fully relevant rather than fully faded).
 */
function normalizeRelevance(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = scores[0]!;
  let max = scores[0]!;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  const span = max - min;
  if (span === 0) return scores.map(() => 1);
  return scores.map((s) => (s - min) / span);
}

/** Bound a snippet's text to `maxLines` then `maxChars`, trimming a torn tail. */
function boundPreview(text: string, maxLines: number, maxChars: number): string {
  const byLines = text.split('\n').slice(0, maxLines).join('\n');
  return byLines.length > maxChars ? byLines.slice(0, maxChars) : byLines;
}

/**
 * Build the context-snippet annotations for one turn. `resolveSnippet` expands
 * exactly one ref (±context) — pass a closure over the engine's content map.
 */
export function buildContextSnippets(
  scored: readonly FusedResult<ChunkRef>[],
  resolveSnippet: (ref: ChunkRef) => Snippet | undefined,
  options: BuildContextSnippetsOptions = {},
): ContextSnippetAnnotation[] {
  const maxLines = options.previewMaxLines ?? PREVIEW_MAX_LINES;
  const maxChars = options.previewMaxChars ?? PREVIEW_MAX_CHARS;

  const resolved: { ref: ChunkRef; snippet: Snippet; score: number }[] = [];
  for (const { item, score } of scored) {
    const snippet = resolveSnippet(item);
    if (snippet === undefined) continue;
    resolved.push({ ref: item, snippet, score });
  }

  const relevance = normalizeRelevance(resolved.map((r) => r.score));

  return resolved.map(({ ref, snippet }, i) => ({
    kind: 'context-snippet' as const,
    rootId: ref.rootId,
    filePath: ref.filePath,
    startLine: ref.startLine,
    endLine: ref.endLine,
    relevance: relevance[i]!,
    category: classifySnippet(ref.filePath),
    preview: boundPreview(snippet.getText(), maxLines, maxChars),
  }));
}
