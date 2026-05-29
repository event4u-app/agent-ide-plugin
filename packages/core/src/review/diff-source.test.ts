import { describe, expect, it } from 'vitest';
import { diffArgs, getDiff, parseUnifiedDiff } from './diff-source.js';
import type { GitRunner } from '../commands/commit.js';

const MULTI_FILE_DIFF = `diff --git a/packages/core/src/foo.ts b/packages/core/src/foo.ts
index 1111111..2222222 100644
--- a/packages/core/src/foo.ts
+++ b/packages/core/src/foo.ts
@@ -1,4 +1,5 @@
 export function foo() {
-  return 1;
+  const x = compute();
+  return x;
 }
 // trailing
diff --git a/packages/core/src/bar.ts b/packages/core/src/bar.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/packages/core/src/bar.ts
@@ -0,0 +1,2 @@
+export const bar = 42;
+export const baz = bar + 1;
diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 4444444..5555555 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -10,3 +10,3 @@ class Renamed {
-  old() {}
+  renamed() {}
 }
`;

describe('diffArgs', () => {
  it('builds staged / unstaged / range argv', () => {
    expect(diffArgs({ mode: 'staged' })).toContain('--cached');
    expect(diffArgs({ mode: 'unstaged' })).not.toContain('--cached');
    expect(diffArgs({ mode: 'range', base: 'main', head: 'HEAD' })).toContain('main...HEAD');
    expect(diffArgs({ mode: 'range', base: 'main' })).toContain('main...HEAD');
  });
});

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(MULTI_FILE_DIFF);

  it('parses every file entry', () => {
    expect(files.map((f) => f.file)).toEqual([
      'packages/core/src/foo.ts',
      'packages/core/src/bar.ts',
      'new/name.ts',
    ]);
  });

  it('detects status per file', () => {
    expect(files[0]?.status).toBe('modified');
    expect(files[1]?.status).toBe('added');
    expect(files[2]?.status).toBe('renamed');
    expect(files[2]?.oldFile).toBe('old/name.ts');
  });

  it('records correct hunk boundaries and per-row line numbers', () => {
    const fooHunk = files[0]?.hunks[0];
    expect(fooHunk).toMatchObject({ oldStart: 1, oldCount: 4, newStart: 1, newCount: 5 });
    // The two added lines get sequential new-file line numbers, no old line.
    const adds = fooHunk?.changes.filter((c) => c.kind === 'add');
    expect(adds?.map((c) => c.newLine)).toEqual([2, 3]);
    expect(adds?.every((c) => c.oldLine === null)).toBe(true);
    // The deleted line carries an old line and no new line.
    const dels = fooHunk?.changes.filter((c) => c.kind === 'del');
    expect(dels?.map((c) => c.oldLine)).toEqual([2]);
    expect(dels?.every((c) => c.newLine === null)).toBe(true);
  });

  it('captures the hunk section heading as context', () => {
    expect(files[2]?.hunks[0]?.section).toBe('class Renamed {');
  });

  it('marks binary files and gives them no hunks', () => {
    const bin = parseUnifiedDiff(
      `diff --git a/img.png b/img.png\nindex 0000000..1111111 100644\nBinary files a/img.png and b/img.png differ\n`,
    );
    expect(bin[0]?.binary).toBe(true);
    expect(bin[0]?.hunks).toHaveLength(0);
  });
});

describe('getDiff', () => {
  it('uses the injected runner and parses its output', async () => {
    const runner: GitRunner = {
      run: () => Promise.resolve({ stdout: MULTI_FILE_DIFF, stderr: '', exitCode: 0 }),
    };
    const files = await getDiff('/tmp', { mode: 'staged' }, runner);
    expect(files).toHaveLength(3);
  });

  it('throws on non-zero git exit', async () => {
    const runner: GitRunner = {
      run: () => Promise.resolve({ stdout: '', stderr: 'fatal: bad revision', exitCode: 128 }),
    };
    await expect(getDiff('/tmp', { mode: 'unstaged' }, runner)).rejects.toThrow(/git diff failed/);
  });
});
