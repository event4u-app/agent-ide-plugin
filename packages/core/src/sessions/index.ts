/**
 * Unified Session Browser — public core surface (Phase 12).
 *
 * The IDE clients wire {@link createSessionBrowser} (or
 * {@link createSessionBrowserFromLocations}) plus a {@link SessionWatcher}, then
 * render the summaries; all parsing/aggregation lives behind this barrel.
 */
export * from './types.js';
export {
  type SessionLocations,
  type SessionLocationContext,
  defaultSessionLocations,
  PLUGIN_STATE_DIR,
} from './locations.js';
export {
  SessionBrowser,
  createSessionBrowser,
  createSessionBrowserFromLocations,
  filterSessions,
  markActiveSessions,
  groupSessionsByRecency,
  ACTIVE_WINDOW_MS,
  type SessionFilter,
  type SessionGroups,
} from './aggregator.js';
export { SessionProvenanceIndex } from './provenance.js';
export {
  type SessionWatcher,
  type SessionWatchEvent,
  type SessionWatchListener,
  type ChokidarWatcherOptions,
  ChokidarSessionWatcher,
  FakeSessionWatcher,
  resolveSource,
  watchTargets,
} from './watcher.js';
export { ApiSessionAdapter } from './adapters/api.js';
export { ClaudeCliAdapter } from './adapters/claude-cli.js';
export { CodexCliAdapter } from './adapters/codex-cli.js';
export { GeminiCliAdapter } from './adapters/gemini-cli.js';
export { AiderAdapter } from './adapters/aider.js';
