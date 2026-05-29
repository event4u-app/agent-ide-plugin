import { describe, expect, it } from 'vitest';
import { dirOf, groupFiles } from './grouping.js';
import type { FileChange } from './types.js';

function fc(file: string, over: Partial<FileChange> = {}): FileChange {
  return { file, status: 'modified', binary: false, hunks: [], ...over };
}

describe('dirOf', () => {
  it('returns the directory portion or "." for root files', () => {
    expect(dirOf('a/b/c.ts')).toBe('a/b');
    expect(dirOf('top.ts')).toBe('.');
  });
});

describe('groupFiles', () => {
  it('clusters two files in the same module together', () => {
    const groups = groupFiles([
      fc('packages/core/src/review/a.ts'),
      fc('packages/core/src/review/b.ts'),
      fc('packages/core/src/llm/c.ts'),
    ]);
    const reviewGroup = groups.find((g) => g.includes('packages/core/src/review/a.ts'));
    expect(reviewGroup).toContain('packages/core/src/review/b.ts');
    expect(reviewGroup).not.toContain('packages/core/src/llm/c.ts');
  });

  it('excludes binary and deleted files from review groups', () => {
    const groups = groupFiles([
      fc('x/a.ts'),
      fc('x/img.png', { binary: true }),
      fc('x/gone.ts', { status: 'deleted' }),
    ]);
    const flat = groups.flat();
    expect(flat).toContain('x/a.ts');
    expect(flat).not.toContain('x/img.png');
    expect(flat).not.toContain('x/gone.ts');
  });

  it('joins files across directories when an import edge connects them', () => {
    const importEdges = new Map<string, string[]>([['a/one.ts', ['b/two.ts']]]);
    const groups = groupFiles([fc('a/one.ts'), fc('b/two.ts'), fc('c/three.ts')], { importEdges });
    const joined = groups.find((g) => g.includes('a/one.ts'));
    expect(joined).toContain('b/two.ts');
    expect(joined).not.toContain('c/three.ts');
  });

  it('splits an oversized group into bounded chunks', () => {
    const files = Array.from({ length: 10 }, (_, i) => fc(`big/f${i}.ts`));
    const groups = groupFiles(files, { maxGroupSize: 4 });
    expect(groups.every((g) => g.length <= 4)).toBe(true);
    expect(groups.flat()).toHaveLength(10);
  });
});
