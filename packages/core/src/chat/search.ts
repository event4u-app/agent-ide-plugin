import type { Conversation, ConversationSearchResult, ConversationSummary } from './types.js';

/**
 * Pure, dependency-light search across conversations (T-1301 "search across
 * history"). No native FTS, no index lifecycle — a case-insensitive token-AND
 * scan over the title + message bodies, ranked by recency then hit count.
 *
 * The council split here (codex: substring/token scan is enough; gemini: reuse
 * BM25) resolved to the simpler scan for the first slice: it is deterministic,
 * self-contained, and trivially unit-testable. `minisearch` (already in the
 * dependency graph) is the documented enhancement path if ranking quality
 * ever matters more than simplicity.
 */
export interface SearchOptions {
  /** Cap the number of results (most-recent-updated first). */
  limit?: number;
}

export function searchConversations(
  conversations: Conversation[],
  query: string,
  options?: SearchOptions,
): ConversationSearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results: ConversationSearchResult[] = [];
  for (const conversation of conversations) {
    const result = scoreConversation(conversation, tokens);
    if (result) results.push(result);
  }

  results.sort((a, b) => {
    const recency = b.summary.updatedAt.localeCompare(a.summary.updatedAt);
    return recency !== 0 ? recency : b.hitCount - a.hitCount;
  });

  return options?.limit != null ? results.slice(0, options.limit) : results;
}

function scoreConversation(
  conversation: Conversation,
  tokens: string[],
): ConversationSearchResult | undefined {
  const haystacks = [conversation.title, ...conversation.messages.map((m) => m.content)];
  const lowered = haystacks.map((h) => h.toLowerCase());

  // Token-AND: every query token must appear somewhere in the conversation.
  const everyTokenPresent = tokens.every((t) => lowered.some((h) => h.includes(t)));
  if (!everyTokenPresent) return undefined;

  let hitCount = 0;
  let snippet: string | undefined;
  for (let i = 0; i < haystacks.length; i++) {
    if (tokens.every((t) => lowered[i]!.includes(t))) {
      hitCount++;
      // First body match (skip index 0 = title) seeds the snippet.
      if (snippet === undefined && i > 0) snippet = excerpt(haystacks[i]!, tokens[0]!);
    }
  }

  return { summary: toSummary(conversation), hitCount, snippet };
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    parentId: conversation.parentId,
    messageCount: conversation.messages.length,
    checkpointCount: conversation.checkpoints.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** A ~80-char window around the first occurrence of `token`. */
function excerpt(text: string, token: string): string {
  const idx = text.toLowerCase().indexOf(token);
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + token.length + 50);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
