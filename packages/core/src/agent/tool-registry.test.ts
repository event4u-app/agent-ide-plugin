import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultToolRegistry, MapToolRegistry, type RegisteredTool } from './tool-registry.js';
import { TerminalSessionManager } from '../terminal/manager.js';
import type { FakeTerminal } from '../terminal/pty.js';
import type { RunShellResult } from '../tools/run-shell.js';
import { LanguageRegistry } from '../context/languages.js';
import type { Diagnostic, DiagnosticProvider, SyntaxIssue } from '../tools/validate-edit.js';

/** The shape `writeFilesEntry.execute()` folds into its `output` on issues. */
interface FileValidation {
  file: string;
  newDiagnostics: Diagnostic[];
  syntax?: SyntaxIssue;
  leftover?: string;
}
type WriteOutput = { applied: string[]; validation?: FileValidation[] };

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tool-registry-'));
}

describe('buildDefaultToolRegistry', () => {
  it('advertises the read tools + write_files', async () => {
    const registry = buildDefaultToolRegistry({ workspaceRoot: await tempWorkspace() });
    const names = registry
      .definitions()
      .map((d) => d.name)
      .sort();
    expect(names).toEqual(['glob', 'grep', 'list_dir', 'read_file', 'write_files']);
  });

  it('read_file returns file contents through prepare → execute', async () => {
    const root = await tempWorkspace();
    await writeFile(join(root, 'a.txt'), 'hello world', 'utf8');
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const prepared = await registry.get('read_file')!.prepare({ path: 'a.txt' });
    expect(prepared.review).toBeUndefined();
    const result = await prepared.execute();
    expect(result.ok).toBe(true);
    expect(result.output).toContain('hello world');
    expect(result.changedFiles).toBeUndefined();
  });

  it('write_files exposes a diff review and writes on execute', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'note.txt', originalCode: '', newCode: 'created\n' }],
    });
    expect(prepared.review?.kind).toBe('diff');
    expect(prepared.review?.files[0]?.path).toBe('note.txt');
    expect(prepared.review?.files[0]?.isNewFile).toBe(true);

    // The prepared tool also exposes durable code-suggestion annotations built
    // from the resolved plan — one per edit, `pending` for a resolved edit.
    expect(prepared.suggestions).toHaveLength(1);
    expect(prepared.suggestions?.[0]).toMatchObject({
      kind: 'code-suggestion',
      suggestionId: 'edit-0',
      filePath: 'note.txt',
      state: 'pending',
    });
    expect(prepared.suggestions?.[0]?.diffPreview).toContain('created');

    const result = await prepared.execute();
    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(['note.txt']);
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('created\n');
  });

  it('write_files reports unresolved edits without throwing', async () => {
    const root = await tempWorkspace();
    await writeFile(join(root, 'b.txt'), 'real content', 'utf8');
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'b.txt', originalCode: 'NOT PRESENT', newCode: 'x' }],
    });
    // An unresolved edit yields a terminal `error` suggestion carrying the
    // locate diagnostic and an empty diff preview.
    expect(prepared.suggestions?.[0]?.state).toBe('error');
    expect(prepared.suggestions?.[0]?.diffPreview).toBe('');
    const result = await prepared.execute();
    // The edit did not resolve, so no file is in changedFiles, but exec still
    // returns a structured summary the model can act on.
    expect(result.changedFiles).toEqual([]);
    const summary = result.output as { unresolved: Array<{ file: string; status: string }> };
    expect(summary.unresolved[0]?.file).toBe('b.txt');
  });

  it('read_file fails soft on a missing path (returns a message, never throws)', async () => {
    const registry = buildDefaultToolRegistry({ workspaceRoot: await tempWorkspace() });
    const prepared = await registry.get('read_file')!.prepare({ path: 'missing.txt' });
    const result = await prepared.execute();
    // The read tool returns a diagnostic string rather than throwing, so the
    // call "succeeds" with a message the model can read and react to.
    expect(typeof result.output).toBe('string');
    expect(result.changedFiles).toBeUndefined();
  });

  it('registers run_shell as a mutating tool ONLY when a terminal manager is given', async () => {
    const root = await tempWorkspace();
    const withoutShell = buildDefaultToolRegistry({ workspaceRoot: root });
    expect(withoutShell.get('run_shell')).toBeUndefined();

    const withShell = buildDefaultToolRegistry({
      workspaceRoot: root,
      terminalManager: new TerminalSessionManager(),
    });
    expect(withShell.get('run_shell')?.mutates).toBe(true);
    // Mutating → filtered out of a read-only agent mode.
    expect(withShell.definitions({ mutating: false }).map((d) => d.name)).not.toContain(
      'run_shell',
    );
  });

  it('run_shell spawns into the shared manager and returns the run result on exit', async () => {
    const root = await tempWorkspace();
    const manager = new TerminalSessionManager();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root, terminalManager: manager });
    const prepared = await registry.get('run_shell')!.prepare({ command: 'echo', args: ['hi'] });
    // No diff review for a shell command (the command shows via argsPreview).
    expect(prepared.review).toBeUndefined();

    const execution = prepared.execute();
    // The session is live in the SHARED manager — the terminalSubscribe path
    // would see it (end-to-end). Drive the Fake terminal to completion.
    const session = manager.list()[0]!;
    const fake = session.terminal as FakeTerminal;
    fake.emit('hi\n');
    fake.emitExit({ exitCode: 0 });

    const result = await execution;
    expect(result.ok).toBe(true);
    expect(result.changedFiles).toBeUndefined();
    const output = result.output as RunShellResult;
    expect(output.status).toBe('exited');
    expect(output.outputTail).toBe('hi');
    expect(result.outputPreview).toContain('exit 0');
  });

  it('run_shell reports a failed command as not-ok with the output in the result', async () => {
    const root = await tempWorkspace();
    const manager = new TerminalSessionManager();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root, terminalManager: manager });
    const prepared = await registry.get('run_shell')!.prepare({ command: 'false' });
    const execution = prepared.execute();
    const fake = manager.list()[0]!.terminal as FakeTerminal;
    fake.emit('boom\n');
    fake.emitExit({ exitCode: 2 });
    const result = await execution;
    expect(result.ok).toBe(false);
    expect((result.output as RunShellResult).exitCode).toBe(2);
  });
});

describe('write_files post-write delta-gate (T-702b)', () => {
  it('surfaces a leftover marker without a registry, write still ok (B1)', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [
        { file: 'note.ts', originalCode: '', newCode: 'const a = 1;\n// ... rest of code\n' },
      ],
    });
    const result = await prepared.execute();
    // The atomic write succeeded → ok stays true; the leftover finding is
    // advisory feedback folded into the output for the next model turn.
    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(['note.ts']);
    const output = result.output as WriteOutput;
    expect(output.validation?.[0]?.file).toBe('note.ts');
    expect(output.validation?.[0]?.leftover).toBeDefined();
    expect(result.outputPreview).toContain('leftover marker');
    // The file is on disk despite the validation finding (no rollback).
    expect(await readFile(join(root, 'note.ts'), 'utf8')).toContain('rest of code');
  });

  it('surfaces a tree-sitter syntax error when a language registry is wired (E1/F1)', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({
      workspaceRoot: root,
      languageRegistry: new LanguageRegistry(),
    });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'broken.ts', originalCode: '', newCode: 'export const x: number = ;\n' }],
    });
    const result = await prepared.execute();
    expect(result.ok).toBe(true);
    const output = result.output as WriteOutput;
    expect(output.validation?.[0]?.syntax?.source).toBe('tree-sitter');
    expect(result.outputPreview).toContain('syntax error');
  });

  it('omits the validation key for a clean edit', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({
      workspaceRoot: root,
      languageRegistry: new LanguageRegistry(),
    });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'clean.ts', originalCode: '', newCode: 'export const x: number = 1;\n' }],
    });
    const result = await prepared.execute();
    expect(result.ok).toBe(true);
    expect((result.output as WriteOutput).validation).toBeUndefined();
    expect(result.outputPreview).not.toContain('validation issues');
  });

  it('scans only the generated newCode, not pre-existing file markers (C1)', async () => {
    const root = await tempWorkspace();
    // The file already carries a leftover-shaped comment the model did NOT write.
    await writeFile(join(root, 'legacy.ts'), 'const keep = 1; // TODO: implement later\n', 'utf8');
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'legacy.ts', originalCode: 'const keep = 1;', newCode: 'const keep = 2;' }],
    });
    const result = await prepared.execute();
    // No false positive: the scan sees only the clean replacement block.
    expect((result.output as WriteOutput).validation).toBeUndefined();
  });

  it('surfaces only NEWLY-introduced diagnostics via an injected provider (D1/G)', async () => {
    const root = await tempWorkspace();
    const introduced: Diagnostic = {
      source: 'tsc',
      file: 'app.ts',
      line: 1,
      code: 'TS2304',
      severity: 'error',
      message: "Cannot find name 'oops'.",
    };
    // Baseline (prepare, 1st call) is clean; after (execute, 2nd call) has the
    // new error — the delta-gate reports exactly the surplus.
    let call = 0;
    const diagnostics: DiagnosticProvider = {
      diagnostics: () => Promise.resolve(call++ === 0 ? [] : [introduced]),
    };
    const registry = buildDefaultToolRegistry({ workspaceRoot: root, diagnostics });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'app.ts', originalCode: '', newCode: 'oops();\n' }],
    });
    const result = await prepared.execute();
    const output = result.output as WriteOutput;
    expect(output.validation?.[0]?.newDiagnostics).toHaveLength(1);
    expect(output.validation?.[0]?.newDiagnostics[0]?.code).toBe('TS2304');
    expect(result.outputPreview).toContain('1 new diagnostic(s)');
  });

  it('reports no new diagnostics when the provider sees the same set before and after', async () => {
    const root = await tempWorkspace();
    const preexisting: Diagnostic = {
      source: 'eslint',
      file: 'app.ts',
      line: 9,
      code: 'no-console',
      severity: 'warning',
      message: 'Unexpected console statement.',
    };
    // Same diagnostic in baseline and after → a line shift must NOT report it.
    const diagnostics: DiagnosticProvider = {
      diagnostics: () => Promise.resolve([preexisting]),
    };
    const registry = buildDefaultToolRegistry({ workspaceRoot: root, diagnostics });
    const prepared = await registry.get('write_files')!.prepare({
      edits: [{ file: 'app.ts', originalCode: '', newCode: 'const x = 1;\n' }],
    });
    const result = await prepared.execute();
    expect((result.output as WriteOutput).validation).toBeUndefined();
  });
});

describe('MapToolRegistry', () => {
  const fakeTool: RegisteredTool = {
    definition: { name: 'fake', description: 'x', input_schema: { type: 'object' } },
    mutates: false,
    prepare: () =>
      Promise.resolve({
        execute: () => Promise.resolve({ ok: true, output: 'ok', outputPreview: 'ok' }),
      }),
  };

  it('keys tools by definition name and returns undefined for unknowns', () => {
    const registry = new MapToolRegistry([fakeTool]);
    expect(registry.get('fake')).toBe(fakeTool);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.definitions().map((d) => d.name)).toEqual(['fake']);
  });

  it('omits mutating tools when definitions({ mutating: false }) (T-PRD08 read-only mode)', () => {
    const writeTool: RegisteredTool = {
      ...fakeTool,
      definition: { ...fakeTool.definition, name: 'write_files' },
      mutates: true,
    };
    const registry = new MapToolRegistry([fakeTool, writeTool]);
    // Default + explicit-true list every tool; the read-only filter drops the mutating one.
    expect(
      registry
        .definitions()
        .map((d) => d.name)
        .sort(),
    ).toEqual(['fake', 'write_files']);
    expect(
      registry
        .definitions({ mutating: true })
        .map((d) => d.name)
        .sort(),
    ).toEqual(['fake', 'write_files']);
    expect(registry.definitions({ mutating: false }).map((d) => d.name)).toEqual(['fake']);
  });

  it('the default registry flags write_files as the only mutating tool', () => {
    const registry = buildDefaultToolRegistry({ workspaceRoot: '/tmp' });
    expect(registry.get('write_files')?.mutates).toBe(true);
    for (const name of ['read_file', 'list_dir', 'glob', 'grep']) {
      expect(registry.get(name)?.mutates).toBe(false);
    }
  });
});
