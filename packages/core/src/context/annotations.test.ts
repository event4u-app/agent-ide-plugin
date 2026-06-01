import { describe, expect, it } from 'vitest';

import {
  PREVIEW_MAX_CHARS,
  PREVIEW_MAX_LINES,
  buildContextSnippets,
  classifySnippet,
} from './annotations.js';
import { FakeEmbedder } from './embedder.js';
import { ContextEngine } from './engine.js';
import { type ChunkRef, type FusedResult, chunkRefKey } from './hybrid.js';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';
import { Snippet } from './snippet.js';

function engine(opts: ConstructorParameters<typeof ContextEngine>[1] = {}): ContextEngine {
  return new ContextEngine(new CodeIndexer(new LanguageRegistry()), opts);
}

function ref(filePath: string, startLine = 0, endLine = 2, rootId = 'A'): ChunkRef {
  return { rootId, filePath, startLine, endLine };
}

function fused(items: { ref: ChunkRef; score: number }[]): FusedResult<ChunkRef>[] {
  return items.map(({ ref: item, score }) => ({ key: chunkRefKey(item), item, score }));
}

/** A resolver over an in-memory file map (mirrors the engine's content lookup). */
function resolver(files: Record<string, string>) {
  return (r: ChunkRef): Snippet | undefined => {
    const content = files[r.filePath];
    return content === undefined
      ? undefined
      : new Snippet(r.filePath, content, r.startLine, r.endLine);
  };
}

const AUTH = `export function authenticateUser(name: string) {\n  return validateSession(name);\n}\nexport function validateSession(token: string) {\n  return token.length > 0;\n}\n`;
const BILLING = `export function createInvoice(amount: number) {\n  return chargeCard(amount);\n}\nexport function chargeCard(amount: number) {\n  return amount > 0;\n}\n`;

describe('classifySnippet', () => {
  it('classifies dependencies before anything else', () => {
    expect(classifySnippet('node_modules/zod/index.d.ts')).toBe('dependency');
    expect(classifySnippet('vendor/symfony/console/Command.php')).toBe('dependency');
    // dependency wins even over a test-shaped basename
    expect(classifySnippet('node_modules/pkg/foo.test.ts')).toBe('dependency');
  });

  it('classifies tests by directory or basename', () => {
    expect(classifySnippet('src/auth.test.ts')).toBe('test');
    expect(classifySnippet('src/auth.spec.ts')).toBe('test');
    expect(classifySnippet('tests/auth.ts')).toBe('test');
    expect(classifySnippet('app/__tests__/auth.ts')).toBe('test');
  });

  it('classifies docs and markdown', () => {
    expect(classifySnippet('docs/architecture.md')).toBe('docs');
    expect(classifySnippet('README.md')).toBe('docs');
    expect(classifySnippet('guide.mdx')).toBe('docs');
  });

  it('falls back to source and is path-separator + case agnostic', () => {
    expect(classifySnippet('src/auth.ts')).toBe('source');
    expect(classifySnippet('src\\billing.ts')).toBe('source');
    expect(classifySnippet('SRC/Auth/TESTS/x.ts')).toBe('test');
  });
});

describe('buildContextSnippets (pure builder)', () => {
  const files = { 'src/auth.ts': AUTH, 'src/billing.ts': BILLING };

  it('returns [] for an empty result set', () => {
    expect(buildContextSnippets([], resolver(files))).toEqual([]);
  });

  it('normalizes a single result to relevance 1', () => {
    const out = buildContextSnippets(
      fused([{ ref: ref('src/auth.ts'), score: 0.03 }]),
      resolver(files),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.relevance).toBe(1);
    expect(out[0]!.category).toBe('source');
  });

  it('normalizes an all-equal set to relevance 1 (no divide-by-zero)', () => {
    const out = buildContextSnippets(
      fused([
        { ref: ref('src/auth.ts'), score: 0.02 },
        { ref: ref('src/billing.ts'), score: 0.02 },
      ]),
      resolver(files),
    );
    expect(out.map((a) => a.relevance)).toEqual([1, 1]);
  });

  it('min-max normalizes spread scores: best=1, worst=0, preserves order', () => {
    const out = buildContextSnippets(
      fused([
        { ref: ref('src/auth.ts'), score: 0.04 },
        { ref: ref('src/billing.ts'), score: 0.02 },
        { ref: ref('docs/readme.md'), score: 0.03 },
      ]),
      resolver({ ...files, 'docs/readme.md': '# Title\nbody\n' }),
    );
    expect(out.map((a) => a.filePath)).toEqual(['src/auth.ts', 'src/billing.ts', 'docs/readme.md']);
    expect(out[0]!.relevance).toBe(1); // 0.04 is max
    expect(out[1]!.relevance).toBe(0); // 0.02 is min
    expect(out[2]!.relevance).toBeCloseTo(0.5); // 0.03 midpoint
    expect(out[2]!.category).toBe('docs');
  });

  it('drops refs whose content the resolver cannot find (file removed)', () => {
    const out = buildContextSnippets(
      fused([
        { ref: ref('src/auth.ts'), score: 0.04 },
        { ref: ref('src/gone.ts'), score: 0.03 },
      ]),
      resolver(files),
    );
    expect(out.map((a) => a.filePath)).toEqual(['src/auth.ts']);
    // normalization is over the RESOLVED set only → single survivor is 1
    expect(out[0]!.relevance).toBe(1);
  });

  it('bounds the preview by lines then chars', () => {
    const many = Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n');
    const out = buildContextSnippets(
      fused([{ ref: ref('src/big.ts', 0, 40), score: 1 }]),
      resolver({ 'src/big.ts': many }),
    );
    expect(out[0]!.preview.split('\n')).toHaveLength(PREVIEW_MAX_LINES);

    const wide = 'x'.repeat(PREVIEW_MAX_CHARS + 200);
    const capped = buildContextSnippets(
      fused([{ ref: ref('src/wide.ts', 0, 1), score: 1 }]),
      resolver({ 'src/wide.ts': wide }),
    );
    expect(capped[0]!.preview.length).toBe(PREVIEW_MAX_CHARS);
  });

  it('carries the chunk-ref line range verbatim', () => {
    const out = buildContextSnippets(
      fused([{ ref: ref('src/auth.ts', 1, 3), score: 1 }]),
      resolver(files),
    );
    expect(out[0]!.startLine).toBe(1);
    expect(out[0]!.endLine).toBe(3);
  });
});

describe('ContextEngine — scored retrieval + context-snippet wiring (T-1308)', () => {
  it('hybridRetrieveScored attaches RRF scores and matches hybridRetrieve order', async () => {
    const e = engine({ embedder: new FakeEmbedder(128) });
    await e.indexFile('src/auth.ts', AUTH, 'A');
    await e.indexFile('src/billing.ts', BILLING, 'A');

    const scored = await e.hybridRetrieveScored('authenticate user session token', 5);
    const bare = await e.hybridRetrieve('authenticate user session token', 5);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.map((s) => s.item.filePath)).toEqual(bare.map((b) => b.filePath));
    expect(scored.every((s) => s.score > 0)).toBe(true);
    // scores arrive best-first (non-increasing) under the identity reranker
    for (let i = 1; i < scored.length; i++)
      expect(scored[i]!.score).toBeLessThanOrEqual(scored[i - 1]!.score);
  });

  it('empty / zero-k scoped retrieval returns []', async () => {
    const e = engine({ embedder: new FakeEmbedder(128) });
    await e.indexFile('src/auth.ts', AUTH, 'A');
    expect(await e.hybridRetrieveScored('x', 5, { rootIds: [] })).toEqual([]);
    expect(await e.hybridRetrieveScored('x', 0)).toEqual([]);
  });

  it('snippetForChunk expands one ref without merging, undefined for unknown content', async () => {
    const e = engine();
    await e.indexFile('src/auth.ts', AUTH, 'A');
    const snip = e.snippetForChunk(
      { rootId: 'A', filePath: 'src/auth.ts', startLine: 0, endLine: 1 },
      1,
    );
    expect(snip?.getText()).toContain('authenticateUser');
    expect(
      e.snippetForChunk({ rootId: 'A', filePath: 'src/gone.ts', startLine: 0, endLine: 1 }),
    ).toBeUndefined();
  });

  it('retrieveContextSnippets produces ranked context-snippet annotations end-to-end', async () => {
    const e = engine({ embedder: new FakeEmbedder(128) });
    await e.indexFile('src/auth.ts', AUTH, 'A');
    await e.indexFile('src/billing.ts', BILLING, 'A');

    const annotations = await e.retrieveContextSnippets('authenticate user session token', 5);
    expect(annotations.length).toBeGreaterThan(0);
    expect(annotations.every((a) => a.kind === 'context-snippet')).toBe(true);
    expect(annotations[0]!.filePath).toBe('src/auth.ts');
    expect(annotations[0]!.relevance).toBe(1); // top hit normalizes to 1
    expect(annotations.every((a) => a.relevance >= 0 && a.relevance <= 1)).toBe(true);
    expect(annotations[0]!.preview).toContain('authenticateUser');
    expect(annotations[0]!.category).toBe('source');
    expect(annotations[0]!.preview.split('\n').length).toBeLessThanOrEqual(PREVIEW_MAX_LINES);
  });
});
