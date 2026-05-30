import { describe, expect, it } from 'vitest';
import { FakeEmbedder, TransformersEmbedder, l2normalize } from './embedder.js';

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

describe('l2normalize', () => {
  it('scales a vector to unit length and leaves the zero vector alone', () => {
    const v = l2normalize(Float32Array.from([3, 4]));
    expect(dot(v, v)).toBeCloseTo(1, 6);
    expect(l2normalize(new Float32Array(4))).toEqual(new Float32Array(4));
  });
});

describe('FakeEmbedder', () => {
  it('is deterministic and produces unit vectors', async () => {
    const e = new FakeEmbedder(64);
    const [a1] = await e.embed(['export function loginUser() {}']);
    const [a2] = await e.embed(['export function loginUser() {}']);
    expect(Array.from(a1!)).toEqual(Array.from(a2!));
    expect(dot(a1!, a1!)).toBeCloseTo(1, 6);
    expect(e.dimensions).toBe(64);
    expect(e.modelId).toBe('fake-64');
  });

  it('gives higher cosine to token-overlapping texts than to disjoint ones', async () => {
    const e = new FakeEmbedder(256);
    const [auth, authSimilar, billing] = await e.embed([
      'function authenticate user login session token',
      'user login authentication session handler',
      'invoice billing amount payment refund total',
    ]);
    expect(dot(auth!, authSimilar!)).toBeGreaterThan(dot(auth!, billing!));
  });
});

describe('TransformersEmbedder', () => {
  it('throws an actionable error when the optional package is absent', async () => {
    // @huggingface/transformers is intentionally NOT in the dependency graph, so
    // init() must fail with guidance rather than a raw module-not-found.
    const e = new TransformersEmbedder();
    await expect(e.embed(['x'])).rejects.toThrow(/@huggingface\/transformers/);
    expect(e.dimensions).toBe(384);
  });
});
