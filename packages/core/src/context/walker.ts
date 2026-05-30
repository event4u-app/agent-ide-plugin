import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import ignore, { type Ignore } from 'ignore';

/**
 * T-601 — Workspace walker.
 *
 * Scans the project root and (incrementally) watches it, honouring
 * `.gitignore` + `.augmentignore` plus a built-in skip-list. `scan()` does the
 * initial full enumeration; `watch()` wires chokidar with a debounce so the
 * incremental re-index (T-604) coalesces editor save-storms.
 */

const BUILTIN_SKIP = [
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  'vendor',
  '.next',
  '.turbo',
  'target',
];

export interface WalkerOptions {
  root: string;
  /** Extra ignore globs beyond the ignore files + built-in skip-list. */
  extraIgnore?: string[];
}

export class WorkspaceWalker {
  private ig?: Ignore;
  constructor(private readonly opts: WalkerOptions) {}

  /** Load `.gitignore` + `.augmentignore` + built-in patterns into the matcher. */
  async loadIgnore(): Promise<Ignore> {
    const ig = ignore();
    ig.add(BUILTIN_SKIP);
    if (this.opts.extraIgnore) ig.add(this.opts.extraIgnore);
    for (const file of ['.gitignore', '.augmentignore']) {
      const patterns = await readFile(join(this.opts.root, file), 'utf8').catch(() => '');
      if (patterns) ig.add(patterns);
    }
    this.ig = ig;
    return ig;
  }

  /** True when a workspace-relative path is ignored. */
  isIgnored(relPath: string): boolean {
    const normalized = relPath.split(sep).join('/');
    if (!normalized || normalized.startsWith('..')) return true;
    return (this.ig ?? ignore().add(BUILTIN_SKIP)).ignores(normalized);
  }

  /**
   * Full recursive enumeration of non-ignored files (workspace-relative paths).
   *
   * `opts.skipDir` (T-MR03) prunes a subtree before ignore evaluation — the
   * multi-root walker uses it to exclude a nested explicit child root so the
   * child owns those files and a parent `.gitignore` cannot suppress the child.
   */
  async scan(opts: { skipDir?: (relDir: string) => boolean } = {}): Promise<string[]> {
    await this.loadIgnore();
    const out: string[] = [];
    await this.walkDir(this.opts.root, out, opts.skipDir);
    return out.sort();
  }

  private async walkDir(
    dir: string,
    out: string[],
    skipDir?: (relDir: string) => boolean,
  ): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(this.opts.root, full).split(sep).join('/');
      if (entry.isDirectory()) {
        // Prune child roots before ignore so the parent ignore cannot suppress them.
        if (skipDir?.(rel)) continue;
        // Match directories with a trailing slash so ignore rules apply.
        if (this.isIgnored(`${rel}/`) || BUILTIN_SKIP.includes(entry.name)) continue;
        await this.walkDir(full, out, skipDir);
      } else if (entry.isFile()) {
        if (!this.isIgnored(rel)) out.push(rel);
      }
    }
  }

  /**
   * Watch the root, emitting debounced add/change/unlink events with
   * workspace-relative paths. Ignored paths are filtered. Returns the chokidar
   * watcher so the caller can `.close()` it.
   */
  watch(
    handlers: { onChange: (rel: string) => void; onUnlink: (rel: string) => void },
    debounceMs = 2000,
  ): FSWatcher {
    const watcher = chokidar.watch(this.opts.root, {
      ignoreInitial: true,
      ignored: (p: string) => {
        const rel = relative(this.opts.root, p).split(sep).join('/');
        return rel.length > 0 && this.isIgnored(rel);
      },
    });
    const timers = new Map<string, NodeJS.Timeout>();
    const debounce = (rel: string, fn: () => void) => {
      const existing = timers.get(rel);
      if (existing) clearTimeout(existing);
      timers.set(
        rel,
        setTimeout(() => {
          timers.delete(rel);
          fn();
        }, debounceMs),
      );
    };
    const rel = (p: string) => relative(this.opts.root, p).split(sep).join('/');
    watcher.on('add', (p) => debounce(rel(p), () => handlers.onChange(rel(p))));
    watcher.on('change', (p) => debounce(rel(p), () => handlers.onChange(rel(p))));
    watcher.on('unlink', (p) => debounce(rel(p), () => handlers.onUnlink(rel(p))));
    return watcher;
  }
}
