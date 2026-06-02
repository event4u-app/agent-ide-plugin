import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmbeddingCacheStore } from './embedding-cache-store.js';
import { FakeEmbedder } from './embedder.js';

describe('EmbeddingCacheStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'embed-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const entry = (...vals: number[]) => Float32Array.from(vals);

  it('round-trips the content-hash → vector map losslessly', async () => {
    const embedder = new FakeEmbedder(4);
    const store = new EmbeddingCacheStore(dir);
    const map = new Map<string, Float32Array>([
      ['key-a', entry(0.1, 0.2, 0.3, 0.4)],
      ['key-b', entry(1, 0, -1, 0.5)],
    ]);

    await store.save(map, embedder);
    const loaded = await store.load(embedder);

    expect(loaded).toBeDefined();
    expect([...loaded!.keys()]).toEqual(['key-a', 'key-b']);
    // Float32 is lossy on arbitrary doubles, so compare against a Float32 round.
    expect([...loaded!.get('key-a')!]).toEqual([...entry(0.1, 0.2, 0.3, 0.4)]);
    expect([...loaded!.get('key-b')!]).toEqual([...entry(1, 0, -1, 0.5)]);
  });

  it('discards the file when the model id differs (council Q1=A header guard)', async () => {
    const store = new EmbeddingCacheStore(dir);
    await store.save(new Map([['k', entry(1, 2, 3, 4)]]), new FakeEmbedder(4));

    // Same dimensions, different model → vectors are not interchangeable.
    const otherModel = new FakeEmbedder(4);
    Object.defineProperty(otherModel, 'modelId', { value: 'voyage-3', configurable: true });
    expect(await store.load(otherModel)).toBeUndefined();
  });

  it('discards the file when the dimension differs', async () => {
    const store = new EmbeddingCacheStore(dir);
    await store.save(new Map([['k', entry(1, 2, 3, 4)]]), new FakeEmbedder(4));
    expect(await store.load(new FakeEmbedder(8))).toBeUndefined();
  });

  it('returns undefined for a missing file (cold cache, never throws)', async () => {
    const store = new EmbeddingCacheStore(join(dir, 'does-not-exist'));
    expect(await store.load(new FakeEmbedder(4))).toBeUndefined();
  });

  it('returns undefined for a corrupt file instead of throwing', async () => {
    const store = new EmbeddingCacheStore(dir);
    await writeFile(join(dir, 'cache.bin'), Buffer.from('not a valid cache buffer'));
    expect(await store.load(new FakeEmbedder(4))).toBeUndefined();
  });

  it('writes atomically — the target file appears, no temp left behind', async () => {
    const store = new EmbeddingCacheStore(dir);
    await store.save(new Map([['k', entry(1, 2, 3, 4)]]), new FakeEmbedder(4));

    // The real cache file exists and is non-empty …
    const buf = await readFile(join(dir, 'cache.bin'));
    expect(buf.length).toBeGreaterThan(0);
    // … and no `.tmp` sibling survived the rename.
    const tmp = join(dir, `cache.bin.${process.pid}.tmp`);
    await expect(readFile(tmp)).rejects.toThrow();
  });

  it('persists an empty map (zero keys) and reloads it as empty', async () => {
    const store = new EmbeddingCacheStore(dir);
    await store.save(new Map(), new FakeEmbedder(4));
    const loaded = await store.load(new FakeEmbedder(4));
    expect(loaded).toBeDefined();
    expect(loaded!.size).toBe(0);
  });
});
