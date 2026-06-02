import { describe, expect, it } from 'vitest';
import { FakeEmbedder, type Embedder } from './embedder.js';
import { ContextEngine } from './engine.js';
import { type ChunkRef, type QueryExpander, type Reranker } from './hybrid.js';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';

function engine(opts: ConstructorParameters<typeof ContextEngine>[1] = {}): ContextEngine {
  return new ContextEngine(new CodeIndexer(new LanguageRegistry()), opts);
}

const AUTH = `export function authenticateUser(name: string) {\n  return validateSession(name);\n}\nexport function validateSession(token: string) {\n  return token.length > 0;\n}\n`;
const BILLING = `export function createInvoice(amount: number) {\n  return chargeCard(amount);\n}\nexport function chargeCard(amount: number) {\n  return amount > 0;\n}\n`;

describe('ContextEngine.hybridRetrieve (Phase 8)', () => {
  it('reports hybrid disabled without an embedder, enabled with one', () => {
    expect(engine().hybridEnabled).toBe(false);
    expect(engine({ embedder: new FakeEmbedder() }).hybridEnabled).toBe(true);
  });

  it('fuses lexical + vector and returns the relevant chunk (with embedder)', async () => {
    const e = engine({ embedder: new FakeEmbedder(128) });
    await e.indexFile('src/auth.ts', AUTH, 'A');
    await e.indexFile('src/billing.ts', BILLING, 'A');

    const hits = await e.hybridRetrieve('authenticate user session token', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.filePath).toBe('src/auth.ts');

    // Expand into snippets resolves content from the owning segment.
    const snippets = e.snippetsForChunks(hits, 3);
    expect(snippets.some((s) => s.getText().includes('authenticateUser'))).toBe(true);
  });

  it('scopes hybrid retrieval to the resolved root set; empty = nothing', async () => {
    const e = engine({ embedder: new FakeEmbedder(128) });
    await e.indexFile('src/auth.ts', AUTH, 'A');
    await e.indexFile('src/billing.ts', BILLING, 'B');

    const onlyB = await e.hybridRetrieve('authenticate invoice charge', 5, { rootIds: ['B'] });
    expect(onlyB.every((h) => h.rootId === 'B')).toBe(true);
    expect(await e.hybridRetrieve('anything', 5, { rootIds: [] })).toEqual([]);
    expect(await e.hybridRetrieve('anything', 0)).toEqual([]);
  });

  it('degrades to lexical-only retrieval when no embedder is configured', async () => {
    const e = engine(); // no embedder
    await e.indexFile('src/auth.ts', AUTH, 'A');
    const hits = await e.hybridRetrieve('authenticate user', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.filePath).toBe('src/auth.ts');
  });

  it('honours an injected query expander and reranker', async () => {
    const expander: QueryExpander = {
      expand: async (q) => [q, `${q} session`, `${q} token`],
    };
    // Reranker that forces billing-file chunks to the front, proving the seam runs.
    const reranker: Reranker = {
      rerank: async <T extends ChunkRef>(_q: string, c: T[]) =>
        [...c].sort(
          (a, b) => Number(b.filePath.includes('billing')) - Number(a.filePath.includes('billing')),
        ),
    };
    const e = engine({ embedder: new FakeEmbedder(128), reranker, queryExpander: expander });
    await e.indexFile('src/auth.ts', AUTH, 'A');
    await e.indexFile('src/billing.ts', BILLING, 'A');

    const hits = await e.hybridRetrieve('authenticate user', 5);
    expect(hits[0]?.filePath).toBe('src/billing.ts'); // reranker moved billing to the front
  });
});

/** Embedder that always fails — models a remote 401/network error or an abort. */
class FailingEmbedder implements Embedder {
  readonly modelId = 'failing-8';
  readonly dimensions = 8;
  constructor(private readonly mode: 'throw' | 'abort') {}
  async embed(): Promise<Float32Array[]> {
    if (this.mode === 'abort') {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw new Error('embeddings provider failed (openai 401)');
  }
}

describe('ContextEngine embedder fail-soft (T-806 wiring, ADR-044)', () => {
  it('degrades to lexical when the embedder throws — index + retrieve never break', async () => {
    const e = engine({ embedder: new FailingEmbedder('throw') });
    expect(e.hybridEnabled).toBe(true);
    // indexFile must not reject though embedding fails (vector dropped for the
    // file; symbols + content stay indexed)...
    await e.indexFile('src/auth.ts', AUTH, 'A');
    await e.indexFile('src/billing.ts', BILLING, 'A');
    // ...and hybridRetrieve must not reject though the query embed throws — the
    // fusion falls back to the lexical ranking and still finds the chunk.
    const hits = await e.hybridRetrieve('authenticate user session token', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.filePath).toBe('src/auth.ts');
  });

  it('re-throws an abort from the embedder — Stop is user intent, not a failure', async () => {
    const e = engine({ embedder: new FailingEmbedder('abort') });
    await expect(e.indexFile('src/auth.ts', AUTH, 'A')).rejects.toThrowError(/aborted/);
  });
});
