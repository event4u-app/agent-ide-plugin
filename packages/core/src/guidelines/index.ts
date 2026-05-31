/**
 * Workspace Guidelines — public core surface (Phase 13, T-1307).
 *
 * The IDE renders the editor for `.event4u-agent/guidelines.md`; this module
 * owns load/save and {@link composeSystemPrompt}, which prepends the (size-
 * capped, fail-open) guidelines block to the agent's system prompt.
 */
export {
  GUIDELINES_FILE,
  MAX_GUIDELINES_BYTES,
  type GuidelinesStore,
  InMemoryGuidelinesStore,
  FileGuidelinesStore,
  composeSystemPrompt,
} from './guidelines.js';
