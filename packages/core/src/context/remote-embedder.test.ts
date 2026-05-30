import { describe, expect, it, vi } from 'vitest';
import { FakeEmbedder, TransformersEmbedder } from './embedder.js';
import { RemoteEmbedder, createEmbedder } from './remote-embedder.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('RemoteEmbedder', () => {
  it('posts to the provider endpoint and returns normalized vectors in order', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [{ embedding: [3, 4] }, { embedding: [0, 5] }],
      }),
    );
    const e = new RemoteEmbedder(
      { provider: 'voyage', apiKey: 'k', model: 'voyage-code-3', dimensions: 2 },
      fetchFn,
    );
    const [a, b] = await e.embed(['x', 'y']);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toContain('voyageai.com');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    // [3,4] normalized → [0.6, 0.8]; unit length.
    expect(a![0]).toBeCloseTo(0.6, 5);
    expect(a![1]).toBeCloseTo(0.8, 5);
    expect(b![0]).toBeCloseTo(0, 5);
    expect(e.modelId).toBe('voyage:voyage-code-3');
  });

  it('throws on a non-OK response and on a shape mismatch', async () => {
    const fail = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 2 },
      async () => jsonResponse({}, false, 429),
    );
    await expect(fail.embed(['x'])).rejects.toThrow(/429/);

    const mismatch = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 2 },
      async () => jsonResponse({ data: [] }),
    );
    await expect(mismatch.embed(['x'])).rejects.toThrow(/shape mismatch/);
  });

  it('returns [] for an empty batch without calling fetch', async () => {
    const fetchFn = vi.fn();
    const e = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 2 },
      fetchFn,
    );
    expect(await e.embed([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('createEmbedder', () => {
  it('defaults to the dependency-free FakeEmbedder', () => {
    expect(createEmbedder()).toBeInstanceOf(FakeEmbedder);
    expect(createEmbedder({ provider: 'fake' })).toBeInstanceOf(FakeEmbedder);
  });

  it('falls back to FakeEmbedder when a remote provider has no API key', () => {
    expect(createEmbedder({ provider: 'voyage' })).toBeInstanceOf(FakeEmbedder);
  });

  it('builds a RemoteEmbedder when an API key is present', () => {
    expect(createEmbedder({ provider: 'openai', apiKey: 'k' })).toBeInstanceOf(RemoteEmbedder);
  });

  it('builds the local TransformersEmbedder for provider=local', () => {
    expect(createEmbedder({ provider: 'local' })).toBeInstanceOf(TransformersEmbedder);
  });
});
