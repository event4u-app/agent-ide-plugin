import type { LoadRules } from '../chat/system-prompt.js';
import { walkAgentConfig } from '../config/agent-config-walker.js';
import { buildSystemPrompt } from './system-prompt.js';

/**
 * Char budget for the always-active rules block. Mirrors the 16KB guidelines
 * cap (`MAX_GUIDELINES_BYTES`) so rules + guidelines coexist comfortably under
 * a model's system-prompt budget; `buildSystemPrompt` drops over-budget rules
 * off the tail (AI council 2026-06-02 Q3=A).
 */
export const DEFAULT_RULES_MAX_CHARS = 16 * 1024;

export interface RulesLoaderOptions {
  /** Hard char ceiling for the rules block. Default {@link DEFAULT_RULES_MAX_CHARS}. */
  maxChars?: number;
}

/**
 * Build a {@link LoadRules} that wires the dead T-404 seam (`walkAgentConfig` +
 * `buildSystemPrompt`, both shipped + unit-tested but never called on the live
 * path) into the live system prompt — the direct sibling of the guidelines
 * wiring (ADR-024). Without it, the agent's always-active rules never reach the
 * model.
 *
 * The agent-config tree (`.event4u-agent/` → `.augment/` → `.agent-src/` under
 * `projectRoot`) is walked ONCE and the rendered rules string is cached for the
 * session: rules are session-static, so the leading system-prompt prefix stays
 * byte-identical across turns (cache-friendly; AI council 2026-06-02 Q2=A).
 *
 * Fail-open (Q4=A): a successful walk — even one that finds NO always-active
 * rules (→ `''`) — is cached; a walk *error* degrades to `''` WITHOUT caching,
 * so a transient FS race retries on the next turn rather than disabling rules
 * for the whole session.
 */
export function createRulesLoader(projectRoot: string, opts: RulesLoaderOptions = {}): LoadRules {
  const maxChars = opts.maxChars ?? DEFAULT_RULES_MAX_CHARS;
  let cached: string | undefined;
  return async () => {
    if (cached !== undefined) return cached;
    try {
      const nodes = await walkAgentConfig(projectRoot);
      cached = buildSystemPrompt(nodes, { maxChars }).text;
      return cached;
    } catch {
      return '';
    }
  };
}
