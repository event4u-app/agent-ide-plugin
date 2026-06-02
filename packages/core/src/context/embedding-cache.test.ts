import { describe, expect, it, vi } from 'vitest';
import { EmbeddingCache, chunkKey } from './embedding-cache.js';
import { FakeEmbedder } from './embedder.js';

describe('chunkKey', () => {
  it('is stable for identical text+model and differs across models', () => {
    expect(chunkKey('abc', 'm1')).toBe(chunkKey('abc', 'm1'));
    expect(chunkKey('abc', 'm1')).not.toBe(chunkKey('abc', 'm2'));
    expect(chunkKey('abc', 'm1')).not.toBe(chunkKey('abd', 'm1'));
  });
});

describe('EmbeddingCache', () => {
  it('embeds each unique text once and serves the rest from cache', async () => {
    const fake = new FakeEmbedder(32);
    const spy = vi.spyOn(fake, 'embed');
    const cache = new EmbeddingCache(fake);

    await cache.embed(['a', 'b', 'a']); // 'a' duplicated → 2 unique
    expect(cache.totalMisses).toBe(2);
    expect(cache.size).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1); // one batched call for the 2 misses

    await cache.embed(['a', 'b']); // all cached
    expect(cache.totalMisses).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-embeds only the changed chunks on an incremental update', async () => {
    const fake = new FakeEmbedder(32);
    const cache = new EmbeddingCache(fake);

    // A "file" of 10 chunks.
    const chunks = Array.from({ length: 10 }, (_, i) => `chunk number ${i} body`);
    await cache.embed(chunks);
    expect(cache.totalMisses).toBe(10);

    // Edit changes 2 chunks; re-embed the whole file → only 2 cache misses.
    const edited = [...chunks];
    edited[3] = 'chunk number 3 body EDITED';
    edited[7] = 'chunk number 7 body EDITED too';
    await cache.embed(edited);
    expect(cache.totalMisses).toBe(12); // 10 + 2
  });

  it('returns vectors in input order, including duplicates', async () => {
    const cache = new EmbeddingCache(new FakeEmbedder(64));
    const [v0, v1, v2] = await cache.embed(['alpha bravo', 'charlie delta', 'alpha bravo']);
    expect(Array.from(v0!)).toEqual(Array.from(v2!)); // duplicate input → same vector
    expect(Array.from(v0!)).not.toEqual(Array.from(v1!)); // distinct text → distinct vector
  });
});

describe('EmbeddingCache — persistence (ADR-047)', () => {
  it('seed() serves a persisted vector without re-embedding', async () => {
    const fake = new FakeEmbedder(32);
    const spy = vi.spyOn(fake, 'embed');
    const cache = new EmbeddingCache(fake);

    cache.seed(new Map([[chunkKey('cached text', fake.modelId), Float32Array.from([1, 2, 3])]]));
    const [vec] = await cache.embed(['cached text']);

    expect(Array.from(vec!)).toEqual([1, 2, 3]); // served from the seed
    expect(cache.totalMisses).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('seed() never clobbers an embedding produced this session', async () => {
    const fake = new FakeEmbedder(32);
    const cache = new EmbeddingCache(fake);

    const [fresh] = await cache.embed(['live text']); // real embed lands first
    cache.seed(new Map([[chunkKey('live text', fake.modelId), Float32Array.from([9, 9, 9])]]));
    const [again] = await cache.embed(['live text']);

    expect(Array.from(again!)).toEqual(Array.from(fresh!)); // seed ignored for an existing key
  });

  it('snapshot() returns only keys touched this session (bounds growth)', async () => {
    const fake = new FakeEmbedder(32);
    const cache = new EmbeddingCache(fake);

    // A stale entry seeded from a previous session, plus a live lookup.
    const staleKey = chunkKey('off-branch chunk', fake.modelId);
    cache.seed(new Map([[staleKey, Float32Array.from([0, 0, 0])]]));
    await cache.embed(['current chunk']);

    const snap = cache.snapshot();
    expect(snap.has(chunkKey('current chunk', fake.modelId))).toBe(true);
    expect(snap.has(staleKey)).toBe(false); // never looked up → dropped on save
  });
});
