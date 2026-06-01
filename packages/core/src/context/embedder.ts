import { throwIfAborted } from '../abort.js';
import { tokenizeCode } from './tokenize.js';

/**
 * T-801 — Embedder.
 *
 * The retrieval stack depends only on this interface; the model is an
 * implementation detail injected at construction. This is the seam that keeps
 * the unit-test suite free of model downloads and native runtimes — tests run
 * against {@link FakeEmbedder}.
 *
 * Implementations shipped here:
 *   - {@link FakeEmbedder}        — deterministic, dependency-free; cosine ≈ token
 *                                   overlap, so hybrid-retrieval tests are meaningful.
 *   - {@link TransformersEmbedder} — local ONNX via `@huggingface/transformers`,
 *                                   lazy-loaded so it is **optional**. The package
 *                                   pulls native deps (`onnxruntime-node`, `sharp`),
 *                                   which the project deliberately keeps out of the
 *                                   default install graph (same call as the
 *                                   tracking-db JSONL-over-better-sqlite3 decision).
 *                                   Install it explicitly to enable local embeddings.
 *   - `RemoteEmbedder` (T-806, `remote-embedder.ts`) — voyage / openai over fetch;
 *                                   no native deps.
 */
export interface Embedder {
  /** Model identity — part of the embedding-cache key so a model swap invalidates it. */
  readonly modelId: string;
  /** Output vector dimensionality. */
  readonly dimensions: number;
  /**
   * Embed a batch of texts. Returned vectors are L2-normalized (cosine = dot
   * product). An optional `signal` lets a Stop abort the work (T-1305); on abort
   * the Promise rejects with the signal's reason (an `AbortError`).
   */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

/** L2-normalize a vector in place and return it (zero vector is left as-is). */
export function l2normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
  }
  return vec;
}

/**
 * Deterministic, dependency-free embedder for tests and as a graceful fallback.
 * Hashes each code token into a fixed-width bag-of-tokens vector, then
 * L2-normalizes — so two texts that share tokens have a high cosine and the
 * hybrid/vector tests exercise real ranking behaviour without a model.
 */
export class FakeEmbedder implements Embedder {
  readonly modelId: string;
  constructor(readonly dimensions = 64) {
    this.modelId = `fake-${dimensions}`;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    throwIfAborted(signal);
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    for (const token of tokenizeCode(text)) {
      vec[hashToken(token) % this.dimensions]! += 1;
    }
    return l2normalize(vec);
  }
}

/** FNV-1a — small, fast, deterministic, no dependency. */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Default local model — 384-dim, strong retrieval quality for its size (council pick). */
export const DEFAULT_LOCAL_MODEL = 'Xenova/bge-small-en-v1.5';

/**
 * Local ONNX embedder backed by `@huggingface/transformers`. The package is an
 * **optional** runtime dependency (native `onnxruntime-node` + `sharp`), so it
 * is loaded via dynamic `import()` and only when local embeddings are actually
 * requested. If it is not installed, construction-time `init()` throws a clear
 * actionable error rather than failing the build.
 */
export class TransformersEmbedder implements Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  // The pipeline is `any` on purpose: the package is not in the type graph.
  private pipe: ((texts: string[], opts: unknown) => Promise<unknown>) | undefined;

  constructor(opts: { model?: string; dimensions?: number } = {}) {
    this.modelId = opts.model ?? DEFAULT_LOCAL_MODEL;
    this.dimensions = opts.dimensions ?? 384;
  }

  /** Lazily load the optional package and warm the feature-extraction pipeline. */
  async init(): Promise<void> {
    if (this.pipe) return;
    let mod: { pipeline: (task: string, model: string) => Promise<unknown> };
    try {
      // Non-literal specifier so the type-checker does not resolve the optional,
      // un-installed package (it is intentionally absent from the dep graph).
      const spec = '@huggingface/transformers';
      mod = (await import(spec)) as typeof mod;
    } catch {
      throw new Error(
        'Local embeddings require the optional "@huggingface/transformers" package. ' +
          'Install it (pnpm add @huggingface/transformers) or use a RemoteEmbedder / FakeEmbedder.',
      );
    }
    const extractor = (await mod.pipeline('feature-extraction', this.modelId)) as (
      texts: string[],
      opts: unknown,
    ) => Promise<unknown>;
    this.pipe = extractor;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    throwIfAborted(signal);
    await this.init();
    throwIfAborted(signal);
    const output = (await this.pipe!(texts, { pooling: 'mean', normalize: true })) as {
      tolist: () => number[][];
    };
    return output.tolist().map((row) => l2normalize(Float32Array.from(row)));
  }
}
