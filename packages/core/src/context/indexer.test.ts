import { describe, expect, it } from 'vitest';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';
import { naiveChunker } from './chunk-tree.js';

const SAMPLE_TS = `import { z } from 'zod';

export function add(a: number, b: number): number {
  return a + b;
}

export class AuthController {
  login(user: string) {
    return user;
  }

  logout() {
    return true;
  }
}

export interface UserShape {
  id: string;
  name: string;
}
`;

describe('CodeIndexer (real tree-sitter grammar)', () => {
  const registry = new LanguageRegistry();
  const indexer = new CodeIndexer(registry);

  it('extracts top-level symbols from a TypeScript file', async () => {
    const { symbols, chunks } = await indexer.indexFile('src/auth.ts', SAMPLE_TS);
    const names = symbols.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('AuthController');
    expect(names).toContain('login');
    expect(names).toContain('UserShape');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('produces chunks that cover the file from the top with no lost tail', async () => {
    const { chunks } = await indexer.indexFile('src/auth.ts', SAMPLE_TS);
    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    expect(sorted[0].start).toBe(0);
    // Last chunk extends to EOF; for a trailing-newline file the final line
    // index equals the newline count (split() counts the empty trailing line).
    const newlineCount = (SAMPLE_TS.match(/\n/g) ?? []).length;
    expect(sorted[sorted.length - 1].end).toBe(newlineCount);
  });

  it('does not emit a bare closing-bracket chunk', async () => {
    const { chunks } = await indexer.indexFile('src/auth.ts', SAMPLE_TS);
    for (const chunk of chunks) {
      expect(chunk.getText().trim()).not.toMatch(/^[)\]}]$/);
    }
  });

  it('falls back to the naive chunker for files with no grammar', async () => {
    const md = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
    const { symbols, chunks } = await indexer.indexFile('README.md', md);
    expect(symbols).toEqual([]);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('naiveChunker', () => {
  it('windows lines with overlap and covers the whole file', () => {
    const content = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n');
    const chunks = naiveChunker('x.txt', content, 30, 0.5);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(100);
    // 50% overlap → step 15
    expect(chunks[1].start).toBe(15);
  });

  it('returns nothing for empty content', () => {
    expect(naiveChunker('x.txt', '')).toEqual([]);
  });
});
