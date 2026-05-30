import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceWalker } from './walker.js';

describe('WorkspaceWalker.scan', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'walker-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'lib'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;');
    await writeFile(join(root, 'src', 'b.test.ts'), 'test stuff');
    await writeFile(join(root, 'node_modules', 'lib', 'index.js'), 'module.exports = {}');
    await writeFile(join(root, 'dist', 'out.js'), 'compiled');
    await writeFile(join(root, 'secret.txt'), 'shh');
    await writeFile(join(root, '.gitignore'), 'secret.txt\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('enumerates source files and skips ignored dirs + gitignored files', async () => {
    const files = await new WorkspaceWalker({ root }).scan();
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.test.ts');
    expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false);
    expect(files.some((f) => f.startsWith('dist/'))).toBe(false);
    expect(files).not.toContain('secret.txt');
  });

  it('honours .augmentignore on top of .gitignore', async () => {
    await writeFile(join(root, '.augmentignore'), 'src/b.test.ts\n');
    const files = await new WorkspaceWalker({ root }).scan();
    expect(files).toContain('src/a.ts');
    expect(files).not.toContain('src/b.test.ts');
  });

  it('respects extraIgnore globs', async () => {
    const files = await new WorkspaceWalker({ root, extraIgnore: ['**/*.ts'] }).scan();
    expect(files.some((f) => f.endsWith('.ts'))).toBe(false);
  });
});
