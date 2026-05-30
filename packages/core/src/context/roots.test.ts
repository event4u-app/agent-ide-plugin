import { describe, expect, it } from 'vitest';
import { RootRegistry, canonicalize, uriToPath, type RealpathFn } from './roots.js';

/** A realpath stub: maps inputs to fixed outputs (default: identity). */
function fakeRealpath(map: Record<string, string> = {}): RealpathFn {
  return async (p) => {
    if (p in map) return map[p] as string;
    return p;
  };
}

describe('canonicalize', () => {
  it('unifies separators and strips a trailing slash', () => {
    expect(canonicalize('/repo/web/', 'linux')).toBe('/repo/web');
    expect(canonicalize('C:\\Repo\\Web\\', 'win32')).toBe('c:/repo/web');
  });

  it('preserves case on Linux but folds it on Windows/macOS', () => {
    expect(canonicalize('/repo/Web', 'linux')).toBe('/repo/Web');
    expect(canonicalize('/repo/Web', 'darwin')).toBe('/repo/web');
    expect(canonicalize('/Repo/Web', 'win32')).toBe('/repo/web');
  });

  it('collapses repeated slashes and keeps the bare root', () => {
    expect(canonicalize('/a//b///c', 'linux')).toBe('/a/b/c');
    expect(canonicalize('/', 'linux')).toBe('/');
  });
});

describe('uriToPath', () => {
  it('resolves file:// URIs and passes bare paths through', () => {
    expect(uriToPath('file:///repo/web')).toBe('/repo/web');
    expect(uriToPath('/repo/web')).toBe('/repo/web');
  });
});

describe('RootRegistry', () => {
  const linux = (map?: Record<string, string>) => new RootRegistry('linux', fakeRealpath(map));

  it('registers a single root (length-1 parity with today)', async () => {
    const reg = linux();
    await reg.add({ uri: '/repo', stableId: 's1', displayName: 'repo', kind: 'folder' });
    expect(reg.size).toBe(1);
    expect(reg.walkable().map((r) => r.stableId)).toEqual(['s1']);
    expect(reg.enabledRoots()).toHaveLength(1);
    expect(reg.get('s1')?.canonicalKey).toBe('/repo');
  });

  it('dedups two roots that resolve to the same canonical target', async () => {
    // s2's uri is a symlink that realpaths onto s1's target.
    const reg = linux({ '/repo/link': '/repo/real' });
    await reg.add({ uri: '/repo/real', stableId: 's-real', displayName: 'real', kind: 'folder' });
    await reg.add({ uri: '/repo/link', stableId: 's-link', displayName: 'link', kind: 'folder' });
    expect(reg.size).toBe(2);
    // Both share the canonicalKey; only the smallest stableId is walkable.
    const walkable = reg.walkable().map((r) => r.stableId);
    expect(walkable).toEqual(['s-link']); // 's-link' < 's-real' lexicographically
    expect(reg.isPrimary('s-real')).toBe(false);
  });

  it('re-elects the primary when the winning root is removed', async () => {
    const reg = linux({ '/a/link': '/a/real' });
    await reg.add({ uri: '/a/real', stableId: 'b-real', displayName: 'real', kind: 'folder' });
    await reg.add({ uri: '/a/link', stableId: 'a-link', displayName: 'link', kind: 'folder' });
    expect(reg.walkable().map((r) => r.stableId)).toEqual(['a-link']);
    reg.remove('a-link');
    // The surviving alias is promoted to primary.
    expect(reg.walkable().map((r) => r.stableId)).toEqual(['b-real']);
  });

  it('marks a root with an unresolvable path as disabled', async () => {
    const reg = new RootRegistry('linux', async () => {
      throw new Error('ELOOP');
    });
    const root = await reg.add({ uri: '/cycle', stableId: 's1', displayName: 'c', kind: 'folder' });
    expect(root.enabled).toBe(false);
    expect(reg.enabledRoots()).toHaveLength(0);
    // Still walkable for dedup bookkeeping, but excluded from the default scope.
    expect(reg.walkable()).toHaveLength(1);
  });

  it('honours an explicit enabled:false and setEnabled toggles', async () => {
    const reg = linux();
    await reg.add({ uri: '/r', stableId: 's', displayName: 'r', kind: 'folder', enabled: false });
    expect(reg.enabledRoots()).toHaveLength(0);
    reg.setEnabled('s', true);
    expect(reg.enabledRoots()).toHaveLength(1);
  });
});
