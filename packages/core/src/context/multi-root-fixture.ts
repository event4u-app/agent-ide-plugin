import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * T-MR07 — Multi-root test fixture.
 *
 * Built **programmatically** in a tmp dir rather than committed under
 * `test/fixtures/multi-root/`: a committed symlink does not materialize on a
 * Windows CI checkout, and a committed tree outside `src/` would fall outside
 * the package `tsconfig`. The runtime build covers the same matrix the roadmap
 * specifies — two sibling repos, one nested explicit root, one symlinked
 * duplicate, per-root `.gitignore`, and a parent-ignores-child case.
 *
 * ```
 * <base>/
 *   repo-a/                 sibling root A
 *     .gitignore            → "generated/\nweb/\n"
 *     src/auth.ts           loginUser
 *     generated/gen.ts      (ignored by A)
 *     web/                  nested EXPLICIT child root (A's .gitignore lists web/)
 *       ui/widget.ts        renderWidget
 *   repo-b/                 sibling root B
 *     .gitignore            → "*.log\n"
 *     lib/billing.ts        createInvoice
 *     debug.log             (ignored by B)
 *   link-to-a -> repo-a     symlinked DUPLICATE of repo-a (dedup target)
 * ```
 */
export interface MultiRootFixture {
  base: string;
  repoA: string;
  repoB: string;
  webChild: string;
  /** Symlink path that resolves onto `repoA`; absent if the platform refused symlinks. */
  linkToA?: string;
}

export async function buildMultiRootFixture(): Promise<MultiRootFixture> {
  const base = await mkdtemp(join(tmpdir(), 'mr-fixture-'));
  const repoA = join(base, 'repo-a');
  const repoB = join(base, 'repo-b');
  const webChild = join(repoA, 'web');

  await mkdir(join(repoA, 'src'), { recursive: true });
  await mkdir(join(repoA, 'generated'), { recursive: true });
  await mkdir(join(webChild, 'ui'), { recursive: true });
  await mkdir(join(repoB, 'lib'), { recursive: true });

  await writeFile(join(repoA, '.gitignore'), 'generated/\nweb/\n');
  await writeFile(
    join(repoA, 'src/auth.ts'),
    'export function loginUser(name: string) {\n  return name;\n}\n',
  );
  await writeFile(join(repoA, 'generated/gen.ts'), 'export const generated = 0;\n');
  await writeFile(
    join(webChild, 'ui/widget.ts'),
    'export function renderWidget() {\n  return 1;\n}\n',
  );

  await writeFile(join(repoB, '.gitignore'), '*.log\n');
  await writeFile(
    join(repoB, 'lib/billing.ts'),
    'export function createInvoice(amount: number) {\n  return amount;\n}\n',
  );
  await writeFile(join(repoB, 'debug.log'), 'noise\n');

  const linkToA = join(base, 'link-to-a');
  let linkCreated = true;
  try {
    await symlink(repoA, linkToA, 'dir');
  } catch {
    linkCreated = false; // Windows without privilege, or unsupported FS.
  }

  return { base, repoA, repoB, webChild, linkToA: linkCreated ? linkToA : undefined };
}
