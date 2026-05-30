import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextEngine } from './engine.js';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';
import { MultiRootWalker } from './multi-root-walker.js';
import { buildMultiRootFixture, type MultiRootFixture } from './multi-root-fixture.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RootRegistry } from './roots.js';

/**
 * T-MR07 — End-to-end multi-root pipeline over the fixture: RootRegistry →
 * MultiRootWalker → ContextEngine (per-root segments) → scoped retrieve.
 */
describe('multi-root pipeline (T-MR07)', () => {
  let fx: MultiRootFixture;

  beforeAll(async () => {
    fx = await buildMultiRootFixture();
  });

  afterAll(async () => {
    await rm(fx.base, { recursive: true, force: true });
  });

  /** Register the canonical root set; index every walked file into its segment. */
  async function indexAll(reg: RootRegistry): Promise<ContextEngine> {
    const engine = new ContextEngine(new CodeIndexer(new LanguageRegistry()));
    const walked = await new MultiRootWalker(reg).walk();
    for (const { rootId, path } of walked) {
      const root = reg.get(rootId);
      if (!root) continue;
      const content = await readFile(join(uriPath(root.uri), path), 'utf8');
      await engine.indexFile(path, content, rootId);
    }
    return engine;
  }

  it('collapses a symlinked duplicate to one walkable root (canonical dedup)', async () => {
    if (!fx.linkToA) return; // platform refused symlinks — dedup matrix not exercisable here
    const reg = new RootRegistry();
    await reg.add({ uri: fx.repoA, stableId: 'a-repo', displayName: 'repo-a', kind: 'folder' });
    await reg.add({
      uri: fx.linkToA,
      stableId: 'z-link',
      displayName: 'link-to-a',
      kind: 'folder',
    });
    expect(reg.size).toBe(2);
    // Smallest stableId ('a-repo') wins; the symlink alias is not walkable.
    expect(reg.walkable().map((r) => r.stableId)).toEqual(['a-repo']);

    const walked = await new MultiRootWalker(reg).walk();
    // repo-a's source file appears exactly once, attributed to the primary.
    const auth = walked.filter((f) => f.path === 'src/auth.ts');
    expect(auth).toEqual([{ rootId: 'a-repo', path: 'src/auth.ts' }]);
  });

  it('honours per-root ignore and the parent-ignores-child precedence', async () => {
    const reg = new RootRegistry();
    await reg.add({ uri: fx.repoA, stableId: 'A', displayName: 'repo-a', kind: 'folder' });
    await reg.add({ uri: fx.repoB, stableId: 'B', displayName: 'repo-b', kind: 'folder' });
    await reg.add({ uri: fx.webChild, stableId: 'WEB', displayName: 'web', kind: 'folder' });

    const walked = await new MultiRootWalker(reg).walk();
    const paths = (id: string) =>
      walked
        .filter((f) => f.rootId === id)
        .map((f) => f.path)
        .sort();

    // A ignores generated/ (its .gitignore) and excludes the explicit child web/.
    // The `.gitignore` file itself is a real, non-ignored file and is emitted.
    expect(paths('A')).toEqual(['.gitignore', 'src/auth.ts']);
    // B ignores *.log.
    expect(paths('B')).toEqual(['.gitignore', 'lib/billing.ts']);
    // The explicit child owns its files despite A's .gitignore listing web/.
    expect(paths('WEB')).toEqual(['ui/widget.ts']);
  });

  it('drops one root segment without disturbing the others, and scopes retrieval', async () => {
    const reg = new RootRegistry();
    await reg.add({ uri: fx.repoA, stableId: 'A', displayName: 'repo-a', kind: 'folder' });
    await reg.add({ uri: fx.repoB, stableId: 'B', displayName: 'repo-b', kind: 'folder' });
    await reg.add({ uri: fx.webChild, stableId: 'WEB', displayName: 'web', kind: 'folder' });
    const engine = await indexAll(reg);

    expect(engine.symbolCountForRoot('A')).toBe(1); // loginUser
    expect(engine.symbolCountForRoot('B')).toBe(1); // createInvoice
    expect(engine.symbolCountForRoot('WEB')).toBe(1); // renderWidget

    // Scoped retrieve: only WEB.
    const web = engine.retrieve('render widget invoice login', 5, { rootIds: ['WEB'] });
    expect(web.every((h) => h.rootId === 'WEB')).toBe(true);
    expect(web.map((h) => h.name)).toContain('renderWidget');

    // Drop B; A and WEB are bit-identical afterwards.
    const beforeA = engine.retrieve('login user', 5, { rootIds: ['A'] });
    engine.removeRoot('B');
    expect(engine.symbolCountForRoot('B')).toBe(0);
    expect(engine.symbolCountForRoot('A')).toBe(1);
    expect(engine.retrieve('login user', 5, { rootIds: ['A'] })).toEqual(beforeA);

    // Omitted scope now spans only the surviving segments.
    const all = engine.retrieve('login user render widget', 5);
    expect(new Set(all.map((h) => h.rootId))).toEqual(new Set(['A', 'WEB']));
  });
});

/** Local copy of file:// → path resolution to avoid importing internals here. */
function uriPath(uri: string): string {
  return uri.startsWith('file://') ? new URL(uri).pathname : uri;
}
