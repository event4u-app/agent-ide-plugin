import type Parser from 'web-tree-sitter';
import { Snippet } from './snippet.js';

/**
 * T-602 — CST chunker. Port of SweepAI's `chunk_tree` (`code_validators.py`,
 * which became LlamaIndex's default code splitter). Three non-obvious rules,
 * ported deliberately:
 *
 *   1. Greedy-accumulate sibling nodes until `MAX_CHARS`, recursing into any
 *      single node larger than the budget.
 *   2. Fill the byte-gaps between sibling chunks (set each chunk's end to the
 *      next chunk's start) so no source bytes are dropped — a real bug when
 *      grammars leave gaps between named nodes.
 *   3. Coalesce chunks smaller than `COALESCE` into their neighbour, and glue
 *      any chunk whose text starts with a closing bracket (`)`/`}`/`]`) to its
 *      predecessor so closing brackets stay attached to their block.
 *
 * Tree-sitter indices are UTF-8 byte offsets, so all span maths run over a
 * `Buffer`; output is converted to line-range {@link Snippet}s.
 */

const MAX_CHARS = 1500;
const COALESCE = 50;

interface Span {
  start: number;
  end: number;
}

const spanLen = (s: Span): number => s.end - s.start;

/**
 * Recursive greedy accumulator over a node's children. Returns byte-offset
 * spans. Exported for unit testing against a parsed tree.
 */
export function chunkNode(node: Parser.SyntaxNode, maxChars = MAX_CHARS): Span[] {
  const chunks: Span[] = [];
  let current: Span = { start: node.startIndex, end: node.startIndex };
  for (const child of node.children) {
    const childLen = child.endIndex - child.startIndex;
    if (childLen > maxChars) {
      if (spanLen(current) > 0) chunks.push(current);
      chunks.push(...chunkNode(child, maxChars));
      current = { start: child.endIndex, end: child.endIndex };
    } else if (childLen + spanLen(current) > maxChars) {
      if (spanLen(current) > 0) chunks.push(current);
      current = { start: child.startIndex, end: child.endIndex };
    } else {
      current = { start: current.start, end: child.endIndex };
    }
  }
  if (spanLen(current) > 0) chunks.push(current);
  return chunks;
}

export interface ChunkOptions {
  maxChars?: number;
  coalesce?: number;
}

/**
 * Chunk a parsed tree into line-range snippets. `content` is the original
 * source text (used for byte/line maths and bracket inspection).
 */
export function chunkTree(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  content: string,
  opts: ChunkOptions = {},
): Snippet[] {
  const maxChars = opts.maxChars ?? MAX_CHARS;
  const coalesce = opts.coalesce ?? COALESCE;
  const buffer = Buffer.from(content, 'utf8');

  const raw = chunkNode(rootNode, maxChars);
  if (raw.length === 0) {
    return content.length > 0 ? [new Snippet(filePath, content, 0, lineCount(content))] : [];
  }

  // Rule 2: fill byte-gaps between siblings; last chunk extends to EOF.
  for (let i = 0; i < raw.length - 1; i++) {
    const cur = raw[i];
    const next = raw[i + 1];
    if (cur && next) cur.end = next.start;
  }
  const last = raw[raw.length - 1];
  if (last) last.end = buffer.length;

  // Rule 3: coalesce small chunks; glue closing-bracket-leading chunks back.
  const merged: Span[] = [];
  let current: Span | undefined;
  for (const span of raw) {
    if (!current) {
      current = { ...span };
      continue;
    }
    const text = buffer.subarray(span.start, span.end).toString('utf8');
    const startsWithCloser = /^\s*[)\]}]/.test(text);
    const currentText = buffer.subarray(current.start, current.end).toString('utf8');
    const big = spanLen(current) > coalesce && currentText.includes('\n');
    if (big && !startsWithCloser) {
      merged.push(current);
      current = { ...span };
    } else {
      current.end = span.end;
    }
  }
  if (current) merged.push(current);

  // Byte spans → line ranges → snippets; drop empties.
  const snippets: Snippet[] = [];
  for (const span of merged) {
    const startLine = byteToLine(buffer, span.start);
    const endLine = byteToLine(buffer, span.end);
    if (endLine > startLine) snippets.push(new Snippet(filePath, content, startLine, endLine));
  }
  return snippets;
}

/**
 * Line-window fallback for files with no grammar. 30-line windows with 50%
 * overlap (SweepAI's `naive_chunker` defaults).
 */
export function naiveChunker(
  filePath: string,
  content: string,
  windowLines = 30,
  overlap = 0.5,
): Snippet[] {
  const total = lineCount(content);
  if (total === 0) return [];
  const step = Math.max(1, Math.floor(windowLines * (1 - overlap)));
  const snippets: Snippet[] = [];
  for (let start = 0; start < total; start += step) {
    const end = Math.min(total, start + windowLines);
    snippets.push(new Snippet(filePath, content, start, end));
    if (end === total) break;
  }
  return snippets;
}

function byteToLine(buffer: Buffer, byteOffset: number): number {
  let line = 0;
  const limit = Math.min(byteOffset, buffer.length);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0x0a) line++;
  }
  return line;
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.split('\n').length;
}
