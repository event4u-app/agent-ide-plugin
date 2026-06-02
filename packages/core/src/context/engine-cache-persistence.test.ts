import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingCacheStore } from './embedding-cache-store.js';
import { FakeEmbedder } from './embedder.js';
import { ContextEngine } from './engine.js';
import { CodeIndexer } from './indexer.js';
import { LanguageRegistry } from './languages.js';

const SRC = `export function authenticateUser(name: string) {\n  return validateSession(name);\n}\nexport function validateSession(token: string) {\n  return token.length > 0;\n}\n`;

function engine(embedder: FakeEmbedder, cacheStore?: EmbeddingCacheStore): ContextEngine {
  return new ContextEngine(new CodeIndexer(new LanguageRegistry()), {
    embedder,
    ...(cacheStore ? { cacheStore } : {}),
  });
}

describe('ContextEngine embedding-cache persistence (ADR-047)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engine-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists on one engine and skips re-embedding on the next (cache hit across restart)', async () => {
    const store = new EmbeddingCacheStore(dir);

    // Session 1: cold cache → real embeds, then persist the working set.
    const e1 = new FakeEmbedder(64);
    const spy1 = vi.spyOn(e1, 'embed');
    const engine1 = engine(e1, store);
    await engine1.loadCache(); // nothing on disk yet → cold
    await engine1.indexFile('src/auth.ts', SRC, 'A');
    const session1Embeds = spy1.mock.calls.length;
    expect(session1Embeds).toBeGreaterThan(0);
    await engine1.persistCache();

    // Session 2: same store + identical content → loadCache seeds, no re-embed.
    const e2 = new FakeEmbedder(64);
    const spy2 = vi.spyOn(e2, 'embed');
    const engine2 = engine(e2, store);
    await engine2.loadCache();
    await engine2.indexFile('src/auth.ts', SRC, 'A');

    expect(spy2).not.toHaveBeenCalled(); // every chunk served from the persisted cache
  });

  it('loadCache is idempotent — a second call does not re-read or reset', async () => {
    const store = new EmbeddingCacheStore(dir);
    const e1 = engine(new FakeEmbedder(64), store);
    await e1.indexFile('src/auth.ts', SRC, 'A');
    await e1.persistCache();

    const loadSpy = vi.spyOn(store, 'load');
    const e2 = engine(new FakeEmbedder(64), store);
    await e2.loadCache();
    await e2.loadCache(); // second call is a no-op
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('persistCache is fail-soft — a save error never throws', async () => {
    const store = new EmbeddingCacheStore(dir);
    vi.spyOn(store, 'save').mockRejectedValue(new Error('disk full'));
    const e = engine(new FakeEmbedder(64), store);
    await e.indexFile('src/auth.ts', SRC, 'A');
    await expect(e.persistCache()).resolves.toBeUndefined();
  });

  it('a model swap discards the stale cache and re-embeds (header guard)', async () => {
    const store = new EmbeddingCacheStore(dir);
    const e1 = engine(new FakeEmbedder(64), store);
    await e1.indexFile('src/auth.ts', SRC, 'A');
    await e1.persistCache();

    // Different dimensions ⇒ different modelId ⇒ header mismatch ⇒ cold.
    const e2model = new FakeEmbedder(128);
    const spy = vi.spyOn(e2model, 'embed');
    const e2 = engine(e2model, store);
    await e2.loadCache();
    await e2.indexFile('src/auth.ts', SRC, 'A');
    expect(spy).toHaveBeenCalled(); // stale cache rejected, re-embedded
  });

  it('is a no-op without a cacheStore (in-memory cache, unchanged behavior)', async () => {
    const e = engine(new FakeEmbedder(64)); // no store
    await expect(e.loadCache()).resolves.toBeUndefined();
    await e.indexFile('src/auth.ts', SRC, 'A');
    await expect(e.persistCache()).resolves.toBeUndefined();
  });
});
