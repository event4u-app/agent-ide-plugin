/**
 * T-802 — Vector store.
 *
 * In-memory, per-root, brute-force cosine over L2-normalized embeddings (cosine
 * = dot product). Council-sized: 100k chunks × 384-dim ≈ 150 MB resident, and a
 * brute-force scan is sub-30 ms at that scale — an ANN index is only worth it
 * past ~300–500k chunks, deferred to a later phase.
 *
 * Persistence is a compact packed-Float32 `Buffer` (a JSON header + a binary
 * payload), NOT `node:sqlite`: the CI matrix includes Node 20, where
 * `node:sqlite` does not exist (added in 22.5), and `sqlite-vec` is a native
 * extension. This mirrors the deliberate no-native-deps call already made for
 * token-tracking persistence (JSONL over better-sqlite3).
 *
 * Scope semantics match the BM25 retriever (T-MR05): `rootIds` omitted = all
 * roots, `[]` = no roots.
 */

export interface VectorEntryInput {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  /** L2-normalized embedding. */
  embedding: Float32Array;
}

export interface VectorHit {
  chunkId: string;
  rootId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  /** Cosine similarity in [-1, 1] (dot product of unit vectors). */
  score: number;
}

interface StoredEntry extends VectorEntryInput {
  rootId: string;
}

export class VectorStore {
  /** rootId → filePath → entries. */
  private readonly byRoot = new Map<string, Map<string, StoredEntry[]>>();

  constructor(readonly dimensions: number) {}

  /** Replace all vectors for one file in a root segment. */
  setFileVectors(rootId: string, filePath: string, entries: VectorEntryInput[]): void {
    let files = this.byRoot.get(rootId);
    if (!files) {
      files = new Map();
      this.byRoot.set(rootId, files);
    }
    files.set(
      filePath,
      entries.map((e) => ({ ...e, rootId })),
    );
  }

  removeFile(rootId: string, filePath: string): void {
    this.byRoot.get(rootId)?.delete(filePath);
  }

  removeRoot(rootId: string): void {
    this.byRoot.delete(rootId);
  }

  get size(): number {
    let total = 0;
    for (const files of this.byRoot.values()) {
      for (const entries of files.values()) total += entries.length;
    }
    return total;
  }

  /**
   * Top-`k` chunks by cosine similarity, scoped to `rootIds` (omitted = all,
   * `[]` = none). Deterministic ordering: score desc, then rootId / filePath /
   * startLine ascending.
   */
  query(queryEmbedding: Float32Array, k: number, rootIds?: string[]): VectorHit[] {
    if (rootIds && rootIds.length === 0) return [];
    if (k <= 0) return [];
    const scope = rootIds ?? [...this.byRoot.keys()];

    const hits: VectorHit[] = [];
    for (const rootId of scope) {
      const files = this.byRoot.get(rootId);
      if (!files) continue;
      for (const entries of files.values()) {
        for (const e of entries) {
          hits.push({
            chunkId: e.chunkId,
            rootId: e.rootId,
            filePath: e.filePath,
            startLine: e.startLine,
            endLine: e.endLine,
            score: dot(queryEmbedding, e.embedding),
          });
        }
      }
    }
    hits.sort(cmpHit);
    return hits.slice(0, k);
  }

  /**
   * Serialize to a compact buffer: a JSON header (metadata, in order) followed
   * by the packed little-endian Float32 payload. Round-trips losslessly.
   */
  toBuffer(): Buffer {
    const meta: Array<Omit<StoredEntry, 'embedding'>> = [];
    const vectors: Float32Array[] = [];
    for (const files of this.byRoot.values()) {
      for (const entries of files.values()) {
        for (const e of entries) {
          const { embedding, ...rest } = e;
          meta.push(rest);
          vectors.push(embedding);
        }
      }
    }
    const header = Buffer.from(JSON.stringify({ dimensions: this.dimensions, meta }), 'utf8');
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(header.length, 0);
    const payload = Buffer.alloc(vectors.length * this.dimensions * 4);
    let offset = 0;
    for (const vec of vectors) {
      for (let i = 0; i < this.dimensions; i++) {
        payload.writeFloatLE(vec[i] ?? 0, offset);
        offset += 4;
      }
    }
    return Buffer.concat([headerLen, header, payload]);
  }

  /** Reconstruct a store from {@link toBuffer} output. */
  static fromBuffer(buf: Buffer): VectorStore {
    const headerLen = buf.readUInt32LE(0);
    const header = JSON.parse(buf.toString('utf8', 4, 4 + headerLen)) as {
      dimensions: number;
      meta: Array<Omit<StoredEntry, 'embedding'>>;
    };
    const store = new VectorStore(header.dimensions);
    let offset = 4 + headerLen;
    const dim = header.dimensions;
    // Group restored entries back by root + file, preserving order.
    const grouped = new Map<string, Map<string, VectorEntryInput[]>>();
    for (const m of header.meta) {
      const embedding = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        embedding[i] = buf.readFloatLE(offset);
        offset += 4;
      }
      let files = grouped.get(m.rootId);
      if (!files) {
        files = new Map();
        grouped.set(m.rootId, files);
      }
      const list = files.get(m.filePath) ?? [];
      list.push({
        chunkId: m.chunkId,
        filePath: m.filePath,
        startLine: m.startLine,
        endLine: m.endLine,
        embedding,
      });
      files.set(m.filePath, list);
    }
    for (const [rootId, files] of grouped) {
      for (const [filePath, entries] of files) store.setFileVectors(rootId, filePath, entries);
    }
    return store;
  }
}

/** Dot product — cosine similarity for unit vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

function cmpHit(a: VectorHit, b: VectorHit): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.rootId !== b.rootId) return a.rootId < b.rootId ? -1 : 1;
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  return a.startLine - b.startLine;
}
