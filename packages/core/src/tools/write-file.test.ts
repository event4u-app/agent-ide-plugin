import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unifiedDiff, WriteFileTool } from './write-file.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'event4u-write-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('WriteFileTool.propose', () => {
  it('produces a diff for a new file', async () => {
    const tool = new WriteFileTool(root);
    const proposal = await tool.propose({ path: 'new.ts', content: 'export const x = 1;\n' });
    if ('error' in proposal) throw new Error(proposal.error);
    expect(proposal.isNewFile).toBe(true);
    expect(proposal.oldContent).toBe('');
    expect(proposal.diff).toMatch(/^--- a\/new\.ts/m);
    expect(proposal.diff).toMatch(/\+export const x = 1;/);
  });

  it('produces a diff for an existing file', async () => {
    await writeFile(join(root, 'a.ts'), 'old line\n');
    const tool = new WriteFileTool(root);
    const proposal = await tool.propose({ path: 'a.ts', content: 'new line\n' });
    if ('error' in proposal) throw new Error(proposal.error);
    expect(proposal.isNewFile).toBe(false);
    expect(proposal.diff).toMatch(/-old line/);
    expect(proposal.diff).toMatch(/\+new line/);
  });

  it('refuses paths escaping the workspace', async () => {
    const tool = new WriteFileTool(root);
    const proposal = await tool.propose({ path: '../escape.ts', content: 'x' });
    expect('error' in proposal).toBe(true);
  });
});

describe('WriteFileTool.apply', () => {
  it('writes the file when applied', async () => {
    const tool = new WriteFileTool(root);
    const proposal = await tool.propose({ path: 'out.txt', content: 'hello\n' });
    if ('error' in proposal) throw new Error(proposal.error);
    const result = await tool.apply(proposal, { mkdirs: true });
    expect(result.ok).toBe(true);
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hello\n');
  });

  it('creates parent dirs when mkdirs=true', async () => {
    const tool = new WriteFileTool(root);
    const proposal = await tool.propose({ path: 'nested/dir/file.txt', content: 'hi' });
    if ('error' in proposal) throw new Error(proposal.error);
    const result = await tool.apply(proposal, { mkdirs: true });
    expect(result.ok).toBe(true);
  });

  it('returns ok:false when the path is not writable', async () => {
    const tool = new WriteFileTool(root);
    const proposal = await tool.propose({
      path: 'unwritable/deep/file.txt',
      content: 'hi',
    });
    if ('error' in proposal) throw new Error(proposal.error);
    // mkdirs disabled → parent dir does not exist → write fails
    const result = await tool.apply(proposal);
    expect(result.ok).toBe(false);
  });
});

describe('unifiedDiff', () => {
  it('emits a single hunk for a one-line replace', () => {
    const out = unifiedDiff('old\n', 'new\n', 'demo.txt');
    expect(out).toContain('--- a/demo.txt');
    expect(out).toContain('+++ b/demo.txt');
    expect(out).toContain('-old');
    expect(out).toContain('+new');
  });

  it('handles fresh-file (no prior content)', () => {
    const out = unifiedDiff('', 'hello\n', 'fresh.md');
    expect(out).toContain('@@ -0,0 +1,');
  });

  it('handles deletion (empty new content)', () => {
    const out = unifiedDiff('bye\n', '', 'gone.md');
    expect(out).toContain('@@ -1,');
    expect(out).toContain('+0,0');
  });
});
