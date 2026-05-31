import { join } from 'node:path';
import { ChatHandler } from './chat/handler.js';
import { FileConversationStore, type ConversationStore } from './chat/store.js';
import { WorkspaceCoordinator } from './context/workspace-coordinator.js';
import { GitHandler } from './git/handler.js';
import { ProviderRegistry } from './llm/provider-registry.js';
import type { PricingBook } from './pricing/loader.js';
import { PLUGIN_STATE_DIR } from './sessions/locations.js';
import { Dispatcher } from './server.js';

/**
 * Composition root for the sidecar (T-PRD17 core wiring).
 *
 * Builds a {@link Dispatcher} wired with a real {@link ChatHandler} so the
 * shipped sidecar answers `chatSend` for any configured provider instead of
 * returning `chat_not_configured`. Extracted from `main.ts` (per AI-council
 * fork 5) so a unit test can construct the exact production wiring with a fake
 * env / registry / store and drive `chatSend` without spawning a process.
 *
 * All edge concerns — `process.env`, the filesystem store path, pricing — are
 * injectable (council trap: keep them outside the pure registry/handler seam).
 */
export interface BuildCoreOptions {
  /** Env for provider resolution; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Workspace root for conversation persistence; defaults to `process.cwd()`. */
  cwd?: string;
  /** Pricing book for real turn cost. Absent → the handler emits a `$0` estimate. */
  pricing?: PricingBook;
  /** Provider registry override (tests). Defaults to one built from `env`. */
  registry?: ProviderRegistry;
  /** Conversation store override (tests). Defaults to a {@link FileConversationStore} under `cwd`. */
  store?: ConversationStore;
}

export function buildCoreDispatcher(options: BuildCoreOptions = {}): Dispatcher {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const registry = options.registry ?? new ProviderRegistry({ env });
  const store = options.store ?? new FileConversationStore(join(cwd, PLUGIN_STATE_DIR, 'chats'));

  const chatHandler = new ChatHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    store,
    pricing: options.pricing,
  });

  // Git-loop handler — shares the registry; the diff/log are read from the
  // request's `cwd` (default: this composition root's `cwd`).
  const gitHandler = new GitHandler({
    resolveBackend: (providerId) => registry.resolveBackend(providerId),
    resolveModel: (providerId) => registry.resolveModel(providerId),
    defaultCwd: cwd,
  });

  return new Dispatcher(new WorkspaceCoordinator(), chatHandler, gitHandler);
}
