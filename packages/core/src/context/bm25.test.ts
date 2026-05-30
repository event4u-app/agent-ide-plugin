import { describe, expect, it } from 'vitest';
import { CodeRetriever, classifyPath, digitPenalty } from './bm25.js';
import type { SymbolEntry } from './indexer.js';

function sym(name: string, filePath: string): SymbolEntry {
  return { name, kind: 'function_declaration', filePath, startLine: 0, endLine: 5 };
}

describe('classifyPath', () => {
  it('buckets by path shape', () => {
    expect(classifyPath('src/auth/login.ts')).toBe('source');
    expect(classifyPath('src/auth/login.test.ts')).toBe('tests');
    expect(classifyPath('docs/guide.md')).toBe('docs');
    expect(classifyPath('scripts/build.sh')).toBe('tools');
    expect(classifyPath('node_modules/x/index.js')).toBe('junk');
    expect(classifyPath('pnpm-lock.yaml')).toBe('junk');
  });
});

describe('digitPenalty', () => {
  it('is 1 for digit-free names and < 1 for versioned files', () => {
    expect(digitPenalty('src/auth.ts')).toBe(1);
    expect(digitPenalty('migrations/2022_01_03_create_users.sql')).toBeLessThan(1);
  });
});

describe('CodeRetriever', () => {
  it('retrieves by tokenized symbol name', () => {
    const r = new CodeRetriever();
    r.setFileSymbols('src/auth/login.ts', [sym('getUserById', 'src/auth/login.ts')]);
    r.setFileSymbols('src/billing/invoice.ts', [sym('createInvoice', 'src/billing/invoice.ts')]);
    const hits = r.retrieve('user by id', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toBe('getUserById');
  });

  it('boosts files whose path matches a query term', () => {
    const r = new CodeRetriever();
    r.setFileSymbols('src/auth/handler.ts', [sym('handle', 'src/auth/handler.ts')]);
    r.setFileSymbols('src/billing/handler.ts', [sym('handle', 'src/billing/handler.ts')]);
    const hits = r.retrieve('auth handle', 5);
    expect(hits[0].filePath).toBe('src/auth/handler.ts');
  });

  it('drops junk and normalises scores into [0,1]', () => {
    const r = new CodeRetriever();
    r.setFileSymbols('src/parse.ts', [sym('parseConfig', 'src/parse.ts')]);
    r.setFileSymbols('node_modules/lib/parse.js', [
      sym('parseConfig', 'node_modules/lib/parse.js'),
    ]);
    const hits = r.retrieve('parse config', 5);
    expect(hits.every((h) => h.pathType !== 'junk')).toBe(true);
    expect(hits.every((h) => h.score >= 0 && h.score <= 1)).toBe(true);
  });

  it('supports incremental removal (T-604)', () => {
    const r = new CodeRetriever();
    r.setFileSymbols('src/a.ts', [sym('alpha', 'src/a.ts')]);
    expect(r.size).toBe(1);
    r.removeFile('src/a.ts');
    expect(r.size).toBe(0);
    expect(r.retrieve('alpha', 5)).toEqual([]);
  });

  it('re-indexing a file replaces its old symbols', () => {
    const r = new CodeRetriever();
    r.setFileSymbols('src/a.ts', [sym('parseTickets', 'src/a.ts')]);
    r.setFileSymbols('src/a.ts', [sym('renderWidget', 'src/a.ts')]);
    expect(r.size).toBe(1);
    expect(r.retrieve('parse tickets', 5)).toEqual([]);
    expect(r.retrieve('render widget', 5).length).toBe(1);
  });
});
