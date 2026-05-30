import { CodeRetriever, type SymbolMatch } from './bm25.js';
import type { CodeIndexer } from './indexer.js';
import { Snippet } from './snippet.js';
import { tokenizeCode } from './tokenize.js';

/**
 * Context Engine — ties the walker/indexer/retriever together and owns the
 * per-file content so retrieval results can be expanded into readable
 * snippets. Incremental (T-604): `indexFile` replaces a file's symbols in
 * place; `removeFile` drops them. Skill-aware boost (T-607): `retrieve` mixes
 * the active skill's description tokens into the query.
 */
export interface RetrieveOptions {
  /** T-607 — active `/skill` description; its terms boost the query. */
  skillDescription?: string;
}

export class ContextEngine {
  private readonly retriever = new CodeRetriever();
  private readonly contentByFile = new Map<string, string>();

  constructor(private readonly indexer: CodeIndexer) {}

  /** Index (or re-index) one file: refresh its symbols and cache its content. */
  async indexFile(filePath: string, content: string): Promise<void> {
    const { symbols } = await this.indexer.indexFile(filePath, content);
    this.retriever.setFileSymbols(filePath, symbols);
    this.contentByFile.set(filePath, content);
  }

  /** Drop a file from the index (T-604 unlink path). */
  removeFile(filePath: string): void {
    this.retriever.removeFile(filePath);
    this.contentByFile.delete(filePath);
  }

  get indexedSymbolCount(): number {
    return this.retriever.size;
  }

  /** Top-`k` symbol matches; an active skill description boosts the query. */
  retrieve(query: string, k: number, opts: RetrieveOptions = {}): SymbolMatch[] {
    let q = query;
    if (opts.skillDescription) {
      const boost = tokenizeCode(opts.skillDescription).join(' ');
      if (boost) q = `${query} ${boost}`;
    }
    return this.retriever.retrieve(q, k);
  }

  /**
   * Expand matches into snippets with ±`contextLines` of surrounding code,
   * merging overlapping windows in the same file so the injected block reads
   * as contiguous regions rather than fragments.
   */
  snippetsFor(matches: SymbolMatch[], contextLines = 20): Snippet[] {
    const expanded: Snippet[] = [];
    for (const match of matches) {
      const content = this.contentByFile.get(match.filePath);
      if (content === undefined) continue;
      expanded.push(
        new Snippet(match.filePath, content, match.startLine, match.endLine).expand(contextLines),
      );
    }
    return mergeOverlapping(expanded);
  }
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
