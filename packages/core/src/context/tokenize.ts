/**
 * T-603 — Code tokenizer. Faithful port of SweepAI's `tokenize_code`
 * (`sweepai/core/lexical_search.py`), verified against the upstream source.
 *
 * This is what makes BM25 work on code: a raw identifier like `getUserById`
 * is useless as a single token, but split into `get user by id` it matches a
 * natural-language query. The pipeline:
 *
 *   1. find word-ish chunks of ≥ 2 chars (`\b\w{2,}\b`);
 *   2. split snake_case on `_`;
 *   3. split camelCase / PascalCase / acronyms via the variable pattern;
 *   4. drop parts < 2 chars;
 *   5. keep a part only when it is mostly alphanumeric AND not low-entropy
 *      (`len / distinctChars < 4` — drops repetitive junk like `aaaaaa`).
 *
 * Tokens are lowercased.
 */

const WORD_PATTERN = /\w{2,}/g;
const VARIABLE_PATTERN = /[A-Z][a-z]+|[a-z]+|[A-Z]+(?=[A-Z]|$)/g;

export function tokenizeCode(code: string): string[] {
  const tokens: string[] = [];
  const words = code.match(WORD_PATTERN);
  if (!words) return tokens;
  for (const word of words) {
    for (const section of word.split('_')) {
      const parts = section.match(VARIABLE_PATTERN);
      if (!parts) continue;
      for (const part of parts) {
        if (part.length < 2) continue;
        const alnum = countAlnum(part);
        const distinct = new Set(part).size;
        if (alnum > Math.floor(part.length / 2) && part.length / distinct < 4) {
          tokens.push(part.toLowerCase());
        }
      }
    }
  }
  return tokens;
}

/** Convenience: tokenize and join with spaces (matches SweepAI's return shape). */
export function tokenizeCodeToString(code: string): string {
  return tokenizeCode(code).join(' ');
}

function countAlnum(s: string): number {
  let n = 0;
  for (const c of s) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) n++;
  }
  return n;
}
