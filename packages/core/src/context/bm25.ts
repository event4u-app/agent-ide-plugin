import MiniSearch from 'minisearch';
import { basename } from 'node:path';
import type { SymbolEntry } from './indexer.js';
import { tokenizeCode } from './tokenize.js';

/**
 * T-603 — BM25 retriever over symbol names + path tokens.
 *
 * MiniSearch provides the BM25 inverted index; the code-specific intelligence
 * is in the surrounding heuristics, all ported from SweepAI:
 *
 *   - `tokenizeCode` (lexical_search.py) feeds both indexing and the query, so
 *     `getUserById` indexes as `get user by id` and matches a NL query.
 *   - scores are min-max normalised to [0,1] per query.
 *   - digit-penalty (`apply_adjustment_score`, ticket_utils.py) down-weights
 *     versioned / generated files like `migration_2022_*.sql`.
 *   - type-bucketing classifies each hit by path (source / tests / docs /
 *     dependencies / tools / junk); junk is discarded and per-type caps keep
 *     source most permissive.
 *   - path tokens are indexed too, so a query term that appears in the path
 *     (`auth`) boosts files under `src/auth/**`.
 */

export interface SymbolMatch extends SymbolEntry {
  /** Normalised relevance in [0,1] after penalties. */
  score: number;
  pathType: PathType;
}

export type PathType = 'source' | 'tests' | 'docs' | 'dependencies' | 'tools' | 'junk';

/** Per-type result caps (source most permissive); junk is dropped entirely. */
const TYPE_CAPS: Record<PathType, number> = {
  source: Number.POSITIVE_INFINITY,
  tests: 3,
  tools: 2,
  docs: 2,
  dependencies: 1,
  junk: 0,
};

interface IndexedDoc {
  id: number;
  name: string;
  path: string;
  symbol: SymbolEntry;
  pathType: PathType;
}

export class CodeRetriever {
  private readonly mini: MiniSearch<IndexedDoc>;
  private readonly idsByFile = new Map<string, number[]>();
  private readonly docsById = new Map<number, IndexedDoc>();
  private nextId = 0;

  constructor() {
    this.mini = new MiniSearch<IndexedDoc>({
      fields: ['name', 'path'],
      storeFields: ['symbol', 'pathType'],
      idField: 'id',
      tokenize: (text) => tokenizeCode(text),
      processTerm: (term) => term,
      searchOptions: { boost: { name: 2, path: 1 }, combineWith: 'OR' },
    });
  }

  /** Add (or refresh) every symbol of a file. Existing entries are replaced. */
  setFileSymbols(filePath: string, symbols: SymbolEntry[]): void {
    this.removeFile(filePath);
    const ids: number[] = [];
    const docs: IndexedDoc[] = [];
    const pathType = classifyPath(filePath);
    for (const symbol of symbols) {
      const id = this.nextId++;
      const doc: IndexedDoc = { id, name: symbol.name, path: filePath, symbol, pathType };
      docs.push(doc);
      this.docsById.set(id, doc);
      ids.push(id);
    }
    if (docs.length > 0) this.mini.addAll(docs);
    this.idsByFile.set(filePath, ids);
  }

  /** Drop every symbol of a file (incremental re-index, T-604). */
  removeFile(filePath: string): void {
    const ids = this.idsByFile.get(filePath);
    if (!ids) return;
    for (const id of ids) {
      const doc = this.docsById.get(id);
      if (doc) {
        this.mini.discard(id);
        this.docsById.delete(id);
      }
    }
    this.idsByFile.delete(filePath);
  }

  get size(): number {
    return this.docsById.size;
  }

  /**
   * Retrieve the top-`k` symbol matches for a query. Applies digit-penalty,
   * min-max normalisation, junk-drop, and per-type caps.
   */
  retrieve(query: string, k: number): SymbolMatch[] {
    const results = this.mini.search(query);
    if (results.length === 0) return [];

    const scored = results.map((r) => {
      const doc = this.docsById.get(r.id as number);
      const symbol = (doc?.symbol ?? r.symbol) as SymbolEntry;
      const pathType = (doc?.pathType ?? r.pathType) as PathType;
      const adjusted = r.score * digitPenalty(symbol.filePath);
      return { symbol, pathType, raw: adjusted };
    });

    const max = Math.max(...scored.map((s) => s.raw));
    const min = Math.min(...scored.map((s) => s.raw));
    const range = max - min || 1;

    const normalised = scored
      .map((s) => ({ ...s, score: (s.raw - min) / range }))
      .sort((a, b) => b.score - a.score);

    const perType: Record<string, number> = {};
    const out: SymbolMatch[] = [];
    for (const s of normalised) {
      if (out.length >= k) break;
      const cap = TYPE_CAPS[s.pathType];
      const used = perType[s.pathType] ?? 0;
      if (used >= cap) continue;
      perType[s.pathType] = used + 1;
      out.push({ ...s.symbol, pathType: s.pathType, score: s.score });
    }
    return out;
  }
}

/**
 * Down-weight versioned / generated files: `(1 - 1/len)^digitCount` over the
 * filename. A name with many digits (`migration_2022_01_init.sql`) is pushed
 * down; a clean `auth.ts` is barely touched.
 */
export function digitPenalty(filePath: string): number {
  const name = basename(filePath);
  if (name.length === 0) return 1;
  const digits = (name.match(/\d/g) ?? []).length;
  if (digits === 0) return 1;
  return (1 - 1 / name.length) ** digits;
}

const JUNK_RE =
  /(^|\/)(node_modules|dist|out|vendor|\.git|build|coverage)(\/|$)|\.min\.(js|css)$|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const TEST_RE = /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[jt]sx?$/;
const DOCS_RE = /\.(md|mdx|rst|txt)$|(^|\/)docs?(\/|$)|readme/i;
const TOOLS_RE =
  /(^|\/)(scripts?|tools?|\.config|\.github)(\/|$)|(Makefile|Taskfile\.ya?ml)$|\.(config|ya?ml|toml|ini)$/;

/** Classify a path into a retrieval bucket. Order: junk → tests → docs → tools → source. */
export function classifyPath(filePath: string): PathType {
  if (JUNK_RE.test(filePath)) return 'junk';
  if (TEST_RE.test(filePath)) return 'tests';
  if (DOCS_RE.test(filePath)) return 'docs';
  if (TOOLS_RE.test(filePath)) return 'tools';
  return 'source';
}
