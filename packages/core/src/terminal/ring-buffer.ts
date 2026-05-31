import type { OutputChunk, ReplaySlice } from './types.js';

/**
 * Dual-capped, append-only output buffer for one terminal session (T-902).
 *
 * Two caps (AI council, 2026-05-31): UTF-8 BYTES protect sidecar memory; `\n`
 * LINES keep the buffer human-useful and bound renderer cost. `seq` is
 * monotonic PER CHUNK (not per line — PTY output has partial lines, CR
 * redraws, and ANSI clears, so a line count is a soft heuristic, not an index).
 * Eviction drops whole oldest chunks and surfaces the loss as
 * `droppedChunks` / `droppedBytes`; a replay below `firstSeqAvailable` sets
 * `restartRequired` so a reconnecting renderer cold-boots instead of appending.
 *
 * The most-recent chunk is always retained even if it alone exceeds a cap — a
 * single 11 MB write does not silently empty the buffer.
 */
export interface RingBufferOptions {
  /** Max retained `\n`-counted lines (default 5000, PLAN.md §8.9.2). */
  maxLines?: number;
  /** Max retained UTF-8 bytes (default 10 MiB, PLAN.md §8.9.2). */
  maxBytes?: number;
  /** ISO-8601 clock, injected for deterministic tests. */
  now?: () => string;
}

interface StoredChunk {
  chunk: OutputChunk;
  bytes: number;
  lines: number;
}

const DEFAULT_MAX_LINES = 5000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

export class OutputRingBuffer {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly now: () => string;

  private stored: StoredChunk[] = [];
  private totalBytes = 0;
  private totalLines = 0;
  private nextSeqValue = 0;
  private firstSeqAvailableValue = 0;
  private droppedChunksValue = 0;
  private droppedBytesValue = 0;

  constructor(options: RingBufferOptions = {}) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Append a raw output chunk, assign its seq, evict over-cap, return it. */
  push(data: string): OutputChunk {
    const seq = this.nextSeqValue++;
    const chunk: OutputChunk = { seq, data, at: this.now() };
    const bytes = Buffer.byteLength(data, 'utf8');
    const lines = countNewlines(data);

    this.stored.push({ chunk, bytes, lines });
    this.totalBytes += bytes;
    this.totalLines += lines;

    // Evict oldest while over either cap, but never drop the last chunk.
    while (
      this.stored.length > 1 &&
      (this.totalBytes > this.maxBytes || this.totalLines > this.maxLines)
    ) {
      const dropped = this.stored.shift();
      if (!dropped) break;
      this.totalBytes -= dropped.bytes;
      this.totalLines -= dropped.lines;
      this.droppedChunksValue++;
      this.droppedBytesValue += dropped.bytes;
      this.firstSeqAvailableValue = this.stored[0]?.chunk.seq ?? this.nextSeqValue;
    }

    return chunk;
  }

  /**
   * Replay every retained chunk with `seq >= fromSeq`. If `fromSeq` is below the
   * oldest retained seq, the gap was evicted → `restartRequired` is set and the
   * caller receives everything still in the window.
   */
  since(fromSeq: number): ReplaySlice {
    const restartRequired = fromSeq < this.firstSeqAvailableValue;
    const effectiveFrom = Math.max(fromSeq, this.firstSeqAvailableValue);
    const chunks = this.stored.filter((s) => s.chunk.seq >= effectiveFrom).map((s) => s.chunk);
    return {
      chunks,
      droppedChunks: this.droppedChunksValue,
      droppedBytes: this.droppedBytesValue,
      firstSeqAvailable: this.firstSeqAvailableValue,
      nextSeq: this.nextSeqValue,
      restartRequired,
    };
  }

  /** Full retained snapshot (== `since(0)`). */
  snapshot(): ReplaySlice {
    return this.since(0);
  }

  get nextSeq(): number {
    return this.nextSeqValue;
  }
  get firstSeqAvailable(): number {
    return this.firstSeqAvailableValue;
  }
  get retainedChunks(): number {
    return this.stored.length;
  }
  get bytes(): number {
    return this.totalBytes;
  }
  get lines(): number {
    return this.totalLines;
  }
  get droppedChunks(): number {
    return this.droppedChunksValue;
  }
  get droppedBytes(): number {
    return this.droppedBytesValue;
  }
}
