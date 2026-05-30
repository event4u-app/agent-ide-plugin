import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '@event4u-agent/protocol';
import { locate, type LocateSuggestion } from './locate.js';
import { unifiedDiff } from './write-file.js';

/**
 * T-702 — multi-file search-and-replace edit tool.
 *
 * The model emits a batch of {@link FileEdit}s, each carrying a *verbatim*
 * `originalCode` block and its `newCode` replacement (the SweepAI V4 contract —
 * never line numbers, never whole-file rewrites). {@link WriteFilesTool.propose}
 * resolves every edit against the current file content via the 3-tier
 * {@link locate}, composing multiple edits to the same file in order, and
 * returns a {@link WriteFilesPlan}. The plan is only `ok` when every edit
 * resolved exactly; unresolved edits surface a "did you mean?" suggestion or a
 * not-found marker so the agent loop can re-prompt instead of writing garbage.
 *
 * {@link WriteFilesTool.apply} is atomic across files: it snapshots every
 * target, writes each via temp-file + rename, and on any failure restores all
 * previously-written files (or deletes freshly-created ones).
 */

export const FileEditSchema = z.object({
  /** Workspace-relative path. */
  file: z.string().min(1),
  /**
   * Verbatim block to find. Empty when creating a new file or when `append`
   * is set.
   */
  originalCode: z.string().default(''),
  /** Replacement (or full content for a new file / appended text). */
  newCode: z.string(),
  /** Replace every literal occurrence rather than requiring exactly one. */
  replaceAll: z.boolean().optional(),
  /** Append `newCode` to the end of the file instead of search-replacing. */
  append: z.boolean().optional(),
});
export type FileEdit = z.infer<typeof FileEditSchema>;

export const WriteFilesArgsSchema = z.object({
  edits: z.array(FileEditSchema).min(1),
});
export type WriteFilesArgs = z.infer<typeof WriteFilesArgsSchema>;

export type EditStatus = 'resolved' | 'suggestion' | 'not_found' | 'ambiguous' | 'error';

export interface EditResult {
  /** Index into the original `edits` array. */
  index: number;
  file: string;
  status: EditStatus;
  message?: string;
  suggestion?: LocateSuggestion;
}

export interface PlannedFile {
  /** Workspace-relative, forward-slash path. */
  path: string;
  absPath: string;
  oldContent: string;
  newContent: string;
  isNewFile: boolean;
  diff: string;
}

export interface WriteFilesPlan {
  /** Files that resolved cleanly, ready for {@link WriteFilesTool.apply}. */
  files: PlannedFile[];
  /** One entry per input edit, in order. */
  edits: EditResult[];
  /** True only when every edit resolved exactly. */
  ok: boolean;
}

export const writeFilesToolDefinition: ToolDefinition = {
  name: 'write_files',
  description:
    'Apply a batch of search-and-replace edits across files. Each edit gives a verbatim originalCode block and its newCode replacement. Emit the original block exactly as it appears — never line numbers, never a whole-file rewrite. The IDE shows a bulk diff for approval before anything is written.',
  input_schema: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Workspace-relative path.' },
            originalCode: {
              type: 'string',
              description: 'Verbatim block to replace. Empty for a new file or append.',
            },
            newCode: { type: 'string', description: 'Replacement text.' },
            replaceAll: { type: 'boolean', description: 'Replace every occurrence.' },
            append: { type: 'boolean', description: 'Append newCode to the file.' },
          },
          required: ['file', 'newCode'],
        },
      },
    },
    required: ['edits'],
  },
};

interface RollbackEntry {
  absPath: string;
  existedBefore: boolean;
  originalContent: string;
}

export class WriteFilesTool {
  constructor(private readonly workspaceRoot: string) {}

  /** Resolve every edit against current file content without touching disk. */
  async propose(args: WriteFilesArgs): Promise<WriteFilesPlan> {
    const edits = args.edits;
    const results: EditResult[] = [];
    const planned: PlannedFile[] = [];

    // Group edit indices by absolute path, preserving emission order so
    // multiple edits to the same file compose left-to-right.
    const byFile = new Map<string, number[]>();
    const order: string[] = [];
    for (let i = 0; i < edits.length; i++) {
      const abs = this.resolveInside(edits[i]!.file);
      if (typeof abs !== 'string') {
        results[i] = { index: i, file: edits[i]!.file, status: 'error', message: abs.error };
        continue;
      }
      if (!byFile.has(abs)) {
        byFile.set(abs, []);
        order.push(abs);
      }
      byFile.get(abs)!.push(i);
    }

    for (const abs of order) {
      const indices = byFile.get(abs)!;
      const rel = relative(this.workspaceRoot, abs).split(/[\\/]/).join('/');
      const existing = await readFile(abs, 'utf8').catch(() => undefined);
      const isNewFile = existing === undefined;
      const oldContent = existing ?? '';
      let working = oldContent;
      let fileFailed = false;

      for (const i of indices) {
        const edit = edits[i]!;
        const applied = this.applyOne(working, edit, isNewFile && working === oldContent);
        results[i] = { index: i, file: rel, status: applied.status, ...applied.extra };
        if (applied.status === 'resolved') {
          working = applied.content;
        } else {
          fileFailed = true;
        }
      }

      if (!fileFailed) {
        planned.push({
          path: rel,
          absPath: abs,
          oldContent,
          newContent: working,
          isNewFile,
          diff: unifiedDiff(oldContent, working, rel),
        });
      }
    }

    const ok = results.every((r) => r.status === 'resolved');
    return { files: planned, edits: results, ok };
  }

  /** Apply a resolved plan atomically across all files. */
  async apply(plan: WriteFilesPlan): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!plan.ok) {
      return { ok: false, error: 'plan is not ok — unresolved edits remain' };
    }
    const rollback: RollbackEntry[] = [];
    try {
      for (const file of plan.files) {
        rollback.push({
          absPath: file.absPath,
          existedBefore: !file.isNewFile,
          originalContent: file.oldContent,
        });
        if (file.isNewFile) {
          await mkdir(dirname(file.absPath), { recursive: true });
        }
        await this.writeAtomic(file.absPath, file.newContent);
      }
      return { ok: true };
    } catch (err) {
      await this.rollback(rollback);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Resolve one edit against the working buffer. */
  private applyOne(
    working: string,
    edit: FileEdit,
    isFreshFile: boolean,
  ): { status: EditStatus; content: string; extra?: Partial<EditResult> } {
    if (edit.append) {
      const joined = working.length > 0 && !working.endsWith('\n') ? `${working}\n` : working;
      return { status: 'resolved', content: joined + edit.newCode };
    }
    if (edit.originalCode.length === 0) {
      if (isFreshFile) return { status: 'resolved', content: edit.newCode };
      return {
        status: 'error',
        content: working,
        extra: { message: 'originalCode is empty but the file already exists (use append?)' },
      };
    }

    const outcome = locate(working, edit.originalCode);
    if (outcome.kind === 'suggestion') {
      return {
        status: 'suggestion',
        content: working,
        extra: { suggestion: outcome.suggestion, message: 'closest match below threshold' },
      };
    }
    if (outcome.kind === 'none') {
      return {
        status: 'not_found',
        content: working,
        extra: { message: 'originalCode not found' },
      };
    }

    // exact
    if (outcome.occurrences > 1) {
      if (edit.replaceAll) {
        return { status: 'resolved', content: working.split(edit.originalCode).join(edit.newCode) };
      }
      return {
        status: 'ambiguous',
        content: working,
        extra: {
          message: `originalCode occurs ${outcome.occurrences} times — set replaceAll or add context`,
        },
      };
    }
    const { start, end } = outcome.match;
    return {
      status: 'resolved',
      content: working.slice(0, start) + edit.newCode + working.slice(end),
    };
  }

  private async writeAtomic(absPath: string, content: string): Promise<void> {
    const tmp = `${absPath}.event4u-${process.pid}.tmp`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, absPath);
  }

  private async rollback(entries: RollbackEntry[]): Promise<void> {
    for (const entry of entries) {
      try {
        if (entry.existedBefore) {
          await writeFile(entry.absPath, entry.originalContent, 'utf8');
        } else {
          await rm(entry.absPath, { force: true });
        }
      } catch {
        // Best-effort restore; a failure here is already logged by the caller.
      }
    }
  }

  private resolveInside(input: string): string | { error: string } {
    const abs = resolve(this.workspaceRoot, input);
    const rel = relative(this.workspaceRoot, abs);
    if (rel.startsWith('..') || rel === '..') {
      return { error: `path "${input}" escapes the workspace root` };
    }
    return abs;
  }
}
