import type { WorkspaceFolder } from '@event4u-agent/protocol';

/**
 * T-MR09 — VS Code workspace-folder mapping (pure, no `vscode` import so it is
 * unit-testable without an Extension Host).
 *
 * `stableId` is the folder's `uri.toString()` — stable across casing changes
 * and relocation, and the same key VS Code uses internally. `displayName` is
 * the folder's `name`, which preserves a user-renamed `.code-workspace` label.
 * Duplicate basenames (`src`, `api`) stay distinct because the `uri` differs;
 * the human-facing disambiguation is the picker's job (Phase C, T-MR12).
 */

/** Structural slice of a `vscode.WorkspaceFolder` (avoids the `vscode` dep). */
export interface VsFolderLike {
  readonly uri: { toString(): string };
  readonly name: string;
}

/** Structural slice of a `vscode.WorkspaceFoldersChangeEvent`. */
export interface VsFoldersChangeLike {
  readonly added: readonly VsFolderLike[];
  readonly removed: readonly VsFolderLike[];
}

/** Map the current workspace folders (or `undefined` — the no-folder window). */
export function mapWorkspaceFolders(
  folders: readonly VsFolderLike[] | undefined,
): WorkspaceFolder[] {
  if (!folders) return [];
  return folders.map((folder) => ({
    uri: folder.uri.toString(),
    stableId: folder.uri.toString(),
    displayName: folder.name,
    kind: 'folder',
  }));
}

/** Map an `onDidChangeWorkspaceFolders` event to the protocol delta. */
export function mapWorkspaceFoldersChange(change: VsFoldersChangeLike): {
  added: WorkspaceFolder[];
  removed: string[];
} {
  return {
    added: mapWorkspaceFolders(change.added),
    removed: change.removed.map((folder) => folder.uri.toString()),
  };
}
