import { describe, expect, it } from 'vitest';
import { Snippet } from './snippet.js';

const content = ['line0', 'line1', 'line2', 'line3', 'line4', 'line5'].join('\n');

describe('Snippet', () => {
  it('builds a denotation key and lazily slices the window', () => {
    const s = new Snippet('src/a.ts', content, 1, 3);
    expect(s.denotation).toBe('src/a.ts:1-3');
    expect(s.getText()).toBe('line1\nline2');
    expect(s.lineCount).toBe(2);
  });

  it('detects overlap only within the same file', () => {
    const a = new Snippet('src/a.ts', content, 0, 3);
    const b = new Snippet('src/a.ts', content, 2, 5);
    const c = new Snippet('src/a.ts', content, 3, 5);
    const other = new Snippet('src/b.ts', content, 0, 3);
    expect(a.overlap(b)).toBe(true);
    expect(a.overlap(c)).toBe(false); // [0,3) and [3,5) touch but do not intersect
    expect(a.overlap(other)).toBe(false);
  });

  it('merges to the outer bounds', () => {
    const a = new Snippet('src/a.ts', content, 1, 3);
    const b = new Snippet('src/a.ts', content, 2, 5);
    const m = a.merge(b);
    expect(m.start).toBe(1);
    expect(m.end).toBe(5);
  });

  it('expands clamped to file bounds', () => {
    const s = new Snippet('src/a.ts', content, 1, 2);
    const e = s.expand(5);
    expect(e.start).toBe(0);
    expect(e.end).toBe(6); // content has 6 lines
  });
});
