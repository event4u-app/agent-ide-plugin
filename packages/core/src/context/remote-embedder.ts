import { throwIfAborted } from '../abort.js';
import { FakeEmbedder, TransformersEmbedder, l2normalize, type Embedder } from './embedder.js';

/**
 * T-806 — Optional remote embedding.
 *
 * `RemoteEmbedder` calls a hosted embeddings API (Voyage or OpenAI-compatible)
 * over `fetch` — no native deps, so it ships in the default build unlike the
 * local ONNX path. Selected via `context.embeddings.provider` in
 * `.agent-settings.yml`; `local` (or `fake` for tests) stays the default.
 *
 * Hard-Cap note: when the engine is wired to the token-tracking layer, each
 * remote embed is a step event with `activity: "context-compression"`. That
 * accounting lives in the tracking layer; this class is the transport.
 */

export type EmbeddingProvider = 'fake' | 'local' | 'voyage' | 'openai';

export interface RemoteEmbedderConfig {
  provider: 'voyage' | 'openai';
  apiKey: string;
  model: string;
  dimensions: number;
  /** Override the endpoint (defaults per provider); handy for proxies + tests. */
  endpoint?: string;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const ENDPOINTS: Record<RemoteEmbedderConfig['provider'], string> = {
  voyage: 'https://api.voyageai.com/v1/embeddings',
  openai: 'https://api.openai.com/v1/embeddings',
};

export class RemoteEmbedder implements Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  private readonly endpoint: string;

  constructor(
    private readonly config: RemoteEmbedderConfig,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {
    this.modelId = `${config.provider}:${config.model}`;
    this.dimensions = config.dimensions;
    this.endpoint = config.endpoint ?? ENDPOINTS[config.provider];
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    throwIfAborted(signal);
    const res = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.config.model }),
      // Stop aborts the in-flight HTTP request itself, not just at the boundary.
      signal,
    });
    if (!res.ok) {
      throw new Error(`Embedding request failed (${this.config.provider} ${res.status})`);
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const rows = json.data;
    if (!rows || rows.length !== texts.length) {
      throw new Error(`Embedding response shape mismatch (${this.config.provider})`);
    }
    // Both APIs preserve input order in `data`; normalize so cosine = dot product.
    return rows.map((r) => l2normalize(Float32Array.from(r.embedding)));
  }
}

/** Config shape under `.agent-settings.yml::context.embeddings`. */
export interface EmbeddingsConfig {
  provider?: EmbeddingProvider;
  model?: string;
  dimensions?: number;
  apiKey?: string;
  endpoint?: string;
}

/**
 * Build the configured embedder. Defaults to `fake` (deterministic, no deps) so
 * a missing/blank config never reaches for a network or a native runtime. A
 * `voyage`/`openai` provider without an `apiKey` falls back to `fake` rather
 * than throwing — embeddings are an optional enhancement over BM25.
 */
export function createEmbedder(config: EmbeddingsConfig = {}, fetchFn?: FetchFn): Embedder {
  switch (config.provider) {
    case 'local':
      return new TransformersEmbedder({ model: config.model, dimensions: config.dimensions });
    case 'voyage':
    case 'openai':
      if (!config.apiKey) return new FakeEmbedder(config.dimensions);
      return new RemoteEmbedder(
        {
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model ?? defaultRemoteModel(config.provider),
          dimensions: config.dimensions ?? 1024,
          endpoint: config.endpoint,
        },
        fetchFn,
      );
    default:
      return new FakeEmbedder(config.dimensions);
  }
}

function defaultRemoteModel(provider: 'voyage' | 'openai'): string {
  return provider === 'voyage' ? 'voyage-code-3' : 'text-embedding-3-small';
}

/**
 * Composition-root gate (ADR-044) — return a configured embedder ONLY when the
 * config selects a REAL one, else `undefined` so {@link ContextEngine} stays
 * BM25-only. Unlike {@link createEmbedder} (which always returns *some* embedder,
 * falling back to {@link FakeEmbedder}), the live sidecar must never fuse
 * meaningless `FakeEmbedder` hash-vectors into the production RRF — that is worse
 * than clean lexical-only retrieval (AI council 2026-06-02 Q2=A). `fake` and a
 * keyless `voyage`/`openai` therefore yield `undefined`; `local` and a keyed
 * remote yield the real embedder (Q3=A — `local`'s optional `@huggingface/
 * transformers` is dynamic-imported only on first embed, and the retrieve path
 * fails soft, so a missing dep degrades to BM25 rather than crashing).
 */
export function resolveActiveEmbedder(
  config: EmbeddingsConfig = {},
  fetchFn?: FetchFn,
): Embedder | undefined {
  switch (config.provider) {
    case 'local':
      return createEmbedder(config, fetchFn);
    case 'voyage':
    case 'openai':
      return config.apiKey ? createEmbedder(config, fetchFn) : undefined;
    default:
      return undefined;
  }
}
