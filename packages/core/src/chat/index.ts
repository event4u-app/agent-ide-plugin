/**
 * Persisted chat history + forking + checkpoints — public core surface
 * (Phase 13, T-1301 / T-1302 / T-1303).
 *
 * The IDE wires a {@link ConversationStore} (file-backed in production,
 * in-memory in tests), renders {@link ConversationSummary} lists, opens a
 * {@link Conversation}, and offers the fork / rewind affordances. All
 * persistence, copy-on-write forking, checkpoint recording, search, and
 * rewind PLANNING live behind this barrel; the actual file-system restore on
 * a rewind stays IDE-gated (core has no file-write authority for it).
 */
export * from './types.js';
export {
  type ConversationStore,
  type ConversationStoreDeps,
  type CreateOptions,
  type AppendMessageInput,
  type RecordCheckpointInput,
  type ForkOptions,
  BaseConversationStore,
  InMemoryConversationStore,
  FileConversationStore,
} from './store.js';
export {
  type FoldOptions,
  DEFAULT_MAX_CHECKPOINTS,
  foldConversation,
  foldEvents,
  parseEvents,
  deriveTitle,
} from './fold.js';
export { type SearchOptions, searchConversations } from './search.js';
export { planRewind } from './rewind.js';
export { type LoadGuidelines, type LoadRules, resolveSystemPrompt } from './system-prompt.js';
