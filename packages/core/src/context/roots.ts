import { realpath as realpathCb } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * T-MR02 — `WorkspaceRoot` model + registry.
 *
 * A **root** is one indexable project directory. The Core never identifies a
 * root by a bare absolute path — paths break under Remote/WSL, cross-drive,
 * symlinks, and case-insensitive filesystems. Three distinct identities, never
 * conflated (council-frozen contract, see `docs/MANUAL_VERIFICATION.md`
 * § T-MR01):
 *
 *   - `uri`          — primary identity the client speaks (`file://`, …).
 *   - `stableId`     — client-supplied **persistence key** (survives relocation).
 *   - `canonicalKey` — `realpath`-derived **dedup key**, CORE-derived (never
 *                      client-supplied — a client-computed key drifts across
 *                      WSL/host). Platform/filesystem-aware: lower-cased on
 *                      Windows + case-insensitive macOS, case-preserved on Linux.
 *
 * The `RootRegistry` is keyed by `stableId` and dedups by `canonicalKey`: when
 * two registered roots resolve to the same canonical target (one via symlink)
 * they collapse to a single walkable root; the winner is the lexicographically
 * smallest `stableId` (deterministic across restarts), the loser is retained as
 * an alias so path-based client events still map back to the primary.
 */

/** Client-supplied root descriptor. `canonicalKey` is filled in by the registry. */
export interface WorkspaceRootInput {
  uri: string;
  stableId: string;
  displayName: string;
  kind: string;
  enabled?: boolean;
}

/** A registered root, with the Core-derived `canonicalKey`. */
export interface WorkspaceRoot {
  uri: string;
  stableId: string;
  canonicalKey: string;
  displayName: string;
  kind: string;
  enabled: boolean;
}

export type Platform = 'win32' | 'darwin' | 'linux' | string;

/** Resolve a `file://` URI (or a bare path) to a filesystem path. */
export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) return fileURLToPath(uri);
  return uri;
}

/**
 * Normalize a filesystem path into a comparable dedup key. Separators are
 * unified to `/` and a trailing slash is stripped (except a bare root). Casing
 * is folded only on case-insensitive platforms: Windows and (by pragmatic
 * default) macOS; Linux preserves case so `/repo/Web` and `/repo/web` stay
 * distinct.
 */
export function canonicalize(fsPath: string, platform: Platform = process.platform): string {
  let key = fsPath.split('\\').join('/');
  // Collapse repeated slashes, then drop a trailing slash unless it is the root.
  key = key.replace(/\/{2,}/g, '/');
  if (key.length > 1 && key.endsWith('/')) key = key.slice(0, -1);
  const caseInsensitive = platform === 'win32' || platform === 'darwin';
  return caseInsensitive ? key.toLowerCase() : key;
}

/** Injectable realpath — defaults to the native fs resolver; overridable in tests. */
export type RealpathFn = (p: string) => Promise<string>;

// The promises `realpath` has no `.native`; the OS resolver (true on-disk
// casing, symlink-resolving) lives on the callback `fs.realpath.native`.
const realpathNative = promisify(realpathCb.native);
const nativeRealpath: RealpathFn = (p) => realpathNative(p);

export class RootRegistry {
  /** stableId → root. Aliases (deduped losers) are kept here too, but disabled. */
  private readonly byStableId = new Map<string, WorkspaceRoot>();
  /** canonicalKey → winning stableId (the walkable primary). */
  private readonly primaryByCanonical = new Map<string, string>();

  constructor(
    private readonly platform: Platform = process.platform,
    private readonly realpathFn: RealpathFn = nativeRealpath,
  ) {}

  /**
   * Register (or refresh) a root. Computes `canonicalKey` via realpath +
   * platform-aware normalization. On a realpath failure (missing dir, symlink
   * cycle / `ELOOP`) the root is recorded `enabled: false` with a best-effort
   * key derived from the input path. Returns the stored root.
   */
  async add(input: WorkspaceRootInput): Promise<WorkspaceRoot> {
    const fsPath = uriToPath(input.uri);
    let canonicalKey: string;
    let resolvable = true;
    try {
      canonicalKey = canonicalize(await this.realpathFn(fsPath), this.platform);
    } catch {
      canonicalKey = canonicalize(fsPath, this.platform);
      resolvable = false;
    }
    const root: WorkspaceRoot = {
      uri: input.uri,
      stableId: input.stableId,
      canonicalKey,
      displayName: input.displayName,
      kind: input.kind,
      enabled: resolvable && (input.enabled ?? true),
    };
    this.byStableId.set(root.stableId, root);
    this.recomputePrimary(canonicalKey);
    return root;
  }

  /** Remove a root by `stableId`. Re-elects the canonical primary if needed. */
  remove(stableId: string): void {
    const root = this.byStableId.get(stableId);
    if (!root) return;
    this.byStableId.delete(stableId);
    this.recomputePrimary(root.canonicalKey);
  }

  /** Toggle a root's `enabled` flag (no effect on alias status). */
  setEnabled(stableId: string, enabled: boolean): void {
    const root = this.byStableId.get(stableId);
    if (root) root.enabled = enabled;
  }

  get(stableId: string): WorkspaceRoot | undefined {
    return this.byStableId.get(stableId);
  }

  /** True when this stableId is the elected primary for its canonicalKey. */
  isPrimary(stableId: string): boolean {
    const root = this.byStableId.get(stableId);
    return !!root && this.primaryByCanonical.get(root.canonicalKey) === stableId;
  }

  /** All registered roots (primaries + aliases), insertion order. */
  all(): WorkspaceRoot[] {
    return [...this.byStableId.values()];
  }

  /**
   * The set of **walkable** roots: one per `canonicalKey` (the elected primary),
   * excluding aliases. This is what the multi-root walker iterates.
   */
  walkable(): WorkspaceRoot[] {
    return this.all().filter((r) => this.isPrimary(r.stableId));
  }

  /** Walkable roots that are also `enabled` — the default retrieval scope. */
  enabledRoots(): WorkspaceRoot[] {
    return this.walkable().filter((r) => r.enabled);
  }

  get size(): number {
    return this.byStableId.size;
  }

  /** Re-elect the lexicographically-smallest stableId as primary for a key. */
  private recomputePrimary(canonicalKey: string): void {
    const candidates = this.all()
      .filter((r) => r.canonicalKey === canonicalKey)
      .map((r) => r.stableId)
      .sort();
    const winner = candidates[0];
    if (winner) this.primaryByCanonical.set(canonicalKey, winner);
    else this.primaryByCanonical.delete(canonicalKey);
  }
}
