import { describe, expect, it } from 'vitest';
import { LanguageRegistry } from '../context/languages.js';
import {
  checkSyntax,
  type Diagnostic,
  diagnosticKey,
  diffDiagnostics,
  findLeftoverMarkers,
  validateEdit,
} from './validate-edit.js';

const diag = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  source: 'tsc',
  file: 'a.ts',
  line: 1,
  severity: 'error',
  message: "Cannot find name 'foo'.",
  ...over,
});

describe('findLeftoverMarkers', () => {
  it('catches "... rest of code"', () => {
    expect(findLeftoverMarkers('function f() {\n  // ... rest of code\n}')).toBeTruthy();
  });
  it('catches "TODO: implement"', () => {
    expect(findLeftoverMarkers('const x = 1;\n// TODO: implement\n')).toBeTruthy();
  });
  it('catches an ellipsis comment line', () => {
    expect(findLeftoverMarkers('a();\n// ...\n')).toBeTruthy();
  });
  it('passes clean code', () => {
    expect(findLeftoverMarkers('const x = 1;\nreturn x + 1;\n')).toBeUndefined();
  });
});

describe('diffDiagnostics', () => {
  it('returns only newly-introduced diagnostics', () => {
    const before = [diag({ message: 'pre-existing' })];
    const after = [diag({ message: 'pre-existing' }), diag({ code: 'TS2304', message: 'new one' })];
    const introduced = diffDiagnostics(before, after);
    expect(introduced).toHaveLength(1);
    expect(introduced[0]!.message).toBe('new one');
  });

  it('is stable under line shift (same message, different line)', () => {
    const before = [diag({ line: 10 })];
    const after = [diag({ line: 14 })]; // edit pushed it down 4 lines
    expect(diffDiagnostics(before, after)).toHaveLength(0);
  });

  it('counts duplicates as a multiset', () => {
    const before = [diag({ line: 1 })];
    const after = [diag({ line: 1 }), diag({ line: 2 })]; // one more of the same
    expect(diffDiagnostics(before, after)).toHaveLength(1);
  });

  it('keys line/column-free', () => {
    expect(diagnosticKey(diag({ line: 1, column: 5 }))).toBe(
      diagnosticKey(diag({ line: 99, column: 1 })),
    );
  });
});

describe('checkSyntax (real tree-sitter grammar)', () => {
  const registry = new LanguageRegistry();

  it('returns undefined for valid TypeScript', async () => {
    const issue = await checkSyntax(registry, 'ok.ts', 'export const x: number = 1;\n');
    expect(issue).toBeUndefined();
  });

  it('flags a syntax error with a caret excerpt', async () => {
    const broken = 'export function f( {\n  return 1;\n}\n';
    const issue = await checkSyntax(registry, 'broken.ts', broken);
    expect(issue).toBeDefined();
    expect(issue!.source).toBe('tree-sitter');
    expect(issue!.severity).toBe('error');
    expect(issue!.caret).toContain('^');
  });

  it('skips files with no grammar', async () => {
    const issue = await checkSyntax(registry, 'notes.unknownext', 'this is ::: not code');
    expect(issue).toBeUndefined();
  });
});

describe('validateEdit', () => {
  it('is ok for a clean edit (no registry)', async () => {
    const res = await validateEdit({
      file: 'a.ts',
      newCode: 'const x = 2;',
      newContent: 'const x = 2;\n',
      baseline: [],
      after: [],
    });
    expect(res.ok).toBe(true);
  });

  it('fails on a leftover marker', async () => {
    const res = await validateEdit({
      file: 'a.ts',
      newCode: '// ... rest of code',
      newContent: '// ... rest of code\n',
      baseline: [],
      after: [],
    });
    expect(res.ok).toBe(false);
    expect(res.leftover).toBeTruthy();
  });

  it('fails on a newly-introduced diagnostic', async () => {
    const res = await validateEdit({
      file: 'a.ts',
      newCode: 'const x = bad;',
      newContent: 'const x = bad;\n',
      baseline: [],
      after: [diag({ code: 'TS2304' })],
    });
    expect(res.ok).toBe(false);
    expect(res.newDiagnostics).toHaveLength(1);
  });

  it('runs the tree-sitter layer when a registry is passed', async () => {
    const registry = new LanguageRegistry();
    const res = await validateEdit(
      {
        file: 'a.ts',
        newCode: 'export function f( {',
        newContent: 'export function f( {\n  return 1;\n}\n',
        baseline: [],
        after: [],
      },
      registry,
    );
    expect(res.ok).toBe(false);
    expect(res.syntax).toBeDefined();
  });
});
