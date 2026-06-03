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

/**
 * Usage signal for ONE real remote embed call (T-806 follow-up, ADR-053).
 * Local / fake embedders are free and never emit it. The tracking layer turns
 * each into an `activity: "context-compression"` step event; this transport
 * only reports the count, keeping the {@link Embedder} interface unchanged.
 */
export interface EmbedUsage {
  /** Provider-billed tokens for this call (input only — embeddings have no output). */
  tokens: number;
  /** `${provider}:${model}` — the pricing-book + step-event model id. */
  model: string;
  /** Texts embedded in this call (cache-misses for an index batch; 1 per query). */
  batch: number;
}

export type EmbedUsageCallback = (usage: EmbedUsage) => void;

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
    /** ADR-053 — fired once per real call with the provider-billed token count. */
    private readonly onUsage?: EmbedUsageCallback,
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
    const json = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
      usage?: { total_tokens?: number; prompt_tokens?: number };
    };
    const rows = json.data;
    if (!rows || rows.length !== texts.length) {
      throw new Error(`Embedding response shape mismatch (${this.config.provider})`);
    }
    // Cost accounting (ADR-053). Voyage returns `usage.total_tokens`, OpenAI
    // `usage.total_tokens` (== prompt_tokens for embeddings). Fail-soft: a
    // throwing tracker must NEVER break the embed — embeddings are an optional
    // enhancement over BM25, and an abort already rejected above.
    if (this.onUsage) {
      const tokens = json.usage?.total_tokens ?? json.usage?.prompt_tokens ?? 0;
      try {
        this.onUsage({ tokens, model: this.modelId, batch: texts.length });
      } catch {
        // accounting is best-effort; the vectors are what the caller needs.
      }
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
export function createEmbedder(
  config: EmbeddingsConfig = {},
  fetchFn?: FetchFn,
  onUsage?: EmbedUsageCallback,
): Embedder {
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
        onUsage,
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
  onUsage?: EmbedUsageCallback,
): Embedder | undefined {
  switch (config.provider) {
    case 'local':
      // `onUsage` is a remote-only signal (free local embeds emit nothing).
      return createEmbedder(config, fetchFn);
    case 'voyage':
    case 'openai':
      return config.apiKey ? createEmbedder(config, fetchFn, onUsage) : undefined;
    default:
      return undefined;
  }
}
