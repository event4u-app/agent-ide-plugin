import { describe, expect, it } from 'vitest';
import { mapWorkspaceFolders, mapWorkspaceFoldersChange } from './workspace-folders.js';

const folder = (uri: string, name: string) => ({ uri: { toString: () => uri }, name });

describe('mapWorkspaceFolders', () => {
  it('maps the no-folder window (undefined) to an empty list', () => {
    expect(mapWorkspaceFolders(undefined)).toEqual([]);
  });

  it('maps a multi-folder .code-workspace, stableId = uri', () => {
    const mapped = mapWorkspaceFolders([
      folder('file:///repo/web', 'web'),
      folder('file:///repo/api', 'api'),
    ]);
    expect(mapped).toEqual([
      { uri: 'file:///repo/web', stableId: 'file:///repo/web', displayName: 'web', kind: 'folder' },
      { uri: 'file:///repo/api', stableId: 'file:///repo/api', displayName: 'api', kind: 'folder' },
    ]);
  });

  it('keeps duplicate basenames distinct via their uri', () => {
    const mapped = mapWorkspaceFolders([
      folder('file:///a/src', 'src'),
      folder('file:///b/src', 'src'),
    ]);
    expect(mapped.map((f) => f.stableId)).toEqual(['file:///a/src', 'file:///b/src']);
  });

  it('preserves a user-renamed folder label', () => {
    expect(mapWorkspaceFolders([folder('file:///repo/x', 'Frontend')])[0]!.displayName).toBe(
      'Frontend',
    );
  });

  it('maps virtual / remote URIs unchanged (degrades gracefully)', () => {
    expect(mapWorkspaceFolders([folder('vscode-remote://ssh/box/repo', 'repo')])[0]!.uri).toBe(
      'vscode-remote://ssh/box/repo',
    );
  });
});

describe('mapWorkspaceFoldersChange', () => {
  it('maps added folders and removed stableIds', () => {
    const delta = mapWorkspaceFoldersChange({
      added: [folder('file:///repo/new', 'new')],
      removed: [folder('file:///repo/old', 'old')],
    });
    expect(delta.added).toEqual([
      { uri: 'file:///repo/new', stableId: 'file:///repo/new', displayName: 'new', kind: 'folder' },
    ]);
    expect(delta.removed).toEqual(['file:///repo/old']);
  });
});
