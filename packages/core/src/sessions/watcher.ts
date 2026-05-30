import chokidar, { type FSWatcher } from 'chokidar';
import type { SessionLocations } from './locations.js';
import type { SessionSource } from './types.js';

/**
 * Session watcher (T-1204 core).
 *
 * Emits **invalidations**, not parsed summaries — a watch event tells the caller
 * "re-scan this source", and the caller decides whether to re-list (council:
 * watcher events are invalidations, keep parsing out of the hot path). The
 * interface is injectable so tests drive {@link FakeSessionWatcher} deterministically
 * instead of waiting on real filesystem events.
 *
 * "Active now" detection is intentionally NOT done here by tailing files; it is a
 * cheap recency check over `lastMessageAt` in {@link markActiveSessions}. The
 * watcher only signals that *something changed*.
 */
export interface SessionWatchEvent {
  kind: 'created' | 'changed' | 'deleted';
  path: string;
  /** Resolved from which configured location the path falls under, when known. */
  source?: SessionSource;
}

export type SessionWatchListener = (event: SessionWatchEvent) => void;

export interface SessionWatcher {
  /** Begin watching; `onEvent` fires per (debounced) change. Idempotent-safe to call once. */
  start(onEvent: SessionWatchListener): Promise<void>;
  /** Stop watching and release resources. */
  close(): Promise<void>;
}

/** Map a changed path back to its source by matching the configured location roots. */
export function resolveSource(
  path: string,
  locations: SessionLocations,
): SessionSource | undefined {
  const normalized = normalize(path);
  if (locations.aiderHistoryFile && normalized === normalize(locations.aiderHistoryFile))
    return 'aider';
  const roots: [string | undefined, SessionSource][] = [
    [locations.apiChatsDir, 'api'],
    [locations.claudeProjectsDir, 'claude-cli'],
    [locations.codexSessionsDir, 'codex-cli'],
    [locations.geminiSessionsDir, 'gemini-cli'],
  ];
  for (const [root, source] of roots) {
    if (root && normalized.startsWith(`${normalize(root)}/`)) return source;
  }
  return undefined;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Every configured watch target (dirs + the aider file), skipping unset locations. */
export function watchTargets(locations: SessionLocations): string[] {
  return [
    locations.apiChatsDir,
    locations.claudeProjectsDir,
    locations.codexSessionsDir,
    locations.geminiSessionsDir,
    locations.aiderHistoryFile,
  ].filter((t): t is string => typeof t === 'string' && t.length > 0);
}

export interface ChokidarWatcherOptions {
  /** Coalesce bursts of events per path (default 250ms). */
  debounceMs?: number;
}

/** chokidar-backed watcher over the configured session locations. */
export class ChokidarSessionWatcher implements SessionWatcher {
  private watcher: FSWatcher | undefined;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly locations: SessionLocations,
    private readonly options: ChokidarWatcherOptions = {},
  ) {}

  async start(onEvent: SessionWatchListener): Promise<void> {
    if (this.watcher) return;
    const targets = watchTargets(this.locations);
    if (targets.length === 0) return;

    const debounceMs = this.options.debounceMs ?? 250;
    const watcher = chokidar.watch(targets, { ignoreInitial: true, persistent: true });
    const fire = (kind: SessionWatchEvent['kind'], path: string): void => {
      const existing = this.timers.get(path);
      if (existing) clearTimeout(existing);
      this.timers.set(
        path,
        setTimeout(() => {
          this.timers.delete(path);
          onEvent({ kind, path, source: resolveSource(path, this.locations) });
        }, debounceMs),
      );
    };
    watcher.on('add', (p) => fire('created', p));
    watcher.on('change', (p) => fire('changed', p));
    watcher.on('unlink', (p) => fire('deleted', p));
    this.watcher = watcher;
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }
}

/**
 * Deterministic in-memory watcher for unit tests. `emit` drives listeners
 * synchronously; `source` is resolved from `locations` when provided, exactly
 * as the chokidar impl does.
 */
export class FakeSessionWatcher implements SessionWatcher {
  private listener: SessionWatchListener | undefined;
  private closed = false;

  constructor(private readonly locations: SessionLocations = {}) {}

  async start(onEvent: SessionWatchListener): Promise<void> {
    this.listener = onEvent;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listener = undefined;
  }

  /** Test hook: simulate a filesystem event. No-op after {@link close}. */
  emit(kind: SessionWatchEvent['kind'], path: string): void {
    if (this.closed || !this.listener) return;
    this.listener({ kind, path, source: resolveSource(path, this.locations) });
  }
}
