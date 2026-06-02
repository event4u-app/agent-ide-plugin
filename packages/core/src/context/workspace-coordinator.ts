import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ContextScope,
  ContextSnippetAnnotation,
  RootIndexStatus,
  WorkspaceFolder,
} from '@event4u-agent/protocol';
import type { Embedder } from './embedder.js';
import { EmbeddingCacheStore } from './embedding-cache-store.js';
import { ContextEngine } from './engine.js';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';
import { MultiRootWalker, type WalkedFile } from './multi-root-walker.js';
import { RootRegistry, uriToPath, type Platform } from './roots.js';
import { resolveContextScope } from './scope.js';

/**
 * T-MR11 — Core reconciliation + lifecycle.
 *
 * The stateful counterpart the {@link Dispatcher} delegates to (AI Council
 * 2026-05-30: keep the dispatcher a thin routing layer, put the
 * registry + walker + index lifecycle + per-root status behind a coordinator).
 *
 * On the `connect` handshake and on every `workspaceFoldersChanged` delta it
 * diffs the reported roots against a {@link RootRegistry}: added roots get a
 * walk + per-root index segment (debounced — reusing the v1.0 incremental
 * `ContextEngine.indexFile` path); removed roots have their segment torn down
 * via {@link ContextEngine.removeRoot} and are dropped from the registry. A
 * root removed while its index is still in flight is skipped — the run checks
 * the registry per file and per root, so no orphaned segment survives. Kept
 * lean: no generation-ID engine, no multi-membership indexing.
 */

/** The slice of {@link ContextEngine} the coordinator drives (injectable for tests). */
export interface IndexTarget {
  indexFile(filePath: string, content: string, rootId: string): Promise<void>;
  removeRoot(rootId: string): void;
  symbolCountForRoot(rootId: string): number;
  /**
   * T-MR13 — hybrid-retrieve the top-k context snippets for `query`, scoped to
   * `opts.rootIds` (`undefined` = every indexed segment, `[]` = no retrieval).
   * The real {@link ContextEngine} implements this; the coordinator resolves
   * the per-turn {@link ContextScope} to `rootIds` BEFORE calling it.
   */
  retrieveContextSnippets(
    query: string,
    k: number,
    opts: { rootIds?: string[] },
    signal?: AbortSignal,
  ): Promise<ContextSnippetAnnotation[]>;
  /** Seed the embedding cache from disk before an index pass (T-805, ADR-047). */
  loadCache?(): Promise<void>;
  /** Persist the embedding cache's working set after an index pass (ADR-047). */
  persistCache?(): Promise<void>;
}

/** The slice of {@link MultiRootWalker} the coordinator drives (injectable for tests). */
export interface RootWalker {
  walk(): Promise<WalkedFile[]>;
}

export interface WorkspaceCoordinatorOptions {
  registry?: RootRegistry;
  engine?: IndexTarget;
  /**
   * Optional embedder for the default {@link ContextEngine} (T-806 wiring,
   * ADR-044). Absent ⇒ the engine stays BM25-only (unchanged). Ignored when an
   * explicit {@link engine} is injected (tests own that engine's wiring). The
   * sidecar resolves this from `.agent-settings.yml :: context.embeddings` via
   * {@link resolveActiveEmbedder}, so only a real (keyed remote / local)
   * provider activates the vector half of hybrid retrieval.
   */
  embedder?: Embedder;
  /**
   * Directory backing the embedding cache (T-805 persistence, ADR-047). Only
   * used for the default {@link ContextEngine} alongside an {@link embedder};
   * absent ⇒ the cache is in-memory (re-embeds every session, unchanged).
   * Ignored when an explicit {@link engine} is injected. The sidecar passes
   * `<cwd>/<state>/embeddings`.
   */
  embeddingCacheDir?: string;
  /** Debounce window before a scheduled (re)index runs. Tests pass `0`. */
  debounceMs?: number;
  /** Reads an absolute path; overridable in tests. */
  readFile?: (absPath: string) => Promise<string>;
  /** Builds the walker for the current registry; overridable in tests. */
  walkerFactory?: (registry: RootRegistry) => RootWalker;
  platform?: Platform;
}

interface MutableStatus {
  state: 'indexing' | 'ready' | 'error';
  fileCount: number;
  totalFiles: number | null;
  message: string | null;
}

export class WorkspaceCoordinator {
  private readonly registry: RootRegistry;
  private readonly engine: IndexTarget;
  private readonly debounceMs: number;
  private readonly readFileFn: (absPath: string) => Promise<string>;
  private readonly walkerFactory: (registry: RootRegistry) => RootWalker;

  /** stableId → live index status. */
  private readonly statuses = new Map<string, MutableStatus>();
  /** stableIds awaiting a (re)index. */
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private indexing: Promise<void> | undefined;

  constructor(opts: WorkspaceCoordinatorOptions = {}) {
    this.registry = opts.registry ?? new RootRegistry();
    this.engine =
      opts.engine ??
      new ContextEngine(new CodeIndexer(new LanguageRegistry()), {
        ...(opts.embedder ? { embedder: opts.embedder } : {}),
        ...(opts.embedder && opts.embeddingCacheDir
          ? { cacheStore: new EmbeddingCacheStore(opts.embeddingCacheDir) }
          : {}),
      });
    this.debounceMs = opts.debounceMs ?? 2000;
    this.readFileFn = opts.readFile ?? ((p) => readFile(p, 'utf8'));
    const platform = opts.platform ?? process.platform;
    this.walkerFactory =
      opts.walkerFactory ?? ((registry) => new MultiRootWalker(registry, platform));
  }

  /** Connection handshake: register every reported root and schedule indexing. */
  async connect(folders: WorkspaceFolder[]): Promise<RootIndexStatus[]> {
    for (const folder of folders) await this.addRoot(folder);
    if (folders.length > 0) this.scheduleIndex();
    return this.status();
  }

  /** Apply an opened/closed-roots delta. Removed roots are torn down at once. */
  async applyChange(added: WorkspaceFolder[], removed: string[]): Promise<RootIndexStatus[]> {
    for (const stableId of removed) this.removeRoot(stableId);
    for (const folder of added) await this.addRoot(folder);
    if (added.length > 0) this.scheduleIndex();
    return this.status();
  }

  /** Current per-root index status, one entry per registered root. */
  status(): RootIndexStatus[] {
    return [...this.statuses.entries()].map(([stableId, s]) => ({
      stableId,
      state: s.state,
      fileCount: s.fileCount,
      totalFiles: s.totalFiles,
      message: s.message,
    }));
  }

  /** The Core's deduplicated, canonicalised view of the roots (walkable primaries). */
  roots(): WorkspaceFolder[] {
    return this.registry.walkable().map((r) => ({
      uri: r.uri,
      stableId: r.stableId,
      displayName: r.displayName,
      kind: r.kind,
    }));
  }

  /**
   * T-MR13 — retrieve the top-k context snippets for one chat turn, honouring
   * the per-turn {@link ContextScope}. The scope is resolved against the live
   * enabled roots HERE (the coordinator is the only holder of that set):
   *  - `all`   → every indexed segment;
   *  - `none`  → no retrieval at all;
   *  - `roots` → the explicit set filtered to currently-enabled roots (a stale
   *    id is dropped; if nothing survives, the turn carries no code context
   *    rather than silently widening to `all` — the {@link resolveContextScope}
   *    contract).
   *
   * The chat handler stays scope-agnostic and just forwards `req.scope`. The
   * `signal` is threaded into retrieval so a mid-turn cancel stops the search.
   */
  async retrieveContextSnippets(
    query: string,
    k: number,
    scope: ContextScope,
    signal?: AbortSignal,
  ): Promise<ContextSnippetAnnotation[]> {
    const rootIds = resolveContextScope(scope, this.enabledRootIds());
    // `none` (and a roots-set that filtered to empty) → `[]` → the engine
    // short-circuits to no retrieval; `all` → `undefined` → every segment.
    return this.engine.retrieveContextSnippets(query, k, { rootIds }, signal);
  }

  /** Stable ids of the currently-registered, walkable (enabled) roots. */
  private enabledRootIds(): string[] {
    return this.registry.walkable().map((r) => r.stableId);
  }

  /**
   * Flush any debounced indexing and await it to completion. Test/shutdown
   * helper — production callers poll {@link status} instead.
   */
  async whenIdle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.pending.size > 0 || this.indexing) {
      if (this.indexing) {
        await this.indexing;
        this.indexing = undefined;
        continue;
      }
      this.indexing = this.runIndex();
    }
  }

  /** Cancel any pending timer (shutdown). */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async addRoot(folder: WorkspaceFolder): Promise<void> {
    await this.registry.add({
      uri: folder.uri,
      stableId: folder.stableId,
      displayName: folder.displayName,
      kind: folder.kind,
      enabled: true,
    });
    this.statuses.set(folder.stableId, {
      state: 'indexing',
      fileCount: 0,
      totalFiles: null,
      message: null,
    });
    this.pending.add(folder.stableId);
  }

  private removeRoot(stableId: string): void {
    this.registry.remove(stableId);
    this.engine.removeRoot(stableId);
    this.statuses.delete(stableId);
    this.pending.delete(stableId);
  }

  private scheduleIndex(): void {
    if (this.debounceMs <= 0) {
      this.indexing = (this.indexing ?? Promise.resolve()).then(() => this.runIndex());
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.indexing = (this.indexing ?? Promise.resolve()).then(() => this.runIndex());
    }, this.debounceMs);
  }

  /** Walk the registry once and index the files of every currently-pending root. */
  private async runIndex(): Promise<void> {
    const targets = new Set(this.pending);
    this.pending.clear();
    if (targets.size === 0) return;

    let walked: WalkedFile[];
    try {
      walked = await this.walkerFactory(this.registry).walk();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const stableId of targets) this.markError(stableId, message);
      return;
    }

    const byRoot = new Map<string, string[]>();
    for (const file of walked) {
      if (!targets.has(file.rootId)) continue;
      const list = byRoot.get(file.rootId) ?? [];
      list.push(file.path);
      byRoot.set(file.rootId, list);
    }

    // Publish the per-root totals before streaming files in.
    for (const stableId of targets) {
      const status = this.statuses.get(stableId);
      if (!status || !this.registry.get(stableId)) continue; // removed mid-flight
      status.totalFiles = (byRoot.get(stableId) ?? []).length;
      status.fileCount = 0;
      status.state = 'indexing';
    }

    // Seed the embedding cache from disk before indexing so the re-walk hits it
    // instead of re-embedding unchanged chunks (T-805 persistence, ADR-047).
    // Idempotent + fail-soft — a missing/corrupt cache leaves the engine cold.
    await this.engine.loadCache?.();

    for (const [stableId, paths] of byRoot) {
      const root = this.registry.get(stableId);
      if (!root) continue; // cancelled before its turn
      for (const path of paths) {
        if (!this.registry.get(stableId)) break; // cancelled mid-root
        try {
          const content = await this.readFileFn(join(uriToPath(root.uri), path));
          await this.engine.indexFile(path, content, stableId);
          const status = this.statuses.get(stableId);
          if (status) status.fileCount += 1;
        } catch {
          // Unreadable / vanished file — skip it, keep indexing the root.
        }
      }
      const status = this.statuses.get(stableId);
      if (status && this.registry.get(stableId)) status.state = 'ready';
    }

    // Persist the embedding cache's working set now the walk has embedded every
    // current chunk (T-805 persistence, ADR-047). Fail-soft inside the engine;
    // the coalesced post-walk write keeps the cold-start embed cost off the
    // next launch.
    await this.engine.persistCache?.();
  }

  private markError(stableId: string, message: string): void {
    const status = this.statuses.get(stableId);
    if (status) {
      status.state = 'error';
      status.message = message;
    }
  }
}
