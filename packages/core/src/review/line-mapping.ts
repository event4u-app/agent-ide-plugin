/**
 * Line-mapping helper (road-to-code-review.md Phase 1, T-CR-105).
 *
 * Maps a model-quoted code span back to an exact new-file line number — sweep
 * anchors comments at a line; we anchor diagnostics. Robust against the model
 * quoting a slightly-reformatted span (re-indented, trailing whitespace).
 *
 * AI-Council (codex + gemini, 2026-05-29) flagged line-mapping as the #1
 * correctness risk: a diagnostic on the wrong line collapses trust. The
 * contract is therefore strict — the span MUST be locatable in the real new
 * file or the finding is dropped (see `validateAndMap`). We never trust a
 * model-emitted line number directly.
 */

import type { FileChange, Hunk } from './types.js';

export interface SpanLocation {
  /** 1-based start line in the new file. */
  line: number;
  /** 1-based end line (== line for a single-line span). */
  endLine: number;
}

/** Collapse runs of whitespace and trim — for whitespace-tolerant matching. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Locate `span` inside `fileContent`, returning 1-based start/end lines.
 *
 * Strategy, most-precise first:
 *  1. Exact substring match (covers verbatim multi-line quotes).
 *  2. Whitespace-normalised, line-window match (covers re-indented quotes).
 *
 * Returns `null` when the span cannot be located — the caller MUST drop the
 * finding rather than anchor it to a guessed line.
 */
export function mapSpanToLine(fileContent: string, span: string): SpanLocation | null {
  const trimmed = span.trim();
  if (trimmed.length === 0) return null;

  const fileLines = fileContent.split('\n');

  // 1. Exact substring — compute the line from the char offset.
  const idx = fileContent.indexOf(trimmed);
  if (idx !== -1) {
    const before = fileContent.slice(0, idx);
    const startLine = before.split('\n').length; // 1-based
    const spanLineCount = trimmed.split('\n').length;
    return { line: startLine, endLine: startLine + spanLineCount - 1 };
  }

  // 2. Whitespace-normalised sliding window over file lines.
  const spanLines = trimmed
    .split('\n')
    .map(normalizeWs)
    .filter((l) => l.length > 0);
  if (spanLines.length === 0) return null;
  const normFile = fileLines.map(normalizeWs);

  for (let start = 0; start + spanLines.length <= normFile.length; start++) {
    let matched = true;
    for (let j = 0; j < spanLines.length; j++) {
      if (normFile[start + j] !== spanLines[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { line: start + 1, endLine: start + spanLines.length };
    }
  }

  // 3. Single-line fallback: a one-line span may match a line's content even
  //    when multi-line windowing failed (e.g. the model quoted a fragment).
  if (spanLines.length === 1) {
    const needle = spanLines[0] as string;
    for (let i = 0; i < normFile.length; i++) {
      if (normFile[i]?.includes(needle)) return { line: i + 1, endLine: i + 1 };
    }
  }

  return null;
}

/**
 * Locate `span` within a file's hunks only (no full-file content available).
 * Searches added + context lines and returns the new-file line of the first
 * matching row. Used when the working-tree file cannot be read.
 */
export function locateSpanInHunks(hunks: Hunk[], span: string): number | null {
  const needle = normalizeWs(span);
  if (needle.length === 0) return null;
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.newLine === null) continue;
      const hay = normalizeWs(change.text);
      if (hay === needle || (needle.length >= 4 && hay.includes(needle))) {
        return change.newLine;
      }
    }
  }
  return null;
}

/**
 * Validate a model-quoted span and resolve its line, preferring the real
 * file content and falling back to hunk rows. Returns `null` when the span
 * cannot be confirmed — the strict contract the council asked for.
 */
export function validateAndMap(
  span: string,
  fileContent: string | undefined,
  change: FileChange | undefined,
): SpanLocation | null {
  if (fileContent !== undefined) {
    const loc = mapSpanToLine(fileContent, span);
    if (loc) return loc;
  }
  if (change) {
    const line = locateSpanInHunks(change.hunks, span);
    if (line !== null) return { line, endLine: line };
  }
  return null;
}
