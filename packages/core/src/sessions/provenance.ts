import { readFile } from 'node:fs/promises';
import type { SessionOrigin, SessionSummary } from './types.js';

/**
 * Session provenance (T-1206 core).
 *
 * "Did the plugin launch this session, or did the developer run the CLI in a
 * terminal alongside us?" is orthogonal to which CLI produced the file, so it
 * is resolved here rather than inside the source adapters (council, 2026-05-30:
 * model provenance as an explicit field, infer weakly without it).
 *
 * The only reliable signal is a plugin-written record. The plugin appends every
 * CLI session it launches to `<workspace>/.event4u-agent/session-index.json`:
 *
 *   { "sessions": [ { "id": "claude-cli:<uuid>" }, ... ] }
 *
 * Classification:
 *   - `api` source              → always `plugin` (our own conversation store).
 *   - id present in the index    → `plugin`.
 *   - index missing / empty      → `external` (no plugin launched it).
 *   - index present but unreadable → `unknown` (we genuinely cannot tell).
 */
interface LoadedIndex {
  ids: Set<string>;
  /** `false` only when the file exists but could not be read/parsed. */
  readable: boolean;
}

export class SessionProvenanceIndex {
  private cache: LoadedIndex | undefined;

  constructor(private readonly indexFile: string | undefined) {}

  /** Read (and memoize) the plugin session index. Missing file is a normal empty state. */
  async load(): Promise<LoadedIndex> {
    if (this.cache) return this.cache;
    if (!this.indexFile) {
      this.cache = { ids: new Set(), readable: true };
      return this.cache;
    }
    try {
      const raw = await readFile(this.indexFile, 'utf8');
      const parsed = JSON.parse(raw) as { sessions?: { id?: unknown }[] };
      const ids = new Set<string>();
      for (const entry of parsed.sessions ?? []) {
        if (entry && typeof entry.id === 'string' && entry.id.length > 0) ids.add(entry.id);
      }
      this.cache = { ids, readable: true };
    } catch (error) {
      // ENOENT is the normal "plugin never launched a CLI" state, not an error.
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      this.cache =
        code === 'ENOENT'
          ? { ids: new Set(), readable: true }
          : { ids: new Set(), readable: false };
    }
    return this.cache;
  }

  /** Forget the memoized index so the next {@link load} re-reads from disk. */
  invalidate(): void {
    this.cache = undefined;
  }

  /** Classify a single summary against a previously {@link load}ed index. */
  classify(summary: SessionSummary, index: LoadedIndex): SessionOrigin {
    if (summary.source === 'api') return 'plugin';
    if (index.ids.has(summary.id)) return 'plugin';
    return index.readable ? 'external' : 'unknown';
  }

  /** Apply provenance to every summary, returning new objects (no mutation). */
  async apply(summaries: SessionSummary[]): Promise<SessionSummary[]> {
    const index = await this.load();
    return summaries.map((summary) => ({ ...summary, origin: this.classify(summary, index) }));
  }
}
