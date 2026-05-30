import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteFilesTool } from './write-files.js';

let root: string;
let tool: WriteFilesTool;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'event4u-writefiles-'));
  tool = new WriteFilesTool(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('WriteFilesTool.propose', () => {
  it('resolves a literal single-file edit', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\nconst y = 2;\n');
    const plan = await tool.propose({
      edits: [{ file: 'a.ts', originalCode: 'const x = 1;', newCode: 'const x = 42;' }],
    });
    expect(plan.ok).toBe(true);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.newContent).toBe('const x = 42;\nconst y = 2;\n');
  });

  it('composes two edits to the same file in order', async () => {
    await writeFile(join(root, 'a.ts'), 'a();\nb();\n');
    const plan = await tool.propose({
      edits: [
        { file: 'a.ts', originalCode: 'a();', newCode: 'A();' },
        { file: 'a.ts', originalCode: 'b();', newCode: 'B();' },
      ],
    });
    expect(plan.ok).toBe(true);
    expect(plan.files[0]!.newContent).toBe('A();\nB();\n');
  });

  it('creates a new file from an empty originalCode', async () => {
    const plan = await tool.propose({
      edits: [{ file: 'sub/new.ts', originalCode: '', newCode: 'export const z = 1;\n' }],
    });
    expect(plan.ok).toBe(true);
    expect(plan.files[0]!.isNewFile).toBe(true);
    expect(plan.files[0]!.newContent).toBe('export const z = 1;\n');
  });

  it('appends without a locate', async () => {
    await writeFile(join(root, 'log.txt'), 'line1');
    const plan = await tool.propose({
      edits: [{ file: 'log.txt', originalCode: '', newCode: 'line2\n', append: true }],
    });
    expect(plan.ok).toBe(true);
    expect(plan.files[0]!.newContent).toBe('line1\nline2\n');
  });

  it('flags an ambiguous edit without replaceAll', async () => {
    await writeFile(join(root, 'a.ts'), 'x();\nx();\n');
    const plan = await tool.propose({
      edits: [{ file: 'a.ts', originalCode: 'x();', newCode: 'y();' }],
    });
    expect(plan.ok).toBe(false);
    expect(plan.edits[0]!.status).toBe('ambiguous');
    expect(plan.files).toHaveLength(0);
  });

  it('replaces all occurrences with replaceAll', async () => {
    await writeFile(join(root, 'a.ts'), 'x();\nx();\n');
    const plan = await tool.propose({
      edits: [{ file: 'a.ts', originalCode: 'x();', newCode: 'y();', replaceAll: true }],
    });
    expect(plan.ok).toBe(true);
    expect(plan.files[0]!.newContent).toBe('y();\ny();\n');
  });

  it('surfaces a did-you-mean suggestion for a near-miss', async () => {
    await writeFile(join(root, 'a.ts'), 'if (ok) {\n  doThing(value);\n  cleanup();\n}\n');
    const plan = await tool.propose({
      edits: [
        {
          file: 'a.ts',
          originalCode: 'if (ok) {\n  doThing(value2);\n  cleanup();\n}',
          newCode: 'x',
        },
      ],
    });
    expect(plan.ok).toBe(false);
    expect(plan.edits[0]!.status).toBe('suggestion');
    expect(plan.edits[0]!.suggestion?.matchedSnippet).toContain('doThing');
  });

  it('marks not_found when the block is absent', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const plan = await tool.propose({
      edits: [{ file: 'a.ts', originalCode: 'totally absent block', newCode: 'x' }],
    });
    expect(plan.ok).toBe(false);
    expect(plan.edits[0]!.status).toBe('not_found');
  });

  it('rejects a path escaping the workspace', async () => {
    const plan = await tool.propose({
      edits: [{ file: '../escape.ts', originalCode: '', newCode: 'x' }],
    });
    expect(plan.ok).toBe(false);
    expect(plan.edits[0]!.status).toBe('error');
  });
});

describe('WriteFilesTool.apply', () => {
  it('writes resolved files to disk', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const plan = await tool.propose({
      edits: [
        { file: 'a.ts', originalCode: 'const x = 1;', newCode: 'const x = 2;' },
        { file: 'b.ts', originalCode: '', newCode: 'export const b = true;\n' },
      ],
    });
    const res = await tool.apply(plan);
    expect(res.ok).toBe(true);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const x = 2;\n');
    expect(await readFile(join(root, 'b.ts'), 'utf8')).toBe('export const b = true;\n');
  });

  it('refuses to apply a non-ok plan', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;\n');
    const plan = await tool.propose({
      edits: [{ file: 'a.ts', originalCode: 'missing', newCode: 'x' }],
    });
    const res = await tool.apply(plan);
    expect(res.ok).toBe(false);
  });

  it('rolls back already-written files when a later write fails', async () => {
    await writeFile(join(root, 'a.ts'), 'original-a\n');
    const plan = await tool.propose({
      edits: [
        { file: 'a.ts', originalCode: 'original-a', newCode: 'changed-a' },
        { file: 'b.ts', originalCode: '', newCode: 'new-b\n' },
      ],
    });
    // Force the second write to fail: make b.ts's parent path a file collision
    // by pointing the second planned file at an impossible path post-plan.
    plan.files[1] = { ...plan.files[1]!, absPath: join(root, 'a.ts', 'nested', 'b.ts') };
    const res = await tool.apply(plan);
    expect(res.ok).toBe(false);
    // a.ts must be restored to its original content.
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('original-a\n');
  });
});
