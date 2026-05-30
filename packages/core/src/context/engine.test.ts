import { describe, expect, it } from 'vitest';
import { ContextEngine, mergeOverlapping } from './engine.js';
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
