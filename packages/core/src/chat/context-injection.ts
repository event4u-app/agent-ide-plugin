import type { ContextSnippetAnnotation } from '@event4u-agent/protocol';

/**
 * T-MR13 — fold retrieved context snippets into a bounded system-prompt block.
 *
 * AI council 2026-06-01 (UNANIMOUS A1/B1/C1/D1/E1/F1) flagged two traps this
 * helper resolves:
 *  - The total injected block must be capped INDEPENDENTLY of the per-snippet
 *    preview bound (each preview is already ≤8 lines/400 chars, but a large `k`
 *    could still bloat the system prompt past the 16KB guidelines ceiling).
 *  - The returned `used` set must be EXACTLY the snippets that made it into the
 *    block, so the wire annotations reflect precisely what the model saw — not a
 *    superset that includes snippets dropped by the budget.
 *
 * Pure + engine-free so the bounding rule is unit-testable on its own.
 */

export interface ContextInjection {
  /**
   * The `<workspace-context>` block to pass as the `base` of
   * `resolveSystemPrompt` (guidelines still prepend ahead of it), or `undefined`
   * when there is nothing to inject.
   */
  system: string | undefined;
  /** The snippets actually rendered into `system` — EXACTLY what the model saw. */
  used: ContextSnippetAnnotation[];
}

export interface BuildContextInjectionOptions {
  /**
   * Character budget for the rendered snippet bodies (the sum of the per-snippet
   * blocks, excluding the wrapping tags). Default 8000 — comfortably under the
   * 16KB guidelines cap so guidelines + context coexist.
   */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 8000;

/**
 * Build the bounded context block from the (relevance-ordered) snippets. The
 * first snippet is always included so a single oversized snippet still gives the
 * model something; subsequent snippets are added only while the budget holds.
 * Returns `{ system: undefined, used: [] }` when there is nothing to inject.
 */
export function buildContextInjection(
  snippets: readonly ContextSnippetAnnotation[],
  options: BuildContextInjectionOptions = {},
): ContextInjection {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (snippets.length === 0 || maxChars <= 0) return { system: undefined, used: [] };

  const used: ContextSnippetAnnotation[] = [];
  const rendered: string[] = [];
  let total = 0;
  for (const snippet of snippets) {
    const block = renderSnippet(snippet);
    // Never add a SUBSEQUENT snippet that overflows the budget; always keep the
    // first so the block is never empty when snippets exist.
    if (used.length > 0 && total + block.length > maxChars) break;
    used.push(snippet);
    rendered.push(block);
    total += block.length;
    if (total >= maxChars) break;
  }

  return { system: `<workspace-context>\n${rendered.join('\n\n')}\n</workspace-context>`, used };
}

/** Render one snippet as a path-tagged code excerpt the model can cite back. */
function renderSnippet(snippet: ContextSnippetAnnotation): string {
  return `// ${snippet.filePath}:${snippet.startLine}-${snippet.endLine}\n${snippet.preview}`;
}
