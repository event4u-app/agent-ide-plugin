import { composeSystemPrompt } from '../guidelines/guidelines.js';

/**
 * Narrow loader the turn handlers depend on (AI council 2026-06-01, fork C2):
 * the handlers want "give me the current guidelines text", not the storage
 * abstraction. Keeping the dependency this thin makes the wiring trivial to
 * fake in a unit test (`async () => 'some guidelines'`).
 */
export type LoadGuidelines = () => Promise<string>;

/**
 * Resolve the per-turn system prompt by folding workspace guidelines into an
 * optional `base` prompt. Single source of the compose + fail-open rule (fork
 * A2), shared by {@link ChatHandler} and {@link AgentTurnHandler} so chat and
 * agent turns get identical guidelines semantics.
 *
 * - **Fail-open (fork F1).** A loader error degrades to `base` — a guidelines
 *   read must never break the model turn. The injected loader is wrapped here,
 *   so fail-open does not rely on a particular store returning `''` for a
 *   missing file.
 * - **Ordering (fork E1).** Guidelines are prepended ahead of `base` via the
 *   already-shipped {@link composeSystemPrompt} contract (workspace context is
 *   the leading constraint).
 * - Returns `undefined` when neither `base` nor the guidelines yield content,
 *   so callers OMIT the `system` key from the request rather than spreading
 *   `{ system: undefined }`.
 */
export async function resolveSystemPrompt(
  base: string | undefined,
  load: LoadGuidelines,
): Promise<string | undefined> {
  let guidelines = '';
  try {
    guidelines = await load();
  } catch {
    guidelines = '';
  }
  return composeSystemPrompt(base, guidelines);
}
