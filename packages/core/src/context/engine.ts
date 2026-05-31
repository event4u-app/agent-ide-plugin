import { throwIfAborted } from '../abort.js';
import { CodeRetriever, type SymbolMatch } from './bm25.js';
import type { Embedder } from './embedder.js';
import { EmbeddingCache } from './embedding-cache.js';
import {
  IdentityReranker,
  SingleQueryExpander,
  chunkRefKey,
  rrfFuse,
  symbolToChunk,
  vectorHitToChunkRef,
  type ChunkRef,
  type QueryExpander,
  type RankedItem,
  type Reranker,
} from './hybrid.js';
import type { CodeIndexer } from './indexer.js';
import { Snippet } from './snippet.js';
import { tokenizeCode } from './tokenize.js';
import { VectorStore } from './vector-store.js';

/**
 * Context Engine — ties the walker/indexer/retriever together and owns the
 * per-file content so retrieval results can be expanded into readable
 * snippets. Incremental (T-604): `indexFile` replaces a file's symbols in
 * place; `removeFile` drops them. Skill-aware boost (T-607): `retrieve` mixes
 * the active skill's description tokens into the query.
 *
 * T-MR04 — **root-partitioned index.** The engine holds one *segment* per
 * `rootId`: a dedicated {@link CodeRetriever} (its own BM25 inverted index) and
 * its own content map. A dedicated index per root is what makes
 * `removeRoot(rootId)` leave the other roots' BM25 scores **bit-identical** —
 * a shared index would shift IDF globally on every add/drop. Single-root usage
 * is a segment of length 1 (the `DEFAULT_ROOT_ID`), behaviourally identical to
 * the pre-multi-root engine.
 *
 * T-MR05 — **scoped retrieval.** `retrieve` accepts `rootIds`: omitted = all
 * indexed segments; an explicit **empty** array = "no code context" (returns
 * nothing); otherwise the exact resolved set. Allocation reserves a small
 * per-root minimum for roots with hits, fills the remaining budget by global
 * relevance, and reclaims the budget of zero-hit roots (no naive equal split).
 *
 * Phase 8 — **hybrid retrieval (opt-in).** When constructed with an
 * {@link Embedder}, the engine also embeds each file's chunks into a
 * {@link VectorStore} (through a content-hash {@link EmbeddingCache}, so a save
 * re-embeds only changed chunks) and exposes {@link ContextEngine.hybridRetrieve}
 * — lexical (BM25, symbol→chunk-mapped) and vector lists fused by Reciprocal
 * Rank Fusion across expanded sub-queries, then reranked. With no embedder it
 * degrades to the lexical list alone, so BM25-only behaviour is unchanged.
 */

/** Sentinel root for single-root callers that do not pass an explicit `rootId`. */
export const DEFAULT_ROOT_ID = '__default__';

export interface RetrieveOptions {
  /** T-607 — active `/skill` description; its terms boost the query. */
  skillDescription?: string;
  /**
   * T-MR05 — resolved scope. `undefined` = all indexed segments; `[]` = the
   * explicit "no code context" flag; otherwise the exact set of root IDs.
   */
  rootIds?: string[];
}

/** A retrieval hit tagged with its owning root (so snippets resolve content). */
export interface ScopedMatch extends SymbolMatch {
  rootId: string;
}

interface RootSegment {
  retriever: CodeRetriever;
  contentByFile: Map<string, string>;
  /** Phase 8 — chunk ranges per file, for symbol→chunk fusion + snippet expansion. */
  chunksByFile: Map<string, ChunkRef[]>;
}

/** Phase 8 — optional embedding/hybrid wiring; absent ⇒ BM25-only (unchanged). */
export interface ContextEngineOptions {
  embedder?: Embedder;
  reranker?: Reranker;
  queryExpander?: QueryExpander;
}

export class ContextEngine {
  private readonly segments = new Map<string, RootSegment>();
  private readonly embedder?: Embedder;
  private readonly embeddingCache?: EmbeddingCache;
  private readonly vectorStore?: VectorStore;
  private readonly reranker: Reranker;
  private readonly queryExpander: QueryExpander;

  constructor(
    private readonly indexer: CodeIndexer,
    opts: ContextEngineOptions = {},
  ) {
    this.embedder = opts.embedder;
    if (this.embedder) {
      this.embeddingCache = new EmbeddingCache(this.embedder);
      this.vectorStore = new VectorStore(this.embedder.dimensions);
    }
    this.reranker = opts.reranker ?? new IdentityReranker();
    this.queryExpander = opts.queryExpander ?? new SingleQueryExpander();
  }

  private segment(rootId: string): RootSegment {
    let seg = this.segments.get(rootId);
    if (!seg) {
      seg = { retriever: new CodeRetriever(), contentByFile: new Map(), chunksByFile: new Map() };
      this.segments.set(rootId, seg);
    }
    return seg;
  }

  /** Index (or re-index) one file in a root segment: refresh symbols + content. */
  async indexFile(
    filePath: string,
    content: string,
    rootId = DEFAULT_ROOT_ID,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const { symbols, chunks } = await this.indexer.indexFile(filePath, content);
    const seg = this.segment(rootId);
    seg.retriever.setFileSymbols(filePath, symbols);
    seg.contentByFile.set(filePath, content);

    const refs: ChunkRef[] = chunks.map((c) => ({
      rootId,
      filePath,
      startLine: c.start,
      endLine: c.end,
    }));
    seg.chunksByFile.set(filePath, refs);

    // Phase 8 — embed chunks (cache-deduped) into the vector store, if enabled.
    if (this.embeddingCache && this.vectorStore && chunks.length > 0) {
      const embeddings = await this.embeddingCache.embed(
        chunks.map((c) => c.getText()),
        signal,
      );
      this.vectorStore.setFileVectors(
        rootId,
        filePath,
        chunks.map((c, i) => ({
          chunkId: chunkRefKey(refs[i]!),
          filePath,
          startLine: c.start,
          endLine: c.end,
          embedding: embeddings[i]!,
        })),
      );
    }
  }

  /** Drop a file from its root segment (T-604 unlink path). */
  removeFile(filePath: string, rootId = DEFAULT_ROOT_ID): void {
    const seg = this.segments.get(rootId);
    if (!seg) return;
    seg.retriever.removeFile(filePath);
    seg.contentByFile.delete(filePath);
    seg.chunksByFile.delete(filePath);
    this.vectorStore?.removeFile(rootId, filePath);
  }

  /** Drop an entire root segment (T-MR04 — removing a workspace root). */
  removeRoot(rootId: string): void {
    this.segments.delete(rootId);
    this.vectorStore?.removeRoot(rootId);
  }

  /** Root IDs that currently have a segment. */
  get rootIds(): string[] {
    return [...this.segments.keys()];
  }

  get indexedSymbolCount(): number {
    let total = 0;
    for (const seg of this.segments.values()) total += seg.retriever.size;
    return total;
  }

  /** Symbol count within one root segment. */
  symbolCountForRoot(rootId: string): number {
    return this.segments.get(rootId)?.retriever.size ?? 0;
  }

  /**
   * Top-`k` symbol matches across the resolved root scope. An active skill
   * description boosts the query (T-607). Allocation is per `allocate`.
   */
  retrieve(query: string, k: number, opts: RetrieveOptions = {}): ScopedMatch[] {
    // Explicit empty scope = "no code context", never "all roots".
    if (opts.rootIds && opts.rootIds.length === 0) return [];

    let q = query;
    if (opts.skillDescription) {
      const boost = tokenizeCode(opts.skillDescription).join(' ');
      if (boost) q = `${query} ${boost}`;
    }

    const scope = opts.rootIds ?? [...this.segments.keys()];
    const perRoot = new Map<string, SymbolMatch[]>();
    for (const rootId of scope) {
      const seg = this.segments.get(rootId);
      if (!seg) continue;
      const hits = seg.retriever.retrieve(q, k);
      if (hits.length > 0) perRoot.set(rootId, hits);
    }
    return allocate(perRoot, k);
  }

  /**
   * Expand matches into snippets with ±`contextLines` of surrounding code,
   * merging overlapping windows in the same file so the injected block reads
   * as contiguous regions rather than fragments. Content is resolved from the
   * match's owning root segment.
   */
  snippetsFor(matches: ScopedMatch[], contextLines = 20): Snippet[] {
    const expanded: Snippet[] = [];
    for (const match of matches) {
      const content = this.segments.get(match.rootId)?.contentByFile.get(match.filePath);
      if (content === undefined) continue;
      expanded.push(
        new Snippet(match.filePath, content, match.startLine, match.endLine).expand(contextLines),
      );
    }
    return mergeOverlapping(expanded);
  }

  /** True when an embedder is wired and the vector path is live. */
  get hybridEnabled(): boolean {
    return !!this.vectorStore;
  }

  /**
   * Phase 8 — hybrid retrieve. Expands the query into sub-queries; for each,
   * runs lexical (BM25, symbol→chunk-mapped) and vector retrieval and fuses them
   * with RRF; merges sub-query results with RRF; reranks the fused head. With no
   * embedder, the vector list is empty so the result is the lexical ranking
   * alone. Returns chunk refs ranked best-first (expand via `snippetsForChunks`).
   */
  async hybridRetrieve(
    query: string,
    k: number,
    opts: RetrieveOptions = {},
    signal?: AbortSignal,
  ): Promise<ChunkRef[]> {
    if (opts.rootIds && opts.rootIds.length === 0) return [];
    if (k <= 0) return [];
    throwIfAborted(signal);
    const depth = Math.max(k * 4, 20);
    const subQueries = await this.queryExpander.expand(query);

    const perQueryFused: RankedItem<ChunkRef>[][] = [];
    for (const subQuery of subQueries) {
      const lexical = this.lexicalChunkList(subQuery, depth, opts);
      const vector = await this.vectorChunkList(subQuery, depth, opts.rootIds, signal);
      // Fuse lexical + vector for this sub-query into one ranked list.
      const fused = rrfFuse([lexical, vector]).map((f) => ({ key: f.key, item: f.item }));
      perQueryFused.push(fused);
    }

    const merged = rrfFuse(perQueryFused).slice(0, depth);
    const reranked = await this.reranker.rerank(
      query,
      merged.map((f) => f.item),
    );
    return reranked.slice(0, k);
  }

  /** BM25 hits for one query, mapped to their containing chunk, deduped, ordered. */
  private lexicalChunkList(
    query: string,
    k: number,
    opts: RetrieveOptions,
  ): RankedItem<ChunkRef>[] {
    const matches = this.retrieve(query, k, opts);
    const refs: ChunkRef[] = matches.map((m) => {
      const chunks = this.segments.get(m.rootId)?.chunksByFile.get(m.filePath) ?? [];
      return (
        symbolToChunk(m, chunks) ?? {
          rootId: m.rootId,
          filePath: m.filePath,
          startLine: m.startLine,
          endLine: m.endLine,
        }
      );
    });
    return dedupeRanked(refs);
  }

  /** Vector hits for one query as a ranked chunk list (empty if no embedder). */
  private async vectorChunkList(
    query: string,
    k: number,
    rootIds?: string[],
    signal?: AbortSignal,
  ): Promise<RankedItem<ChunkRef>[]> {
    if (!this.vectorStore || !this.embedder) return [];
    const [qVec] = await this.embedder.embed([query], signal);
    if (!qVec) return [];
    const hits = this.vectorStore.query(qVec, k, rootIds);
    return dedupeRanked(hits.map(vectorHitToChunkRef));
  }

  /** Expand ranked chunk refs into merged ±context snippets (Phase 8 hybrid path). */
  snippetsForChunks(refs: ChunkRef[], contextLines = 20): Snippet[] {
    const expanded: Snippet[] = [];
    for (const ref of refs) {
      const content = this.segments.get(ref.rootId)?.contentByFile.get(ref.filePath);
      if (content === undefined) continue;
      expanded.push(
        new Snippet(ref.filePath, content, ref.startLine, ref.endLine).expand(contextLines),
      );
    }
    return mergeOverlapping(expanded);
  }
}

/** Build a ranked list from an ordered chunk-ref array, keeping the best rank per key. */
function dedupeRanked(refs: ChunkRef[]): RankedItem<ChunkRef>[] {
  const seen = new Set<string>();
  const out: RankedItem<ChunkRef>[] = [];
  for (const ref of refs) {
    const key = chunkRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, item: ref });
  }
  return out;
}

/**
 * T-MR05 allocation. Reserve a per-root minimum for roots **with** hits, then
 * fill the remaining `k` by global relevance; zero-hit roots contribute nothing
 * so their budget is reclaimed. Deterministic: reserve in `rootId` order, fill
 * by (score desc, rootId asc, filePath asc), and emit the same stable order.
 */
export function allocate(perRoot: Map<string, SymbolMatch[]>, k: number): ScopedMatch[] {
  const active = [...perRoot.entries()]
    .filter(([, hits]) => hits.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (active.length === 0 || k <= 0) return [];

  const base = k >= active.length * 2 ? 2 : 1;
  const taken = new Map<string, number>();
  const result: ScopedMatch[] = [];

  // Reserve the per-root minimum (capped at k and at available hits).
  for (const [rootId, hits] of active) {
    if (result.length >= k) break;
    const n = Math.min(base, hits.length, k - result.length);
    for (let i = 0; i < n; i++) result.push({ ...(hits[i] as SymbolMatch), rootId });
    taken.set(rootId, n);
  }

  // Fill the remaining budget by global relevance from the un-reserved pool.
  const pool: ScopedMatch[] = [];
  for (const [rootId, hits] of active) {
    for (let i = taken.get(rootId) ?? 0; i < hits.length; i++) {
      pool.push({ ...(hits[i] as SymbolMatch), rootId });
    }
  }
  pool.sort(cmpMatch);
  for (const m of pool) {
    if (result.length >= k) break;
    result.push(m);
  }

  return result.sort(cmpMatch);
}

/** Stable comparator: score desc, then rootId asc, then filePath asc. */
function cmpMatch(a: ScopedMatch, b: ScopedMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.rootId !== b.rootId) return a.rootId < b.rootId ? -1 : 1;
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  return a.startLine - b.startLine;
}

/** Merge overlapping snippets within the same file (keeps the block readable). */
export function mergeOverlapping(snippets: Snippet[]): Snippet[] {
  const byFile = new Map<string, Snippet[]>();
  for (const s of snippets) {
    const list = byFile.get(s.filePath) ?? [];
    list.push(s);
    byFile.set(s.filePath, list);
  }
  const out: Snippet[] = [];
  for (const list of byFile.values()) {
    list.sort((a, b) => a.start - b.start);
    let current = list[0];
    if (!current) continue;
    for (let i = 1; i < list.length; i++) {
      const next = list[i];
      if (!next) continue;
      if (current.overlap(next) || current.end >= next.start) {
        current = current.merge(next);
      } else {
        out.push(current);
        current = next;
      }
    }
    out.push(current);
  }
  return out;
}
