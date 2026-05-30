import { describe, expect, it } from 'vitest';
import { FUZZY_THRESHOLD, locate, tokenize, tokenRatio } from './locate.js';

const FILE = `export function greet(name: string): string {
  if (name.length === 0) {
    return 'hello, stranger';
  }
  return \`hello, \${name}\`;
}
`;

describe('locate — tier 1 literal', () => {
  it('finds a verbatim single occurrence', () => {
    const out = locate(FILE, `  return \`hello, \${name}\`;`);
    expect(out.kind).toBe('exact');
    if (out.kind !== 'exact') return;
    expect(out.tier).toBe('literal');
    expect(out.occurrences).toBe(1);
    expect(FILE.slice(out.match.start, out.match.end)).toBe(`  return \`hello, \${name}\`;`);
  });

  it('reports multiple literal occurrences', () => {
    const dup = 'a();\nb();\na();\n';
    const out = locate(dup, 'a();');
    expect(out.kind).toBe('exact');
    if (out.kind !== 'exact') return;
    expect(out.occurrences).toBe(2);
  });

  it('never matches an empty needle', () => {
    expect(locate(FILE, '').kind).toBe('none');
  });
});

describe('locate — tier 2 indentation', () => {
  it('matches a block the model emitted at column 0', () => {
    // Model dropped the 2-space method indentation.
    const needle = `if (name.length === 0) {\n  return 'hello, stranger';\n}`;
    const out = locate(FILE, needle);
    expect(out.kind).toBe('exact');
    if (out.kind !== 'exact') return;
    expect(out.tier).toBe('indentation');
    expect(FILE.slice(out.match.start, out.match.end)).toBe(
      `  if (name.length === 0) {\n    return 'hello, stranger';\n  }`,
    );
  });

  it('tolerates trailing-whitespace drift in the file', () => {
    const file = 'const x = 1;   \nconst y = 2;\n';
    const out = locate(file, 'const x = 1;\nconst y = 2;');
    expect(out.kind).toBe('exact');
    if (out.kind !== 'exact') return;
    expect(out.tier).toBe('indentation');
  });

  it('refuses an ambiguous indentation match', () => {
    // Block appears twice (model stripped the indent → literal tier misses).
    const file = '  doThing();\n  cleanup();\n\n  doThing();\n  cleanup();\n';
    const out = locate(file, 'doThing();\ncleanup();');
    // Two windows match at delta 2 → tier 2 bails rather than guess. It must
    // never return an indentation `exact` for an ambiguous block.
    if (out.kind === 'exact') expect(out.tier).not.toBe('indentation');
  });
});

describe('locate — tier 3 fuzzy', () => {
  it('returns a did-you-mean suggestion, never an exact match', () => {
    // Same 3-line block as the file, but one token differs ('stranger!').
    const needle = `if (name.length === 0) {\n  return 'hello, stranger!';\n}`;
    const out = locate(FILE, needle);
    expect(out.kind).toBe('suggestion');
    if (out.kind !== 'suggestion') return;
    expect(out.suggestion.score).toBeGreaterThan(FUZZY_THRESHOLD);
    expect(out.suggestion.unifiedDiff).toContain('did-you-mean');
    expect(out.suggestion.matchedSnippet).toContain("hello, stranger'");
  });

  it('returns none when nothing is close', () => {
    const out = locate(FILE, 'const completelyUnrelated = new HttpServer(8080);');
    expect(out.kind).toBe('none');
  });
});

describe('tokenize / tokenRatio', () => {
  it('splits on whitespace and brackets', () => {
    expect(tokenize('foo(bar, baz)')).toEqual(['foo', 'bar,', 'baz']);
  });

  it('scores identical token streams at 100', () => {
    expect(tokenRatio(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(100);
  });

  it('scores disjoint streams at 0', () => {
    expect(tokenRatio(['a', 'b'], ['x', 'y'])).toBe(0);
  });

  it('scores a partial overlap between 0 and 100', () => {
    const r = tokenRatio(['a', 'b', 'c', 'd'], ['a', 'b', 'x', 'y']);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(100);
  });
});
