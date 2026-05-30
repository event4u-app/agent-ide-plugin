import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MultiRootWalker, isWithin } from './multi-root-walker.js';
import { RootRegistry } from './roots.js';

describe('isWithin', () => {
  it('is segment-aware (web2 is not inside web)', () => {
    expect(isWithin('/repo/web', '/repo')).toBe(true);
    expect(isWithin('/repo', '/repo')).toBe(true);
    expect(isWithin('/repo/web2', '/repo/web')).toBe(false);
    expect(isWithin('/other', '/repo')).toBe(false);
  });
});

describe('MultiRootWalker', () => {
  let base: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'mrw-'));
    // Sibling root A.
    await mkdir(join(base, 'a/src'), { recursive: true });
    await writeFile(join(base, 'a/.gitignore'), 'ignored-by-a.ts\n');
    await writeFile(join(base, 'a/src/keep.ts'), 'export const a = 1;');
    await writeFile(join(base, 'a/src/ignored-by-a.ts'), 'export const x = 1;');
    // Sibling root B.
    await mkdir(join(base, 'b/lib'), { recursive: true });
    await writeFile(join(base, 'b/lib/keep.ts'), 'export const b = 2;');
    // Nested explicit child root: a/web. The parent (a) .gitignore ignores `web/`
    // — but an explicitly-registered child must NOT be suppressed by it.
    await mkdir(join(base, 'a/web/ui'), { recursive: true });
    await writeFile(join(base, 'a/web/ui/app.ts'), 'export const ui = 3;');
    await writeFile(join(base, 'a/.gitignore'), 'ignored-by-a.ts\nweb/\n');
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('walks N roots and attributes each file to a rootId', async () => {
    const reg = new RootRegistry();
    await reg.add({ uri: join(base, 'a'), stableId: 'A', displayName: 'a', kind: 'folder' });
    await reg.add({ uri: join(base, 'b'), stableId: 'B', displayName: 'b', kind: 'folder' });

    const files = await new MultiRootWalker(reg).walk();
    const aFiles = files.filter((f) => f.rootId === 'A').map((f) => f.path);
    const bFiles = files.filter((f) => f.rootId === 'B').map((f) => f.path);

    expect(aFiles).toContain('src/keep.ts');
    expect(aFiles).not.toContain('src/ignored-by-a.ts'); // per-root .gitignore honoured
    expect(bFiles).toEqual(['lib/keep.ts']);
  });

  it('attributes nested-child files to the child, and parent ignore does not suppress the child', async () => {
    const reg = new RootRegistry();
    await reg.add({ uri: join(base, 'a'), stableId: 'A', displayName: 'a', kind: 'folder' });
    await reg.add({
      uri: join(base, 'a/web'),
      stableId: 'WEB',
      displayName: 'web',
      kind: 'folder',
    });

    const files = await new MultiRootWalker(reg).walk();
    const aFiles = files.filter((f) => f.rootId === 'A').map((f) => f.path);
    const webFiles = files.filter((f) => f.rootId === 'WEB').map((f) => f.path);

    // Parent A must not emit anything under the child subtree.
    expect(aFiles.some((p) => p.startsWith('web/'))).toBe(false);
    expect(aFiles).toContain('src/keep.ts');
    // The explicit child owns its files even though A's .gitignore lists `web/`.
    expect(webFiles).toEqual(['ui/app.ts']);
  });
});
