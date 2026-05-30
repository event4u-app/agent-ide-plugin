import { describe, expect, it } from 'vitest';
import type { SymbolMatch } from './bm25.js';
import { ContextEngine, allocate, mergeOverlapping, type ScopedMatch } from './engine.js';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';
import { Snippet } from './snippet.js';

function makeEngine(): ContextEngine {
  return new ContextEngine(new CodeIndexer(new LanguageRegistry()));
}

const AUTH = `export function loginUser(name: string) {\n  return name;\n}\n`;
const BILLING = `export function createInvoice(amount: number) {\n  return amount;\n}\n`;

describe('ContextEngine', () => {
  it('indexes files and retrieves by tokenized symbol name', async () => {
    const engine = makeEngine();
    await engine.indexFile('src/auth.ts', AUTH);
    await engine.indexFile('src/billing.ts', BILLING);
    const hits = engine.retrieve('login user', 5);
    expect(hits[0]?.name).toBe('loginUser');
  });

  it('drops a removed file from retrieval (T-604)', async () => {
    const engine = makeEngine();
    await engine.indexFile('src/auth.ts', AUTH);
    expect(engine.indexedSymbolCount).toBe(1);
    engine.removeFile('src/auth.ts');
    expect(engine.indexedSymbolCount).toBe(0);
    expect(engine.retrieve('login user', 5)).toEqual([]);
  });

  it('boosts retrieval with an active skill description (T-607)', async () => {
    const engine = makeEngine();
    await engine.indexFile('src/auth.ts', AUTH);
    await engine.indexFile('src/billing.ts', BILLING);
    // A bare query unrelated to either symbol; the skill description pulls billing up.
    const hits = engine.retrieve('show me the money', 5, {
      skillDescription: 'create and manage invoices and amounts',
    });
    expect(hits[0]?.name).toBe('createInvoice');
  });

  it('re-indexes a 500-function file quickly (T-604)', async () => {
    const engine = makeEngine();
    const big = Array.from(
      { length: 500 },
      (_, i) => `export function fn${i}() { return ${i}; }`,
    ).join('\n');
    await engine.indexFile('src/big.ts', big); // warm the grammar load
    const start = performance.now();
    await engine.indexFile('src/big.ts', big);
    const elapsed = performance.now() - start;
    expect(engine.indexedSymbolCount).toBe(500);
    // Target is <200ms; assert a generous ceiling so CI variance does not flake.
    expect(elapsed).toBeLessThan(2000);
  });

  it('expands matches into ±context snippets', async () => {
    const engine = makeEngine();
    await engine.indexFile('src/auth.ts', AUTH);
    const snippets = engine.snippetsFor(engine.retrieve('login user', 5), 5);
    expect(snippets.length).toBe(1);
    expect(snippets[0]?.getText()).toContain('loginUser');
  });
});

describe('ContextEngine — multi-root (T-MR04 / T-MR05)', () => {
  it('partitions the index per root and drops only the removed segment', async () => {
    const engine = makeEngine();
    await engine.indexFile('src/auth.ts', AUTH, 'A');
    await engine.indexFile('src/billing.ts', BILLING, 'B');

    // Baseline retrieval against root A, captured before B is dropped.
    const before = engine.retrieve('login user', 5, { rootIds: ['A'] });
    expect(engine.symbolCountForRoot('A')).toBe(1);
    expect(engine.symbolCountForRoot('B')).toBe(1);

    engine.removeRoot('B');

    // A's segment is untouched: same count, same scores, bit-identical hits.
    expect(engine.symbolCountForRoot('A')).toBe(1);
    expect(engine.symbolCountForRoot('B')).toBe(0);
    const after = engine.retrieve('login user', 5, { rootIds: ['A'] });
    expect(after).toEqual(before);
  });

  it('scopes retrieval to the exact resolved root-ID set', async () => {
    const engine = makeEngine();
    await engine.indexFile('src/auth.ts', AUTH, 'A');
    await engine.indexFile('src/billing.ts', BILLING, 'B');

    const onlyA = engine.retrieve('login user invoice amount', 5, { rootIds: ['A'] });
    expect(onlyA.every((h) => h.rootId === 'A')).toBe(true);
    expect(onlyA.map((h) => h.name)).toContain('loginUser');

    // Omitted scope spans all indexed segments.
    const allRoots = engine.retrieve('login user invoice amount', 5);
    expect(new Set(allRoots.map((h) => h.rootId))).toEqual(new Set(['A', 'B']));

    // Explicit empty scope = "no code context".
    expect(engine.retrieve('login user', 5, { rootIds: [] })).toEqual([]);
  });
});

describe('allocate (T-MR05)', () => {
  const match = (name: string, filePath: string, score: number): SymbolMatch => ({
    name,
    kind: 'function_declaration',
    filePath,
    startLine: 0,
    endLine: 1,
    score,
    pathType: 'source',
  });

  function countByRoot(out: ScopedMatch[]): Record<string, number> {
    const acc: Record<string, number> = {};
    for (const m of out) acc[m.rootId] = (acc[m.rootId] ?? 0) + 1;
    return acc;
  }

  it('reserves a per-root minimum, fills by relevance, reclaims zero-hit budget', () => {
    // k=10 across r1 (8 hits), r2 (2 hits), r3 (0 hits) → 8 / 2 / 0 (council example).
    const r1 = Array.from({ length: 8 }, (_, i) => match(`a${i}`, `r1/a${i}.ts`, 1 - i * 0.1));
    const r2 = Array.from({ length: 2 }, (_, i) => match(`b${i}`, `r2/b${i}.ts`, 0.9 - i * 0.1));
    const perRoot = new Map([
      ['r1', r1],
      ['r2', r2],
      ['r3', []],
    ]);
    const out = allocate(perRoot, 10);
    expect(out).toHaveLength(10);
    expect(countByRoot(out)).toEqual({ r1: 8, r2: 2 });
  });

  it('guarantees the per-root minimum even when one root dominates by score', () => {
    // r1 has 10 high-scoring hits, r2 has 2 lower-scoring hits; r2 must still get its floor.
    const r1 = Array.from({ length: 10 }, (_, i) => match(`a${i}`, `r1/a${i}.ts`, 1 - i * 0.01));
    const r2 = [match('b0', 'r2/b0.ts', 0.2), match('b1', 'r2/b1.ts', 0.1)];
    const out = allocate(
      new Map([
        ['r1', r1],
        ['r2', r2],
      ]),
      10,
    );
    expect(out).toHaveLength(10);
    expect(countByRoot(out).r2).toBe(2); // floor honoured despite low scores
    expect(countByRoot(out).r1).toBe(8);
  });

  it('returns nothing for an empty allocation', () => {
    expect(allocate(new Map(), 10)).toEqual([]);
    expect(allocate(new Map([['r1', [match('a', 'r1/a.ts', 1)]]]), 0)).toEqual([]);
  });
});

describe('mergeOverlapping', () => {
  it('merges overlapping windows in the same file', () => {
    const content = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
    const merged = mergeOverlapping([
      new Snippet('a.ts', content, 0, 10),
      new Snippet('a.ts', content, 8, 20),
      new Snippet('b.ts', content, 0, 5),
    ]);
    const aFile = merged.filter((s) => s.filePath === 'a.ts');
    expect(aFile).toHaveLength(1);
    expect(aFile[0]?.start).toBe(0);
    expect(aFile[0]?.end).toBe(20);
  });
});
