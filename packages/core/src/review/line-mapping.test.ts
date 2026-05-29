import { describe, expect, it } from 'vitest';
import { locateSpanInHunks, mapSpanToLine, validateAndMap } from './line-mapping.js';
import type { FileChange } from './types.js';

const FILE = `export function compute(n: number) {
  const doubled = n * 2;
  if (doubled > 10) {
    return doubled;
  }
  return n;
}
`;

describe('mapSpanToLine', () => {
  it('resolves an exact single-line span to the correct line (±0)', () => {
    expect(mapSpanToLine(FILE, 'const doubled = n * 2;')).toEqual({ line: 2, endLine: 2 });
  });

  it('resolves a multi-line span to its start/end lines', () => {
    const span = `  if (doubled > 10) {\n    return doubled;\n  }`;
    expect(mapSpanToLine(FILE, span)).toEqual({ line: 3, endLine: 5 });
  });

  it('tolerates re-indented / reformatted whitespace', () => {
    // Model re-indented the quote — still maps to the real line.
    expect(mapSpanToLine(FILE, '        const doubled   =   n * 2;')).toEqual({
      line: 2,
      endLine: 2,
    });
  });

  it('returns null when the span is not in the file', () => {
    expect(mapSpanToLine(FILE, 'const missing = true;')).toBeNull();
  });
});

describe('locateSpanInHunks', () => {
  it('finds the new-file line of an added/context row', () => {
    const hunks: FileChange['hunks'] = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 2,
        section: '',
        changes: [
          { kind: 'context', oldLine: 1, newLine: 1, text: 'function f() {' },
          { kind: 'add', oldLine: null, newLine: 2, text: '  const leak = secret;' },
        ],
      },
    ];
    expect(locateSpanInHunks(hunks, 'const leak = secret;')).toBe(2);
    expect(locateSpanInHunks(hunks, 'nonexistent')).toBeNull();
  });
});

describe('validateAndMap', () => {
  const change: FileChange = {
    file: 'x.ts',
    status: 'modified',
    binary: false,
    hunks: [
      {
        oldStart: 2,
        oldCount: 1,
        newStart: 2,
        newCount: 1,
        section: '',
        changes: [{ kind: 'add', oldLine: null, newLine: 2, text: 'const doubled = n * 2;' }],
      },
    ],
  };

  it('prefers real file content when available', () => {
    expect(validateAndMap('const doubled = n * 2;', FILE, change)).toEqual({ line: 2, endLine: 2 });
  });

  it('falls back to hunk rows when no file content is supplied', () => {
    expect(validateAndMap('const doubled = n * 2;', undefined, change)).toEqual({
      line: 2,
      endLine: 2,
    });
  });

  it('returns null when the span cannot be confirmed anywhere', () => {
    expect(validateAndMap('totally absent', undefined, change)).toBeNull();
  });
});
