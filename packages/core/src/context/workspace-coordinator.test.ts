import { describe, expect, it } from 'vitest';
import type { ContextSnippetAnnotation, WorkspaceFolder } from '@event4u-agent/protocol';
import type { RootRegistry } from './roots.js';
import {
  WorkspaceCoordinator,
  type IndexTarget,
  type RootWalker,
} from './workspace-coordinator.js';

/** In-memory IndexTarget — records index/remove calls, no tree-sitter. */
class FakeEngine implements IndexTarget {
  readonly indexed = new Map<string, Set<string>>();
  readonly removed: string[] = [];
  /** Recorded `retrieveContextSnippets` calls, so the scope-resolution is testable. */
  readonly retrieveCalls: { query: string; k: number; rootIds?: string[] }[] = [];

  async indexFile(filePath: string, _content: string, rootId: string): Promise<void> {
    const set = this.indexed.get(rootId) ?? new Set<string>();
    set.add(filePath);
    this.indexed.set(rootId, set);
  }

  removeRoot(rootId: string): void {
    this.removed.push(rootId);
    this.indexed.delete(rootId);
  }

  symbolCountForRoot(rootId: string): number {
    return this.indexed.get(rootId)?.size ?? 0;
  }

  async retrieveContextSnippets(
    query: string,
    k: number,
    opts: { rootIds?: string[] },
  ): Promise<ContextSnippetAnnotation[]> {
    this.retrieveCalls.push({ query, k, rootIds: opts.rootIds });
    // One synthetic snippet per resolved root so a caller can see the scoping.
    return (opts.rootIds ?? ['__all__']).map((rootId) => ({
      kind: 'context-snippet' as const,
      rootId,
      filePath: `${rootId}/hit.ts`,
      startLine: 1,
      endLine: 2,
      relevance: 1,
      category: 'source' as const,
      preview: 'export const x = 1;',
    }));
  }
}

/** Walker whose output is a fixed file list per (still-registered) root. */
function fakeWalkerFactory(filesByRoot: Record<string, string[]>) {
  return (registry: RootRegistry): RootWalker => ({
    async walk() {
      return registry
        .walkable()
        .flatMap((r) =>
          (filesByRoot[r.stableId] ?? []).map((path) => ({ rootId: r.stableId, path })),
        );
    },
  });
}

const folder = (stableId: string, name = stableId): WorkspaceFolder => ({
  // Plain path (no file:// scheme) so uriToPath stays cross-platform — a
  // Unix-style file URL throws ERR_INVALID_FILE_URL_PATH on Windows.
  uri: `/repo/${stableId}`,
  stableId,
  displayName: name,
  kind: 'folder',
});

function makeCoordinator(
  filesByRoot: Record<string, string[]>,
  engine = new FakeEngine(),
  debounceMs = 0,
): { coord: WorkspaceCoordinator; engine: FakeEngine } {
  const coord = new WorkspaceCoordinator({
    engine,
    debounceMs,
    readFile: async () => 'export const x = 1;\n',
    walkerFactory: fakeWalkerFactory(filesByRoot),
  });
  return { coord, engine };
}

describe('WorkspaceCoordinator — connect handshake', () => {
  it('registers and indexes every reported root', async () => {
    const { coord, engine } = makeCoordinator({ A: ['src/a.ts'], B: ['lib/b.ts', 'lib/c.ts'] });

    const immediate = await coord.connect([folder('A'), folder('B')]);
    // Status is reported as `indexing` before the debounced run completes.
    expect(immediate.every((s) => s.state === 'indexing')).toBe(true);

    await coord.whenIdle();

    const status = coord.status();
    const byId = Object.fromEntries(status.map((s) => [s.stableId, s]));
    expect(byId.A!.state).toBe('ready');
    expect(byId.A!.fileCount).toBe(1);
    expect(byId.B!.state).toBe('ready');
    expect(byId.B!.fileCount).toBe(2);
    expect(byId.B!.totalFiles).toBe(2);
    expect(engine.symbolCountForRoot('A')).toBe(1);
    expect(engine.symbolCountForRoot('B')).toBe(2);
  });

  it('an empty folder list (legacy single-root fallback) schedules nothing', async () => {
    const { coord, engine } = makeCoordinator({});
    expect(await coord.connect([])).toEqual([]);
    await coord.whenIdle();
    expect(engine.indexed.size).toBe(0);
  });

  it('roots() returns the deduplicated walkable view', async () => {
    const { coord } = makeCoordinator({ A: ['src/a.ts'] });
    await coord.connect([folder('A', 'repo-a')]);
    expect(coord.roots()).toEqual([
      { uri: '/repo/A', stableId: 'A', displayName: 'repo-a', kind: 'folder' },
    ]);
  });
});

describe('WorkspaceCoordinator — workspaceFoldersChanged deltas', () => {
  it('adds a new root without disturbing existing segments', async () => {
    const { coord, engine } = makeCoordinator({ A: ['src/a.ts'], B: ['lib/b.ts'] });
    await coord.connect([folder('A')]);
    await coord.whenIdle();
    expect(engine.removed).toEqual([]);

    await coord.applyChange([folder('B')], []);
    await coord.whenIdle();

    expect(engine.symbolCountForRoot('A')).toBe(1);
    expect(engine.symbolCountForRoot('B')).toBe(1);
    // Adding B never tore down A.
    expect(engine.removed).toEqual([]);
  });

  it('removing a root tears down its segment and drops its status', async () => {
    const { coord, engine } = makeCoordinator({ A: ['src/a.ts'], B: ['lib/b.ts'] });
    await coord.connect([folder('A'), folder('B')]);
    await coord.whenIdle();

    await coord.applyChange([], ['B']);

    expect(engine.removed).toContain('B');
    expect(coord.status().map((s) => s.stableId)).toEqual(['A']);
    expect(coord.roots().map((r) => r.stableId)).toEqual(['A']);
  });

  it('cancels in-flight indexing for a root removed before the debounce fires', async () => {
    // Debounced (50ms): the connect index has not run when the removal lands.
    const { coord, engine } = makeCoordinator(
      { A: ['src/a.ts'], B: ['lib/b.ts'] },
      new FakeEngine(),
      50,
    );
    await coord.connect([folder('A'), folder('B')]);
    await coord.applyChange([], ['A']); // remove A while still pending

    await coord.whenIdle();

    expect(engine.removed).toContain('A');
    expect(engine.symbolCountForRoot('A')).toBe(0); // never indexed
    expect(engine.symbolCountForRoot('B')).toBe(1); // B survived
  });
});

describe('WorkspaceCoordinator — scoped retrieval (T-MR13)', () => {
  it('scope `all` retrieves from every segment (rootIds undefined)', async () => {
    const { coord, engine } = makeCoordinator({ A: ['a.ts'], B: ['b.ts'] });
    await coord.connect([folder('A'), folder('B')]);
    await coord.whenIdle();

    const snippets = await coord.retrieveContextSnippets('query', 8, { kind: 'all' });

    expect(engine.retrieveCalls).toHaveLength(1);
    expect(engine.retrieveCalls[0]?.rootIds).toBeUndefined();
    expect(snippets.map((s) => s.rootId)).toEqual(['__all__']);
  });

  it('scope `none` resolves to an empty root set (engine short-circuits)', async () => {
    const { coord, engine } = makeCoordinator({ A: ['a.ts'] });
    await coord.connect([folder('A')]);
    await coord.whenIdle();

    await coord.retrieveContextSnippets('query', 8, { kind: 'none' });

    expect(engine.retrieveCalls[0]?.rootIds).toEqual([]);
  });

  it('scope `roots` filters to currently-enabled roots, dropping stale ids', async () => {
    const { coord, engine } = makeCoordinator({ A: ['a.ts'], B: ['b.ts'] });
    await coord.connect([folder('A'), folder('B')]);
    await coord.whenIdle();

    // 'GONE' is not a registered root → dropped; 'B' survives.
    const snippets = await coord.retrieveContextSnippets('query', 8, {
      kind: 'roots',
      rootIds: ['B', 'GONE'],
    });

    expect(engine.retrieveCalls[0]?.rootIds).toEqual(['B']);
    expect(snippets.map((s) => s.rootId)).toEqual(['B']);
  });

  it('scope `roots` that filters to empty does NOT widen to all', async () => {
    const { coord, engine } = makeCoordinator({ A: ['a.ts'] });
    await coord.connect([folder('A')]);
    await coord.whenIdle();

    await coord.retrieveContextSnippets('query', 8, { kind: 'roots', rootIds: ['GONE'] });

    // Filtered to [] — NOT undefined ("all") — so no code context leaks in.
    expect(engine.retrieveCalls[0]?.rootIds).toEqual([]);
  });
});
