import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globToRegex, makeReadTools } from './read-tools.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'event4u-read-tools-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(rel: string, content: string | Buffer): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
}

describe('read_file', () => {
  it('reads a UTF-8 file', async () => {
    await seed('src/index.ts', 'export const x = 1;\n');
    const { read_file } = makeReadTools({ workspaceRoot: root });
    expect(await read_file.run({ path: 'src/index.ts' })).toBe('export const x = 1;\n');
  });

  it('rejects paths escaping the workspace', async () => {
    const { read_file } = makeReadTools({ workspaceRoot: root });
    expect(await read_file.run({ path: '../etc/passwd' })).toMatch(/escapes/);
  });

  it('returns a binary-marker for binary files', async () => {
    await seed('img.bin', Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const { read_file } = makeReadTools({ workspaceRoot: root });
    expect(await read_file.run({ path: 'img.bin' })).toMatch(/^<binary file/);
  });

  it('reports missing files', async () => {
    const { read_file } = makeReadTools({ workspaceRoot: root });
    expect(await read_file.run({ path: 'nope.md' })).toMatch(/not found/);
  });

  it('slices by line range', async () => {
    await seed('lines.txt', '1\n2\n3\n4\n5\n');
    const { read_file } = makeReadTools({ workspaceRoot: root });
    expect(await read_file.run({ path: 'lines.txt', start_line: 2, end_line: 3 })).toBe('2\n3');
  });
});

describe('list_dir', () => {
  it('lists files + directories with a type prefix', async () => {
    await seed('src/a.ts', '');
    await seed('src/sub/b.ts', '');
    const { list_dir } = makeReadTools({ workspaceRoot: root });
    const out = await list_dir.run({ path: 'src' });
    expect(out).toMatch(/- a\.ts/);
    expect(out).toMatch(/d sub/);
  });

  it('reports missing directory', async () => {
    const { list_dir } = makeReadTools({ workspaceRoot: root });
    expect(await list_dir.run({ path: 'nope' })).toMatch(/not found/);
  });
});

describe('glob', () => {
  it('matches files via "**/*.ts"', async () => {
    await seed('src/a.ts', '');
    await seed('src/sub/b.ts', '');
    await seed('readme.md', '');
    const { glob } = makeReadTools({ workspaceRoot: root });
    const out = await glob.run({ pattern: '**/*.ts' });
    expect(out.split('\n').sort()).toEqual(['src/a.ts', 'src/sub/b.ts']);
  });

  it('returns "(no matches)" when nothing fits', async () => {
    await seed('only.md', '');
    const { glob } = makeReadTools({ workspaceRoot: root });
    expect(await glob.run({ pattern: '**/*.ts' })).toBe('(no matches)');
  });
});

describe('grep', () => {
  it('returns path:line:content for each match', async () => {
    await seed('src/a.ts', 'export const a = 1;\nexport const b = 2;\n');
    await seed('src/b.ts', 'const c = 3;\n');
    const { grep } = makeReadTools({ workspaceRoot: root });
    const out = await grep.run({ pattern: 'export', flags: 'g' });
    const lines = out.split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line).toMatch(/^src\/a\.ts:\d+:/);
    }
  });

  it('survives an invalid regex without crashing', async () => {
    const { grep } = makeReadTools({ workspaceRoot: root });
    expect(await grep.run({ pattern: '(' })).toMatch(/invalid regex/);
  });

  it('reports "(no matches)" cleanly', async () => {
    await seed('src/a.ts', 'export const a = 1;\n');
    const { grep } = makeReadTools({ workspaceRoot: root });
    expect(await grep.run({ pattern: 'nothing-to-find' })).toBe('(no matches)');
  });
});

describe('globToRegex', () => {
  it('translates ** to multi-segment match', () => {
    const re = globToRegex('src/**/*.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/x/y/z.ts')).toBe(true);
    expect(re.test('other/a.ts')).toBe(false);
  });

  it('translates * to single-segment match', () => {
    const re = globToRegex('*.md');
    expect(re.test('README.md')).toBe(true);
    expect(re.test('docs/foo.md')).toBe(false);
  });

  it('escapes literal punctuation', () => {
    const re = globToRegex('a.b');
    expect(re.test('a.b')).toBe(true);
    expect(re.test('aXb')).toBe(false);
  });
});
