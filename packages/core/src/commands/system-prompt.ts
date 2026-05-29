import type { ConfigNode } from '../config/agent-config-walker.js';

/**
 * T-404 — Rules-as-always-active prepend.
 *
 * Takes the walker's flat index and produces a single system-prompt string
 * by concatenating every "always-active" rule body. Filter strategy stays
 * minimal in v0: a rule is always-active iff its frontmatter's `trigger`
 * field is `"always"` (or absent — the conservative default). Auto-loaded
 * rules with explicit `"auto"` triggers are emitted on demand by T-401's
 * consumer, not here.
 *
 * Council finding #4 (Phase 0 Spike 0.4): when total injected text exceeds
 * the cost budget the IDE picked, callers pass `maxChars` to cap the bundle.
 * Over-budget rules drop off the tail.
 */

export interface SystemPromptOptions {
  /** Static prelude — usually the agent's persona ("You are…"). */
  prelude?: string;
  /** Hard char ceiling for the rules block (excluding prelude). */
  maxChars?: number;
}

export interface SystemPromptResult {
  text: string;
  /** Names of rules that fit under maxChars. */
  included: string[];
  /** Names of rules dropped because of the budget. */
  dropped: string[];
}

const TRIGGER_KEY = 'trigger';
const ALWAYS_VALUE = 'always';

export function buildSystemPrompt(
  nodes: readonly ConfigNode[],
  opts: SystemPromptOptions = {},
): SystemPromptResult {
  const rules = nodes.filter((n) => n.kind === 'rule' && isAlwaysActive(n));
  rules.sort((a, b) => a.name.localeCompare(b.name));

  const sections: string[] = [];
  const included: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  const limit = opts.maxChars ?? Number.POSITIVE_INFINITY;

  for (const rule of rules) {
    const block = `## Rule: ${rule.name}\n\n${rule.body.trim()}\n`;
    if (used + block.length > limit) {
      dropped.push(rule.name);
      continue;
    }
    sections.push(block);
    included.push(rule.name);
    used += block.length;
  }

  const body = sections.join('\n');
  const text = opts.prelude ? `${opts.prelude.trim()}\n\n${body}`.trimEnd() : body.trimEnd();
  return { text, included, dropped };
}

function isAlwaysActive(node: ConfigNode): boolean {
  const trigger = node.frontmatter[TRIGGER_KEY];
  if (typeof trigger !== 'string') return true; // conservative default
  return trigger === ALWAYS_VALUE;
}
