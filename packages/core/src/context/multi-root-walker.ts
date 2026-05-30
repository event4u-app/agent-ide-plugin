import { canonicalize, uriToPath, type Platform, type RootRegistry } from './roots.js';
import { WorkspaceWalker } from './walker.js';

/**
 * T-MR03 — Multi-root walker.
 *
 * Iterates the {@link RootRegistry}'s walkable roots (one per `canonicalKey` —
 * symlink duplicates already collapsed). Each root is walked independently with
 * its **own** ignore rules (`.gitignore` / `.augmentignore` + built-in
 * skip-list). For nested explicit roots, the parent **prunes** the child
 * subtree before ignore evaluation, so:
 *
 *   - a file is attributed to its **most-specific** owning root (the child),
 *   - the child stays a distinct registry entry, and
 *   - a parent `.gitignore` cannot suppress an explicitly-registered child.
 *
 * Output is `(rootId, path)` pairs where `path` is root-relative. Symlinked
 * duplicate roots never reach here — the registry collapses them to one
 * canonical entry.
 */

export interface WalkedFile {
  rootId: string;
  /** Root-relative path, `/`-separated. */
  path: string;
}

/** Segment-aware containment: is `child` the same as, or nested under, `parent`? */
export function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

export class MultiRootWalker {
  constructor(
    private readonly registry: RootRegistry,
    private readonly platform: Platform = process.platform,
  ) {}

  async walk(): Promise<WalkedFile[]> {
    const roots = this.registry.walkable();
    const out: WalkedFile[] = [];
    for (const root of roots) {
      // Child roots strictly nested under this root (exclude self).
      const childKeys = roots
        .filter((c) => c.stableId !== root.stableId && isWithin(c.canonicalKey, root.canonicalKey))
        .map((c) => c.canonicalKey);

      const rootCanon = root.canonicalKey;
      const skipDir = (relDir: string): boolean => {
        // Candidate canonical key of this directory, platform-folded the same
        // way the registry folded the child keys.
        const candidate = canonicalize(`${rootCanon}/${relDir}`, this.platform);
        return childKeys.some((ck) => candidate === ck);
      };

      const walker = new WorkspaceWalker({ root: uriToPath(root.uri) });
      const files = await walker.scan({ skipDir: childKeys.length > 0 ? skipDir : undefined });
      for (const path of files) out.push({ rootId: root.stableId, path });
    }
    return out;
  }
}
