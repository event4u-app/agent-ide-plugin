import { describe, expect, it } from 'vitest';
import type { SymbolMatch } from './bm25.js';
import {
  IdentityReranker,
  RRF_K,
  SingleQueryExpander,
  chunkRefKey,
  rrfFuse,
  symbolToChunk,
  vectorHitToChunkRef,
  type ChunkRef,
  type Reranker,
} from './hybrid.js';

const ref = (rootId: string, filePath: string, startLine: number, endLine: number): ChunkRef => ({
  rootId,
  filePath,
  startLine,
  endLine,
});
const ranked = (c: ChunkRef) => ({ key: chunkRefKey(c), item: c });

describe('rrfFuse', () => {
  it('rewards consensus across lists and is scale-free', () => {
    const x = ref('A', 'x.ts', 0, 10);
    const y = ref('A', 'y.ts', 0, 10);
    const z = ref('A', 'z.ts', 0, 10);
    // x appears in both lists; y and z each in one.
    const fused = rrfFuse([
      [ranked(x), ranked(y)],
      [ranked(x), ranked(z)],
    ]);
    expect(fused[0]?.key).toBe(chunkRefKey(x));
    expect(fused[0]?.score).toBeCloseTo(2 / (RRF_K + 1), 9);
    // y and z tie on score; deterministic key-ascending order.
    expect(fused.slice(1).map((f) => f.key)).toEqual([chunkRefKey(y), chunkRefKey(z)].sort());
  });

  it('handles a single list and empty input', () => {
    expect(rrfFuse([])).toEqual([]);
    const a = ref('A', 'a.ts', 0, 5);
    expect(rrfFuse([[ranked(a)]])[0]?.key).toBe(chunkRefKey(a));
  });
});

describe('symbolToChunk', () => {
  const sym = (filePath: string, startLine: number, endLine: number): SymbolMatch => ({
    name: 's',
    kind: 'function_declaration',
    filePath,
    startLine,
    endLine,
    score: 1,
    pathType: 'source',
  });

  it('maps a symbol to the most-overlapping chunk in the same file', () => {
    const chunks = [ref('A', 'a.ts', 0, 8), ref('A', 'a.ts', 8, 20), ref('A', 'b.ts', 0, 30)];
    const got = symbolToChunk(sym('a.ts', 5, 10), chunks);
    expect(got).toEqual(ref('A', 'a.ts', 0, 8)); // overlap 3 > overlap 2 in the second chunk
  });

  it('returns undefined when no chunk contains the symbol', () => {
    expect(symbolToChunk(sym('ghost.ts', 0, 5), [ref('A', 'a.ts', 0, 10)])).toBeUndefined();
  });
});

describe('rerank + expander seams', () => {
  it('IdentityReranker preserves order; a custom reranker can reorder', async () => {
    const items = [ref('A', 'a.ts', 0, 5), ref('A', 'b.ts', 0, 5)];
    expect(await new IdentityReranker().rerank('q', items)).toEqual(items);

    const reverse: Reranker = { rerank: async (_q, c) => [...c].reverse() };
    expect(await reverse.rerank('q', items)).toEqual([items[1], items[0]]);
  });

  it('SingleQueryExpander returns just the original query', async () => {
    expect(await new SingleQueryExpander().expand('find auth')).toEqual(['find auth']);
  });

  it('vectorHitToChunkRef drops the score field', () => {
    const r = vectorHitToChunkRef({
      chunkId: 'c1',
      rootId: 'A',
      filePath: 'a.ts',
      startLine: 1,
      endLine: 9,
      score: 0.7,
    });
    expect(r).toEqual(ref('A', 'a.ts', 1, 9));
  });
});
