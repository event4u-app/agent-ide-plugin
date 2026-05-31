import { z } from 'zod';

/**
 * Phase 13 — Persisted chat history + forking + checkpoints, core types
 * (T-1301 / T-1302 / T-1303).
 *
 * One conversation is an **append-only JSONL event log** under
 * `<workspace>/.event4u-agent/chats/<id>.jsonl`. The format mirrors the
 * established `tracking/db.ts` append-only precedent (no-native-deps law: no
 * sqlite, no FTS): each line is one zod-validated {@link ConversationEvent},
 * and reads fold the events into a {@link Conversation}. A malformed trailing
 * line never corrupts the read — the fold tolerates and skips it (fail-open).
 *
 * Design ratified by AI council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-31,
 * UNANIMOUS): append-only event log over a single rewritten JSON document;
 * fork is **copy-on-write** (new id + `parentId` + `forkedFromTurnIndex`),
 * never an in-file branch tree; checkpoints are **metadata + a rewind plan**,
 * never an in-core file mutation — the IDE owns the actual file restore.
 *
 * Everything here is pure core: persist / list / load / fork / search / record
 * checkpoint / plan a rewind. The sidebar list, the fork affordance, the
 * "rewind" button, and the file-system restore stay IDE-gated.
 */

export const CHAT_SCHEMA_VERSION = 1;

/** Roles a stored turn can carry — mirrors the protocol `RoleSchema`. */
export const ConversationRoleSchema = z.enum(['user', 'assistant', 'system']);
export type ConversationRole = z.infer<typeof ConversationRoleSchema>;

/** Fields every event line carries. */
const baseEventFields = {
  /** Schema version, for forward-compatible reads. */
  v: z.literal(CHAT_SCHEMA_VERSION).default(CHAT_SCHEMA_VERSION),
  /** ISO-8601 UTC stamp. */
  at: z.string(),
};

/** First line of every log — establishes identity and (for forks) lineage. */
export const CreatedEventSchema = z
  .object({
    type: z.literal('created'),
    ...baseEventFields,
    id: z.string().min(1),
    title: z.string().optional(),
    /** Set only on forks: the conversation this one branched from. */
    parentId: z.string().min(1).optional(),
    /** Set only on forks: the turn index in the parent the branch starts at. */
    forkedFromTurnIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

/** One appended chat turn. */
export const MessageEventSchema = z
  .object({
    type: z.literal('message'),
    ...baseEventFields,
    /** Stable message id — survives filtering/system-message changes. */
    id: z.string().min(1),
    role: ConversationRoleSchema,
    content: z.string(),
  })
  .strict();

/**
 * A checkpoint recorded at a phase boundary. Carries **metadata only** — the
 * list of files the run changed and an opaque agent-loop state snapshot — so
 * the IDE can plan a restore. Core never stores file blobs in this slice
 * (blob bloat is a named risk); a future {@link SnapshotStore} seam can.
 */
export const CheckpointEventSchema = z
  .object({
    type: z.literal('checkpoint'),
    ...baseEventFields,
    id: z.string().min(1),
    label: z.string().optional(),
    /** Agent-loop phase that raised the checkpoint (e.g. `implement`). */
    phase: z.string().optional(),
    /** Number of messages that existed when the checkpoint was taken. */
    turnIndex: z.number().int().nonnegative(),
    /** Files the run had changed up to this checkpoint. */
    changedFiles: z.array(z.string()).default([]),
    /** Opaque agent-loop state (e.g. a `WorkState`) — passed through verbatim. */
    workState: z.unknown().optional(),
  })
  .strict();

/** Mutates conversation-level metadata (currently just the title). */
export const MetaEventSchema = z
  .object({
    type: z.literal('meta'),
    ...baseEventFields,
    title: z.string().optional(),
  })
  .strict();

export const ConversationEventSchema = z.discriminatedUnion('type', [
  CreatedEventSchema,
  MessageEventSchema,
  CheckpointEventSchema,
  MetaEventSchema,
]);
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;
export type CreatedEvent = z.infer<typeof CreatedEventSchema>;
export type MessageEvent = z.infer<typeof MessageEventSchema>;
export type CheckpointEvent = z.infer<typeof CheckpointEventSchema>;

/** A folded chat turn. `turnIndex` is its position in {@link Conversation.messages}. */
export interface StoredMessage {
  id: string;
  role: ConversationRole;
  content: string;
  at: string;
  turnIndex: number;
}

/** A folded checkpoint. */
export interface Checkpoint {
  id: string;
  label?: string;
  phase?: string;
  turnIndex: number;
  changedFiles: string[];
  workState?: unknown;
  at: string;
}

/** A conversation, folded from its event log. */
export interface Conversation {
  id: string;
  title: string;
  parentId?: string;
  forkedFromTurnIndex?: number;
  messages: StoredMessage[];
  checkpoints: Checkpoint[];
  createdAt: string;
  updatedAt: string;
}

/** Cheap listing shape — derived from a fold, no bodies retained. */
export interface ConversationSummary {
  id: string;
  title: string;
  parentId?: string;
  messageCount: number;
  checkpointCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One search hit, ranked by recency then hit count. */
export interface ConversationSearchResult {
  summary: ConversationSummary;
  /** Number of messages (plus title) that matched all query tokens. */
  hitCount: number;
  /** A short excerpt around the first body match, for the sidebar. */
  snippet?: string;
}

/**
 * The output of {@link planRewind} — a description of what a rewind WOULD do.
 * Core never mutates the world; the IDE consumes this plan to restore the
 * conversation view and (using its own VCS/undo authority) the files.
 */
export interface RewindPlan {
  conversationId: string;
  checkpointId: string;
  /** Messages to keep (indices `0 .. turnIndex - 1`). */
  targetTurnIndex: number;
  messagesToKeep: StoredMessage[];
  messagesToDrop: StoredMessage[];
  /** Files the IDE should consider restoring to their checkpoint state. */
  changedFiles: string[];
  /** Opaque agent-loop state captured at the checkpoint, if any. */
  workState?: unknown;
  /** Soft problems (e.g. no file manifest) — never thrown, surfaced here. */
  warnings: string[];
}
