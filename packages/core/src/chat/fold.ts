import {
  type Checkpoint,
  type Conversation,
  type ConversationEvent,
  ConversationEventSchema,
  type StoredMessage,
} from './types.js';

/** Default cap on how many (most-recent) checkpoints a fold retains. */
export const DEFAULT_MAX_CHECKPOINTS = 50;

export interface FoldOptions {
  /**
   * Keep at most this many checkpoints (most-recent wins). The log stays
   * append-only on disk — this only bounds what a read materializes, so a
   * long run cannot blow up memory or the rewind picker (council risk #2).
   */
  maxCheckpoints?: number;
}

/**
 * Fold an append-only event log into a {@link Conversation}.
 *
 * Tolerant by construction (council risk #3 — JSONL partial-write corruption):
 * blank lines, non-JSON lines, and schema-invalid records are skipped, never
 * thrown. A log with no valid `created` event yields `undefined` (the caller
 * treats that as "not a conversation").
 */
export function foldConversation(lines: string[], options?: FoldOptions): Conversation | undefined {
  const events = parseEvents(lines);
  return foldEvents(events, options);
}

/** Parse raw JSONL lines into valid events, dropping anything malformed. */
export function parseEvents(lines: string[]): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue; // tolerate a torn trailing line
    }
    const parsed = ConversationEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/** Fold already-parsed events. Exposed so an in-memory store can reuse it. */
export function foldEvents(
  events: ConversationEvent[],
  options?: FoldOptions,
): Conversation | undefined {
  const created = events.find((e) => e.type === 'created');
  if (!created) return undefined;

  const messages: StoredMessage[] = [];
  const checkpoints: Checkpoint[] = [];
  let title = created.title ?? '';
  let updatedAt = created.at;

  for (const event of events) {
    if (event.at > updatedAt) updatedAt = event.at;
    switch (event.type) {
      case 'message': {
        messages.push({
          id: event.id,
          role: event.role,
          content: event.content,
          at: event.at,
          turnIndex: messages.length,
        });
        // First user turn seeds the title when none was set explicitly.
        if (!title && event.role === 'user') title = deriveTitle(event.content);
        break;
      }
      case 'checkpoint': {
        checkpoints.push({
          id: event.id,
          label: event.label,
          phase: event.phase,
          turnIndex: event.turnIndex,
          changedFiles: event.changedFiles,
          workState: event.workState,
          at: event.at,
        });
        break;
      }
      case 'meta': {
        if (event.title !== undefined) title = event.title;
        break;
      }
      case 'created':
        break;
    }
  }

  const max = options?.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
  // `slice(-max)` is wrong for max === 0 (`-0` → whole array); index from the end explicitly.
  const keptCheckpoints =
    max >= 0 && checkpoints.length > max
      ? checkpoints.slice(checkpoints.length - max)
      : checkpoints;

  return {
    id: created.id,
    title: title || 'Untitled conversation',
    parentId: created.parentId,
    forkedFromTurnIndex: created.forkedFromTurnIndex,
    messages,
    checkpoints: keptCheckpoints,
    createdAt: created.at,
    updatedAt,
  };
}

/** First line of a message, clamped — the auto-title for a conversation. */
export function deriveTitle(content: string): string {
  const firstLine =
    content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  const clamped = firstLine.slice(0, 80);
  return firstLine.length > 80 ? `${clamped.trimEnd()}…` : clamped;
}
