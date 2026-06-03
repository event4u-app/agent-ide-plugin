import { describe, expect, it, vi } from 'vitest';
import { FakeEmbedder, TransformersEmbedder } from './embedder.js';
import { RemoteEmbedder, createEmbedder, resolveActiveEmbedder } from './remote-embedder.js';

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

describe('RemoteEmbedder usage accounting (ADR-053)', () => {
  it('fires onUsage with the provider-billed tokens, model id, and batch size', async () => {
    const onUsage = vi.fn();
    const e = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'text-embedding-3-small', dimensions: 2 },
      async () => jsonResponse({ data: [{ embedding: [3, 4] }], usage: { total_tokens: 42 } }),
      onUsage,
    );
    await e.embed(['x']);
    expect(onUsage).toHaveBeenCalledWith({
      tokens: 42,
      model: 'openai:text-embedding-3-small',
      batch: 1,
    });
  });

  it('falls back to prompt_tokens, then 0, when total_tokens is absent', async () => {
    const seen: number[] = [];
    const onUsage = (u: { tokens: number }) => void seen.push(u.tokens);
    const promptOnly = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 2 },
      async () => jsonResponse({ data: [{ embedding: [1, 0] }], usage: { prompt_tokens: 7 } }),
      onUsage,
    );
    await promptOnly.embed(['x']);
    const noUsage = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 2 },
      async () => jsonResponse({ data: [{ embedding: [1, 0] }] }),
      onUsage,
    );
    await noUsage.embed(['x']);
    expect(seen).toEqual([7, 0]);
  });

  it('is fail-soft — a throwing onUsage never breaks the embed', async () => {
    const e = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 2 },
      async () => jsonResponse({ data: [{ embedding: [3, 4] }], usage: { total_tokens: 9 } }),
      () => {
        throw new Error('tracking exploded');
      },
    );
    const [v] = await e.embed(['x']);
    expect(v![0]).toBeCloseTo(0.6, 5);
  });

  it('threads onUsage through resolveActiveEmbedder for a keyed remote provider', async () => {
    const onUsage = vi.fn();
    const e = resolveActiveEmbedder(
      { provider: 'voyage', apiKey: 'k', model: 'voyage-code-3', dimensions: 2 },
      async () => jsonResponse({ data: [{ embedding: [0, 1] }], usage: { total_tokens: 5 } }),
      onUsage,
    );
    await e!.embed(['q']);
    expect(onUsage).toHaveBeenCalledWith({ tokens: 5, model: 'voyage:voyage-code-3', batch: 1 });
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

describe('resolveActiveEmbedder (composition-root gate, ADR-044)', () => {
  it('returns undefined for an absent / empty config (stays BM25-only)', () => {
    expect(resolveActiveEmbedder()).toBeUndefined();
    expect(resolveActiveEmbedder({})).toBeUndefined();
  });

  it('returns undefined for provider=fake — never fuses fake vectors in prod', () => {
    expect(resolveActiveEmbedder({ provider: 'fake' })).toBeUndefined();
    expect(resolveActiveEmbedder({ provider: 'fake', dimensions: 128 })).toBeUndefined();
  });

  it('returns undefined for a keyless remote provider (no degraded fallback)', () => {
    expect(resolveActiveEmbedder({ provider: 'voyage' })).toBeUndefined();
    expect(resolveActiveEmbedder({ provider: 'openai' })).toBeUndefined();
  });

  it('builds a RemoteEmbedder only when a keyed remote provider is set', () => {
    expect(resolveActiveEmbedder({ provider: 'voyage', apiKey: 'k' })).toBeInstanceOf(
      RemoteEmbedder,
    );
    expect(resolveActiveEmbedder({ provider: 'openai', apiKey: 'k' })).toBeInstanceOf(
      RemoteEmbedder,
    );
  });

  it('builds the local TransformersEmbedder for provider=local', () => {
    expect(resolveActiveEmbedder({ provider: 'local' })).toBeInstanceOf(TransformersEmbedder);
  });
});
