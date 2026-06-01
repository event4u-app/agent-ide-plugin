import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultToolRegistry, MapToolRegistry, type RegisteredTool } from './tool-registry.js';

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
