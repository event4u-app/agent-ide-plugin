import { join } from 'node:path';

/**
 * Resolved, absolute session-file locations (T-1202).
 *
 * Every path is absolute with `~` already expanded — adapters never touch
 * `os.homedir()` directly. Production wires {@link defaultSessionLocations};
 * unit tests pass temp-dir paths (the project's established test convention —
 * see `memory/local.test.ts` — real `mkdtemp` dirs over a mock fs).
 *
 * Any field may be omitted; an adapter whose location is absent records a
 * `location_missing` diagnostic and yields no summaries (fail-open).
 */
export interface SessionLocations {
  /** Plugin's own chats: `<workspace>/.event4u-agent/chats`. */
  apiChatsDir?: string;
  /** Plugin session-provenance index: `<workspace>/.event4u-agent/session-index.json`. */
  pluginIndexFile?: string;
  /** Claude Code projects root: `~/.claude/projects`. */
  claudeProjectsDir?: string;
  /** Codex sessions root: `~/.codex/sessions`. */
  codexSessionsDir?: string;
  /** Gemini sessions root: `~/.gemini/sessions`. */
  geminiSessionsDir?: string;
  /** Aider chat history for the current workspace: `<cwd>/.aider.chat.history.md`. */
  aiderHistoryFile?: string;
}

/** Inputs needed to derive the default locations. */
export interface SessionLocationContext {
  /** Absolute home directory (usually `os.homedir()`). */
  homeDir: string;
  /** Absolute workspace/cwd root the plugin is hosting. */
  workspaceDir: string;
}

/** Sub-directory the plugin keeps its per-workspace state under. */
export const PLUGIN_STATE_DIR = '.event4u-agent';

/**
 * Build the canonical locations from a home dir + workspace dir.
 *
 * Locations are kept conservative and documented rather than clever (council:
 * "cut recursive cleverness around Claude cwd hashes"). The adapters walk these
 * roots defensively for the actual session files.
 */
export function defaultSessionLocations(ctx: SessionLocationContext): SessionLocations {
  const { homeDir, workspaceDir } = ctx;
  return {
    apiChatsDir: join(workspaceDir, PLUGIN_STATE_DIR, 'chats'),
    pluginIndexFile: join(workspaceDir, PLUGIN_STATE_DIR, 'session-index.json'),
    claudeProjectsDir: join(homeDir, '.claude', 'projects'),
    codexSessionsDir: join(homeDir, '.codex', 'sessions'),
    geminiSessionsDir: join(homeDir, '.gemini', 'sessions'),
    aiderHistoryFile: join(workspaceDir, '.aider.chat.history.md'),
  };
}
