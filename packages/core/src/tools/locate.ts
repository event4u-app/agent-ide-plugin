import { unifiedDiff } from './write-file.js';

/**
 * T-702 — 3-tier code locator.
 *
 * Port of SweepAI's `manual_code_check` (tier 2) and `find_best_matches`
 * (tier 3), distilled to a pure function over two strings. The multi-file
 * edit tool (`write-files.ts`) calls {@link locate} to map a model-emitted
 * `originalCode` block onto a real span in the current file before applying a
 * search-and-replace edit.
 *
 * The V4 "search-then-replace" contract (the only modification strategy that
 * survived SweepAI's V0 whole-file / V1 difflib / V2 line-number / V3
 * conflict-marker iterations) hinges on locating the block robustly:
 *
 *   tier 1 — literal `includes`: `originalCode` present verbatim.
 *   tier 2 — indentation brute-force: dedent the needle, then re-indent it by
 *            0..16 spaces (step 2) and match line-windows after `rstrip`,
 *            so trailing-whitespace drift and uniform indent shifts still hit.
 *   tier 3 — fuzzy: tokenize, drop comment/blank lines, score a QRatio-like
 *            token-LCS ratio. A score over {@link FUZZY_THRESHOLD} returns a
 *            *suggestion* with a "did you mean?" diff — NEVER applied silently.
 *
 * All offsets are UTF-16 code-unit indices into the haystack string (the same
 * unit `String.prototype.slice`/`indexOf` use), so the caller can splice
 * directly without a Buffer round-trip.
 */

/** Indentation deltas tried in tier 2, in priority order. */
const INDENT_DELTAS = [0, 2, 4, 6, 8, 10, 12, 14, 16] as const;

/** Minimum token-LCS ratio (0-100) for a tier-3 fuzzy suggestion. */
export const FUZZY_THRESHOLD = 80;

export interface LocateMatch {
  /** Inclusive start offset of the matched span. */
  start: number;
  /** Exclusive end offset of the matched span. */
  end: number;
  /** Exact text occupying `[start, end)` in the haystack. */
  matched: string;
}

export interface LocateSuggestion {
  score: number;
  /** The needle the model emitted. */
  expectedSnippet: string;
  /** The closest real span found in the file. */
  matchedSnippet: string;
  /** Unified diff expected → matched, for a "did you mean?" re-prompt. */
  unifiedDiff: string;
  start: number;
  end: number;
}

export type LocateOutcome =
  | { kind: 'exact'; tier: 'literal' | 'indentation'; match: LocateMatch; occurrences: number }
  | { kind: 'suggestion'; suggestion: LocateSuggestion }
  | { kind: 'none' };

interface LineSpan {
  /** Raw line text, no trailing newline. */
  text: string;
  /** Offset of the first char of the line in the source. */
  start: number;
  /** Offset one past the last char of the line (before the newline). */
  end: number;
}

/**
 * Locate `needle` inside `haystack`. Tries the three tiers in order and
 * returns the first that resolves. An empty needle never matches.
 */
export function locate(haystack: string, needle: string): LocateOutcome {
  if (needle.length === 0) return { kind: 'none' };

  // --- tier 1: literal --------------------------------------------------
  const literal = literalMatches(haystack, needle);
  if (literal.length > 0) {
    const first = literal[0]!;
    return { kind: 'exact', tier: 'literal', match: first, occurrences: literal.length };
  }

  // --- tier 2: indentation brute-force ----------------------------------
  const indented = indentationMatch(haystack, needle);
  if (indented) return indented;

  // --- tier 3: fuzzy ----------------------------------------------------
  const fuzzy = fuzzyMatch(haystack, needle);
  if (fuzzy) return { kind: 'suggestion', suggestion: fuzzy };

  return { kind: 'none' };
}

/** All literal occurrences of `needle`, left-to-right, non-overlapping. */
function literalMatches(haystack: string, needle: string): LocateMatch[] {
  const out: LocateMatch[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + needle.length, matched: needle });
    from = idx + needle.length;
  }
  return out;
}

/**
 * Tier 2 — re-indent the dedented needle by each delta and match line-windows
 * after `rstrip`. Returns an exact match only when exactly one window matches
 * for the *first* delta that produces any match (deterministic).
 */
function indentationMatch(haystack: string, needle: string): LocateOutcome | undefined {
  const hLines = splitLines(haystack);
  const nLines = trimBlankEdges(needle.split('\n')).map(rstrip);
  if (nLines.length === 0) return undefined;
  const dedented = dedent(nLines);

  for (const delta of INDENT_DELTAS) {
    const prefix = ' '.repeat(delta);
    const candidate = dedented.map((l) => (l.length === 0 ? '' : prefix + l));
    const windows = matchLineWindows(hLines, candidate);
    if (windows.length === 0) continue;
    if (windows.length === 1) {
      const match = windows[0]!;
      return { kind: 'exact', tier: 'indentation', match, occurrences: 1 };
    }
    // Ambiguous at this delta → treat as not-found (never guess which span).
    return undefined;
  }
  return undefined;
}

/**
 * Slide a window of `candidate.length` lines over `hLines`, comparing each
 * haystack line `rstrip`-ped against the candidate line. Returns the spans of
 * every matching window.
 */
function matchLineWindows(hLines: LineSpan[], candidate: string[]): LocateMatch[] {
  const out: LocateMatch[] = [];
  const win = candidate.length;
  if (win === 0 || win > hLines.length) return out;
  for (let i = 0; i + win <= hLines.length; i++) {
    let ok = true;
    for (let k = 0; k < win; k++) {
      if (rstrip(hLines[i + k]!.text) !== candidate[k]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const startLine = hLines[i]!;
    const endLine = hLines[i + win - 1]!;
    out.push({
      start: startLine.start,
      end: endLine.end,
      matched: hLines
        .slice(i, i + win)
        .map((l) => l.text)
        .join('\n'),
    });
  }
  return out;
}

/**
 * Tier 3 — fuzzy. Slide a needle-sized window (in *code* lines, comment/blank
 * lines dropped) over the haystack, score token-LCS, and return the best span
 * above {@link FUZZY_THRESHOLD} as a suggestion.
 */
function fuzzyMatch(haystack: string, needle: string): LocateSuggestion | undefined {
  const hLines = splitLines(haystack);
  const hCode = hLines.filter((l) => isCodeLine(l.text));
  const needleTokens = tokenize(stripNonCode(needle));
  if (hCode.length === 0 || needleTokens.length === 0) return undefined;

  const needleCodeLineCount = Math.max(1, stripNonCode(needle).split('\n').filter(Boolean).length);
  const win = Math.min(needleCodeLineCount, hCode.length);

  let best: { score: number; startIdx: number; endIdx: number } | undefined;
  for (let i = 0; i + win <= hCode.length; i++) {
    const windowText = hCode
      .slice(i, i + win)
      .map((l) => l.text)
      .join('\n');
    const score = tokenRatio(needleTokens, tokenize(windowText));
    if (!best || score > best.score) {
      best = { score, startIdx: i, endIdx: i + win - 1 };
    }
  }
  if (!best || best.score <= FUZZY_THRESHOLD) return undefined;

  const startLine = hCode[best.startIdx]!;
  const endLine = hCode[best.endIdx]!;
  // Expand the span to whole source lines between the first and last code line
  // so the matched snippet reads naturally in the diff.
  const matchedSnippet = haystack.slice(startLine.start, endLine.end);
  return {
    score: Math.round(best.score),
    expectedSnippet: needle,
    matchedSnippet,
    unifiedDiff: unifiedDiff(needle, matchedSnippet, 'did-you-mean'),
    start: startLine.start,
    end: endLine.end,
  };
}

// --- string helpers -----------------------------------------------------

/** Split into lines keeping each line's source offsets. Handles CRLF/LF. */
function splitLines(source: string): LineSpan[] {
  const out: LineSpan[] = [];
  let lineStart = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === '\n') {
      let end = i;
      // Trim a trailing CR so CRLF files compare like LF.
      if (end > lineStart && source[end - 1] === '\r') end -= 1;
      out.push({ text: source.slice(lineStart, end), start: lineStart, end });
      lineStart = i + 1;
    }
  }
  return out;
}

function rstrip(s: string): string {
  return s.replace(/[ \t\r]+$/, '');
}

/** Drop fully-blank lines from the start and end of an array. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim().length === 0) start++;
  while (end > start && lines[end - 1]!.trim().length === 0) end--;
  return lines.slice(start, end);
}

/** Remove the smallest common leading-whitespace prefix across non-blank lines. */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return lines;
  return lines.map((l) => (l.trim().length === 0 ? '' : l.slice(min)));
}

/** A "code line" is non-blank and not a pure comment. */
function isCodeLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*')) {
    return false;
  }
  return true;
}

/** Drop blank + comment lines, returning the remaining text. */
function stripNonCode(source: string): string {
  return source
    .split('\n')
    .filter((l) => isCodeLine(l))
    .join('\n');
}

/** Tokenize on whitespace and bracket characters (SweepAI's split set). */
export function tokenize(source: string): string[] {
  return source.split(/[\s(){}[\]]+/).filter((t) => t.length > 0);
}

/**
 * QRatio-equivalent over token arrays: `2 * LCS / (a + b)` scaled to 0-100.
 * Order-sensitive (uses longest-common-subsequence), matching Python's
 * `difflib.SequenceMatcher.ratio` behaviour closely enough for the threshold.
 */
export function tokenRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 0;
  const lcs = lcsLength(a, b);
  return (2 * lcs * 100) / (a.length + b.length);
}

/** Longest common subsequence length over two token arrays (DP, O(n·m)). */
function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}
