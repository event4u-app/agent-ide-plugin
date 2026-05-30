/**
 * T-602 — Snippet model. Port of SweepAI's `entities.py:292`.
 *
 * A snippet is a line range *into* a file's content — it holds the whole-file
 * `content` and a `[start, end)` line window (0-based, end-exclusive), slicing
 * lazily rather than copying. The `denotation` (`"path:start-end"`) is the
 * stable key used across retrieval, dedup, and context injection. Set-algebra
 * (`overlap` / `merge` / `expand`) lets the retriever coalesce neighbouring
 * hits into one readable block.
 */
export class Snippet {
  constructor(
    readonly filePath: string,
    /** Whole-file content. */
    readonly content: string,
    /** 0-based first line of the window. */
    readonly start: number,
    /** 0-based exclusive end line of the window. */
    readonly end: number,
  ) {}

  /** Stable key: `path:start-end`. */
  get denotation(): string {
    return `${this.filePath}:${this.start}-${this.end}`;
  }

  /** Lazily slice the windowed text out of the whole-file content. */
  getText(): string {
    return this.content.split('\n').slice(this.start, this.end).join('\n');
  }

  /** Number of lines in the window. */
  get lineCount(): number {
    return Math.max(0, this.end - this.start);
  }

  /** True when `other` is the same file and the line windows intersect. */
  overlap(other: Snippet): boolean {
    return this.filePath === other.filePath && this.start < other.end && other.start < this.end;
  }

  /**
   * Union with `other` (same file assumed). Returns a new snippet spanning the
   * outer bounds of both windows.
   */
  merge(other: Snippet): Snippet {
    return new Snippet(
      this.filePath,
      this.content,
      Math.min(this.start, other.start),
      Math.max(this.end, other.end),
    );
  }

  /**
   * Grow the window by `n` lines on each side, clamped to the file bounds.
   * Used to fetch the ±context around a retrieved symbol (T-605).
   */
  expand(n: number): Snippet {
    const totalLines = this.content.split('\n').length;
    return new Snippet(
      this.filePath,
      this.content,
      Math.max(0, this.start - n),
      Math.min(totalLines, this.end + n),
    );
  }
}
