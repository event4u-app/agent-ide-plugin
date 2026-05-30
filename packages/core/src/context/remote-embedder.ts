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

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const res = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.config.model }),
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
