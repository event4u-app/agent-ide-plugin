import { describe, expect, it } from 'vitest';
import { OutputRingBuffer } from './ring-buffer.js';

function fixedClock(): () => string {
  let t = 0;
  const base = Date.parse('2026-01-01T00:00:00Z');
  return () => new Date(base + t++ * 1000).toISOString();
}

describe('OutputRingBuffer', () => {
  it('assigns monotonic per-chunk seq starting at 0', () => {
    const buf = new OutputRingBuffer({ now: fixedClock() });
    expect(buf.push('a').seq).toBe(0);
    expect(buf.push('b').seq).toBe(1);
    expect(buf.push('c').seq).toBe(2);
    expect(buf.nextSeq).toBe(3);
  });

  it('counts \\n lines, not rendered rows', () => {
    const buf = new OutputRingBuffer({ now: fixedClock() });
    buf.push('one\ntwo\n'); // 2 newlines
    buf.push('no-newline-tail'); // 0
    expect(buf.lines).toBe(2);
  });

  it('measures UTF-8 byte length, not string length', () => {
    const buf = new OutputRingBuffer({ now: fixedClock() });
    buf.push('€'); // 1 char, 3 UTF-8 bytes
    expect(buf.bytes).toBe(3);
  });

  it('evicts oldest chunks over the line cap and surfaces loss metadata', () => {
    const buf = new OutputRingBuffer({ maxLines: 3, now: fixedClock() });
    buf.push('l1\n');
    buf.push('l2\n');
    buf.push('l3\n');
    buf.push('l4\n'); // now 4 lines > cap 3 → drop oldest
    expect(buf.droppedChunks).toBe(1);
    expect(buf.firstSeqAvailable).toBe(1);
    const slice = buf.snapshot();
    expect(slice.chunks.map((c) => c.data)).toEqual(['l2\n', 'l3\n', 'l4\n']);
  });

  it('evicts over the byte cap', () => {
    const buf = new OutputRingBuffer({ maxBytes: 10, now: fixedClock() });
    buf.push('aaaaa'); // 5
    buf.push('bbbbb'); // 10 total
    buf.push('ccccc'); // 15 > 10 → drop oldest
    expect(buf.droppedChunks).toBe(1);
    expect(buf.droppedBytes).toBe(5);
    expect(buf.bytes).toBe(10);
  });

  it('never drops the last chunk even if it alone exceeds a cap', () => {
    const buf = new OutputRingBuffer({ maxBytes: 4, now: fixedClock() });
    buf.push('a');
    const huge = 'x'.repeat(1000);
    buf.push(huge);
    expect(buf.retainedChunks).toBe(1);
    expect(buf.snapshot().chunks[0]?.data).toBe(huge);
  });

  it('since(seq) returns only chunks at or beyond seq', () => {
    const buf = new OutputRingBuffer({ now: fixedClock() });
    buf.push('a');
    buf.push('b');
    buf.push('c');
    expect(buf.since(1).chunks.map((c) => c.data)).toEqual(['b', 'c']);
    expect(buf.since(1).restartRequired).toBe(false);
  });

  it('flags restartRequired when the requested seq was evicted', () => {
    const buf = new OutputRingBuffer({ maxLines: 2, now: fixedClock() });
    buf.push('a\n');
    buf.push('b\n');
    buf.push('c\n'); // drops seq 0
    const slice = buf.since(0);
    expect(slice.restartRequired).toBe(true);
    expect(slice.firstSeqAvailable).toBe(1);
    expect(slice.chunks.map((c) => c.data)).toEqual(['b\n', 'c\n']);
  });

  it('reports an empty replay with firstSeqAvailable == nextSeq when empty', () => {
    const buf = new OutputRingBuffer({ now: fixedClock() });
    const slice = buf.since(0);
    expect(slice.chunks).toEqual([]);
    expect(slice.nextSeq).toBe(0);
    expect(slice.restartRequired).toBe(false);
  });
});
