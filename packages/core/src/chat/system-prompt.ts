import { composeSystemPrompt } from '../guidelines/guidelines.js';

/**
 * Narrow loader the turn handlers depend on (AI council 2026-06-01, fork C2):
 * the handlers want "give me the current guidelines text", not the storage
 * abstraction. Keeping the dependency this thin makes the wiring trivial to
 * fake in a unit test (`async () => 'some guidelines'`).
 */
export type LoadGuidelines = () => Promise<string>;

/**
 * Narrow loader for the always-active RULES block (T-404, ADR-043). Same thin
 * shape as {@link LoadGuidelines} — "give me the current rules text" — so the
 * handler wiring stays trivial to fake in a unit test. The composition root
 * builds one via `createRulesLoader` (walk the agent-config tree once →
 * `buildSystemPrompt`); see `commands/rules-loader.ts`.
 */
export type LoadRules = () => Promise<string>;

const RULES_OPEN = '<workspace-rules>';
const RULES_CLOSE = '</workspace-rules>';

/**
 * Resolve the per-turn system prompt by folding the always-active workspace
 * RULES and the workspace GUIDELINES into an optional `base` prompt. Single
 * source of the compose + fail-open rule, shared by {@link ChatHandler} and
 * {@link AgentTurnHandler} so chat and agent turns get identical semantics
 * (council parity trap, 2026-06-02).
 *
 * - **Fail-open.** A guidelines OR a rules loader error degrades to "no
 *   guidelines / no rules" — neither read may break the model turn. Both
 *   loaders are wrapped here, so fail-open does not rely on a particular store
 *   returning `''` for a missing file.
 * - **Ordering (council 2026-06-02 Q5=A).** Rules lead, then guidelines, then
 *   `base` (the per-turn `<workspace-context>` block). Rules + guidelines are
 *   session-static → the leading prefix stays byte-identical across turns
 *   (Anthropic `cache_control`-friendly); the per-turn context trails.
 * - The rules block is wrapped in its own `<workspace-rules>` delimiter so the
 *   model distinguishes hard always-active rules from advisory guidelines.
 * - Returns `undefined` when none of rules / guidelines / `base` yield content,
 *   so callers OMIT the `system` key from the request rather than spreading
 *   `{ system: undefined }`.
 */
export async function resolveSystemPrompt(
  base: string | undefined,
  load: LoadGuidelines,
  loadRules?: LoadRules,
): Promise<string | undefined> {
  let guidelines = '';
  try {
    guidelines = await load();
  } catch {
    guidelines = '';
  }
  const withGuidelines = composeSystemPrompt(base, guidelines);

  if (!loadRules) return withGuidelines;
  let rules = '';
  try {
    rules = await loadRules();
  } catch {
    rules = '';
  }
  const trimmed = rules.trim();
  if (trimmed.length === 0) return withGuidelines;

  const block = `${RULES_OPEN}\n${trimmed}\n${RULES_CLOSE}`;
  const tail = withGuidelines?.trim();
  return tail && tail.length > 0 ? `${block}\n\n${tail}` : block;
}
