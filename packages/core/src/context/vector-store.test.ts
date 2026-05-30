import { describe, expect, it } from 'vitest';
import { FakeEmbedder } from './embedder.js';
import { VectorStore, dot, type VectorEntryInput } from './vector-store.js';

const embedder = new FakeEmbedder(64);

async function entry(chunkId: string, filePath: string, text: string): Promise<VectorEntryInput> {
  const [embedding] = await embedder.embed([text]);
  return { chunkId, filePath, startLine: 0, endLine: 1, embedding: embedding! };
}

describe('dot', () => {
  it('is the cosine similarity for unit vectors', async () => {
    const [a, b] = await embedder.embed(['same tokens here', 'same tokens here']);
    expect(dot(a!, b!)).toBeCloseTo(1, 6);
  });
});

describe('VectorStore', () => {
  it('ranks by cosine similarity, scoped to roots', async () => {
    const store = new VectorStore(64);
    store.setFileVectors('A', 'auth.ts', [
      await entry('a1', 'auth.ts', 'authenticate user login session token'),
    ]);
    store.setFileVectors('B', 'billing.ts', [
      await entry('b1', 'billing.ts', 'invoice billing amount payment refund'),
    ]);

    const [q] = await embedder.embed(['user login authentication session']);
    const all = store.query(q!, 5);
    expect(all[0]?.chunkId).toBe('a1'); // auth is the closest

    const onlyB = store.query(q!, 5, ['B']);
    expect(onlyB.every((h) => h.rootId === 'B')).toBe(true);

    expect(store.query(q!, 5, [])).toEqual([]); // explicit empty scope
    expect(store.query(q!, 0)).toEqual([]);
  });

  it('drops a file or a whole root segment', async () => {
    const store = new VectorStore(64);
    store.setFileVectors('A', 'a.ts', [await entry('a1', 'a.ts', 'alpha beta gamma')]);
    store.setFileVectors('A', 'b.ts', [await entry('a2', 'b.ts', 'delta epsilon')]);
    store.setFileVectors('B', 'c.ts', [await entry('b1', 'c.ts', 'zeta eta')]);
    expect(store.size).toBe(3);

    store.removeFile('A', 'b.ts');
    expect(store.size).toBe(2);
    store.removeRoot('A');
    expect(store.size).toBe(1);
  });

  it('round-trips through toBuffer / fromBuffer losslessly', async () => {
    const store = new VectorStore(64);
    store.setFileVectors('A', 'auth.ts', [
      await entry('a1', 'auth.ts', 'authenticate user login'),
      await entry('a2', 'auth.ts', 'logout and revoke token'),
    ]);
    store.setFileVectors('B', 'pay.ts', [await entry('b1', 'pay.ts', 'charge a card')]);

    const restored = VectorStore.fromBuffer(store.toBuffer());
    expect(restored.size).toBe(3);

    const [q] = await embedder.embed(['user login authenticate']);
    expect(restored.query(q!, 3)).toEqual(store.query(q!, 3));
  });
});
