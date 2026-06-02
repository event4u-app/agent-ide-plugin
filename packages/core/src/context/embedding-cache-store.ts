import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_VERSION } from './embedding-cache.js';
import type { Embedder } from './embedder.js';

/**
 * T-805 persistence (ADR-047) — durable backing for {@link EmbeddingCache}.
 *
 * The sidecar re-walks and re-indexes every file on every startup, so a cold
 * start would re-pay the (expensive) embed call for unchanged code. This store
 * persists the content-hash → vector map to disk so the startup re-walk hits
 * the cache instead. The on-disk artifact is a plain packed-Float32 `Buffer`
 * (a JSON header + a binary payload) — NOT `node:sqlite`/`sqlite-vec`: the CI
 * matrix includes Node 20 and the project forbids native deps, matching the
 * token-tracking (JSONL) and {@link VectorStore} (Buffer) precedents.
 *
 * Buffer layout (little-endian, cross-platform): a 4-byte header length, then
 * the UTF-8 JSON header `{ cacheVersion, modelId, dimensions, keys }`, then
 * `keys.length * dimensions` Float32LE values in `keys` order.
 *
 * Invalidation (AI council 2026-06-02 Q1=A): the header pins
 * `{ cacheVersion, modelId, dimensions }`; on any mismatch {@link load}
 * discards the whole file rather than returning vectors from a different model.
 */

const CACHE_FILE = 'cache.bin';

interface CacheHeader {
  cacheVersion: number;
  modelId: string;
  dimensions: number;
  keys: string[];
}

export class EmbeddingCacheStore {
  constructor(private readonly dir: string) {}

  /**
   * Read the persisted map, or `undefined` when the file is missing, corrupt,
   * or was written by a different model / cache version / dimension. Never
   * throws — a bad cache file must not break startup (the embed path just
   * rebuilds), so every failure mode degrades to a cold cache.
   */
  async load(embedder: Embedder): Promise<Map<string, Float32Array> | undefined> {
    try {
      const buf = await readFile(join(this.dir, CACHE_FILE));
      const headerLen = buf.readUInt32LE(0);
      const header = JSON.parse(buf.toString('utf8', 4, 4 + headerLen)) as CacheHeader;
      if (
        header.cacheVersion !== CACHE_VERSION ||
        header.modelId !== embedder.modelId ||
        header.dimensions !== embedder.dimensions
      ) {
        return undefined;
      }
      const dim = header.dimensions;
      const map = new Map<string, Float32Array>();
      let offset = 4 + headerLen;
      for (const key of header.keys) {
        const vec = new Float32Array(dim);
        for (let i = 0; i < dim; i++) {
          vec[i] = buf.readFloatLE(offset);
          offset += 4;
        }
        map.set(key, vec);
      }
      return map;
    } catch {
      return undefined;
    }
  }

  /**
   * Persist `entries` atomically: write a uniquely-named temp file then
   * `rename` it over the target, so a crash or a second sidecar on the same
   * workspace can never observe a torn file (AI council Q4 — last writer wins).
   * The pid-tagged temp name keeps concurrent writers from colliding.
   */
  async save(entries: ReadonlyMap<string, Float32Array>, embedder: Embedder): Promise<void> {
    const dim = embedder.dimensions;
    const keys = [...entries.keys()];
    const header = Buffer.from(
      JSON.stringify({
        cacheVersion: CACHE_VERSION,
        modelId: embedder.modelId,
        dimensions: dim,
        keys,
      } satisfies CacheHeader),
      'utf8',
    );
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(header.length, 0);
    const payload = Buffer.alloc(keys.length * dim * 4);
    let offset = 0;
    for (const key of keys) {
      const vec = entries.get(key)!;
      for (let i = 0; i < dim; i++) {
        payload.writeFloatLE(vec[i] ?? 0, offset);
        offset += 4;
      }
    }
    const out = Buffer.concat([headerLen, header, payload]);
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `${CACHE_FILE}.${process.pid}.tmp`);
    await writeFile(tmp, out);
    await rename(tmp, join(this.dir, CACHE_FILE));
  }
}
