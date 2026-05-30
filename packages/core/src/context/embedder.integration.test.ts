import { describe, expect, it } from 'vitest';
import { TransformersEmbedder } from './embedder.js';
import { dot } from './vector-store.js';

/**
 * Real-model smoke for the optional local embedder. Skipped by default — it
 * needs the optional `@huggingface/transformers` package (native onnxruntime +
 * sharp) installed and downloads the BGE model on first run, neither of which
 * belongs in the standard CI matrix. Enable explicitly:
 *
 *   pnpm add @huggingface/transformers
 *   RUN_EMBEDDING_INTEGRATION=1 pnpm --filter @event4u-agent/core test
 */
describe.skipIf(!process.env.RUN_EMBEDDING_INTEGRATION)('TransformersEmbedder (real model)', () => {
  it('embeds with 384 dims and ranks semantically-related text higher', async () => {
    const e = new TransformersEmbedder();
    const [auth, related, unrelated] = await e.embed([
      'function authenticateUser validates the session token',
      'user login and session verification logic',
      'compute the invoice total and apply tax',
    ]);
    expect(auth!.length).toBe(384);
    expect(dot(auth!, related!)).toBeGreaterThan(dot(auth!, unrelated!));
  }, 120_000);
});
