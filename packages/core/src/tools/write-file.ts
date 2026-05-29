import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '@event4u-agent/protocol';

/**
 * T-303 — single-file write with diff preview hand-off.
 *
 * Backend half of the diff-approval flow. The agent calls `write_file`, the
 * orchestrator computes a unified-diff preview and forwards it to the IDE
 * (JetBrains: `DiffManager.showDiff`, VS Code: `vscode.diff`). When the user
 * approves, the orchestrator calls `apply()`; on reject it discards the
 * proposal.
 *
 * Multi-file edit is v1.0 Sprint 6 per the roadmap.
 */

export const WriteFileArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** Create parent directories if missing. Default false (safer). */
  mkdirs: z.boolean().optional(),
});
export type WriteFileArgs = z.infer<typeof WriteFileArgsSchema>;

export interface WriteFileProposal {
  /** Workspace-relative path. */
  path: string;
  /** Absolute path the apply step will write to. */
  absPath: string;
  /** New content. */
  newContent: string;
  /** Existing content; empty string for a new file. */
  oldContent: string;
  /** Unified diff between old and new content. */
  diff: string;
  /** Whether the path existed before this proposal. */
  isNewFile: boolean;
}

export const writeFileToolDefinition: ToolDefinition = {
  name: 'write_file',
  description:
    'Propose writing UTF-8 content to a single workspace file. The IDE shows a diff for the user to approve before applying.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      content: { type: 'string', description: 'Full file content after the edit.' },
      mkdirs: {
        type: 'boolean',
        description: 'Create missing parent directories when the file is new.',
      },
    },
    required: ['path', 'content'],
  },
};

export class WriteFileTool {
  constructor(private readonly workspaceRoot: string) {}

  /** Prepare a diff for the IDE without touching disk. */
  async propose(args: WriteFileArgs): Promise<WriteFileProposal | { error: string }> {
    const abs = resolve(this.workspaceRoot, args.path);
    const rel = relative(this.workspaceRoot, abs);
    if (rel.startsWith('..')) return { error: `path "${args.path}" escapes the workspace root` };
    const existing = await readFile(abs, 'utf8').catch(() => undefined);
    const isNewFile = existing === undefined;
    const oldContent = existing ?? '';
    return {
      path: rel.split(/[\\/]/).join('/'),
      absPath: abs,
      newContent: args.content,
      oldContent,
      diff: unifiedDiff(oldContent, args.content, args.path),
      isNewFile,
    };
  }

  /** Apply a previously-approved proposal. */
  async apply(
    proposal: WriteFileProposal,
    options: { mkdirs?: boolean } = {},
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      if (proposal.isNewFile && options.mkdirs) {
        await mkdir(dirname(proposal.absPath), { recursive: true });
      }
      await writeFile(proposal.absPath, proposal.newContent, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Minimal unified-diff generator. Not git-quality, but sufficient for an
 * action-card preview. Avoids depending on `diff` (npm) for the MVP.
 */
export function unifiedDiff(oldText: string, newText: string, label = 'file'): string {
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n');
  const newLines = newText.length === 0 ? [] : newText.split('\n');
  const hunk: string[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      hunk.push(` ${oldLines[i]}`);
      i++;
      j++;
      continue;
    }
    // Greedy: emit minus-then-plus for each divergence.
    if (i < oldLines.length) {
      hunk.push(`-${oldLines[i]}`);
      i++;
    }
    if (j < newLines.length) {
      hunk.push(`+${newLines[j]}`);
      j++;
    }
  }
  const oldCount = oldLines.length === 0 ? '0,0' : `1,${oldLines.length}`;
  const newCount = newLines.length === 0 ? '0,0' : `1,${newLines.length}`;
  return [`--- a/${label}`, `+++ b/${label}`, `@@ -${oldCount} +${newCount} @@`, ...hunk].join(
    '\n',
  );
}
