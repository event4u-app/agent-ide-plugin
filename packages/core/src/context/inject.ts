import type { ChatMessage, LlmRequest } from '@event4u-agent/protocol';
import type { Snippet } from './snippet.js';

/**
 * T-605 / T-606 — Context-block injection.
 *
 * Builds a `[Context: …]` block from retrieved snippets and inserts it into the
 * **user** message — never the system prompt. That placement is the
 * cache-friendly contract (T-606): the static rule/system prefix keeps its
 * `cache_control` and stays byte-identical across turns, while the per-turn
 * context block rides in the user turn where cache misses are expected anyway.
 *
 * The block is trimmed to a token budget (default 20% of the model context
 * window — Sonnet 200k → 40k), estimated at ~4 chars/token.
 */

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_BUDGET_RATIO = 0.2;
const CHARS_PER_TOKEN = 4;

export interface ContextBlockOptions {
  contextWindow?: number;
  budgetRatio?: number;
}

/** Render snippets into a fenced context block, trimmed to the token budget. */
export function buildContextBlock(snippets: Snippet[], opts: ContextBlockOptions = {}): string {
  if (snippets.length === 0) return '';
  const window = opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const ratio = opts.budgetRatio ?? DEFAULT_BUDGET_RATIO;
  const charBudget = Math.floor(window * ratio * CHARS_PER_TOKEN);

  const rendered: string[] = [];
  let used = 0;
  let included = 0;
  for (const snippet of snippets) {
    const body = `// ${snippet.denotation}\n${snippet.getText()}`;
    const fenced = `\`\`\`\n${body}\n\`\`\``;
    if (used + fenced.length > charBudget && included > 0) break;
    rendered.push(fenced);
    used += fenced.length;
    included++;
  }
  if (rendered.length === 0) return '';
  const header = `[Context: ${rendered.length} snippet${rendered.length === 1 ? '' : 's'} from codebase]`;
  return `${header}\n${rendered.join('\n')}`;
}

/**
 * Insert the context block into the last user message of a request. The system
 * prompt and any prior turns are left untouched (cache-friendly, T-606).
 * Returns a new request; the input is not mutated.
 */
export function injectContext(request: LlmRequest, block: string): LlmRequest {
  if (!block) return request;
  const messages = request.messages.map((m) => ({ ...m }));
  const lastUserIndex = findLastUserIndex(messages);
  if (lastUserIndex === -1) {
    return { ...request, messages: [...messages, { role: 'user', content: block }] };
  }
  const target = messages[lastUserIndex] as ChatMessage;
  messages[lastUserIndex] = { ...target, content: prependBlock(target.content, block) };
  return { ...request, messages };
}

function findLastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

function prependBlock(content: ChatMessage['content'], block: string): ChatMessage['content'] {
  if (typeof content === 'string') return `${block}\n\n${content}`;
  return [{ type: 'text', text: `${block}\n\n` }, ...content];
}
