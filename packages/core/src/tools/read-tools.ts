import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '@event4u-agent/protocol';

/**
 * T-302 — read-side tools.
 *
 * Four permission-`low` tools the agent can call without diff approval:
 * `read_file`, `list_dir`, `glob`, and `grep`. All paths resolve inside the
 * caller-supplied `workspaceRoot`; absolute paths or `..` escapes are
 * rejected (return an error string) so a misbehaving model can't read
 * outside the project.
 */

const MAX_READ_BYTES = 256 * 1024; // 256 KiB — keep token cost bounded
const MAX_LIST_ENTRIES = 500;
const MAX_GLOB_RESULTS = 1000;
const MAX_GREP_RESULTS = 200;

export const ReadFileArgsSchema = z.object({
  path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
});
export type ReadFileArgs = z.infer<typeof ReadFileArgsSchema>;

export const ListDirArgsSchema = z.object({
  path: z.string().min(1),
});
export type ListDirArgs = z.infer<typeof ListDirArgsSchema>;

export const GlobArgsSchema = z.object({
  pattern: z.string().min(1),
  /** Anchor the search inside this subdir of the workspace. */
  cwd: z.string().optional(),
});
export type GlobArgs = z.infer<typeof GlobArgsSchema>;

export const GrepArgsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  /** ECMAScript regex flags. Default: case-sensitive, multi-line. */
  flags: z.string().optional(),
});
export type GrepArgs = z.infer<typeof GrepArgsSchema>;

export interface ReadToolsOptions {
  /** Absolute path the tools resolve every input against. */
  workspaceRoot: string;
  /** Override for unit tests; defaults to globbing the real fs. */
  walk?: (dir: string) => Promise<string[]>;
}

export interface ToolHandler<A, R> {
  name: string;
  definition: ToolDefinition;
  args: z.ZodType<A>;
  run(args: A): Promise<R>;
}

export function makeReadTools(opts: ReadToolsOptions): {
  read_file: ToolHandler<ReadFileArgs, string>;
  list_dir: ToolHandler<ListDirArgs, string>;
  glob: ToolHandler<GlobArgs, string>;
  grep: ToolHandler<GrepArgs, string>;
} {
  const { workspaceRoot } = opts;

  function resolveInside(input: string): string | { error: string } {
    const candidate = resolve(workspaceRoot, input);
    const rel = relative(workspaceRoot, candidate);
    if (rel.startsWith('..') || rel === '..') {
      return { error: `path "${input}" escapes the workspace root` };
    }
    return candidate;
  }

  const read_file: ToolHandler<ReadFileArgs, string> = {
    name: 'read_file',
    args: ReadFileArgsSchema,
    definition: {
      name: 'read_file',
      description:
        'Read a UTF-8 text file from the workspace. Optional start_line/end_line slice the output. Binary files come back as "<binary file, N bytes>".',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          start_line: { type: 'integer', minimum: 1 },
          end_line: { type: 'integer', minimum: 1 },
        },
        required: ['path'],
      },
    },
    async run(args) {
      const resolved = resolveInside(args.path);
      if (typeof resolved !== 'string') return resolved.error;
      const info = await stat(resolved).catch(() => undefined);
      if (!info) return `file not found: ${args.path}`;
      if (info.isDirectory()) return `path is a directory, not a file: ${args.path}`;
      const buffer = await readFile(resolved);
      if (buffer.length === 0) return '';
      if (isLikelyBinary(buffer)) return `<binary file, ${buffer.length} bytes>`;
      let text = buffer.toString('utf8');
      if (buffer.length > MAX_READ_BYTES) {
        text = text.slice(0, MAX_READ_BYTES);
        text += `\n…<truncated at ${MAX_READ_BYTES} bytes; file is ${buffer.length} bytes>`;
      }
      if (args.start_line || args.end_line) {
        const lines = text.split('\n');
        const start = (args.start_line ?? 1) - 1;
        const end = args.end_line ?? lines.length;
        text = lines.slice(start, end).join('\n');
      }
      return text;
    },
  };

  const list_dir: ToolHandler<ListDirArgs, string> = {
    name: 'list_dir',
    args: ListDirArgsSchema,
    definition: {
      name: 'list_dir',
      description: 'List immediate entries under a workspace-relative directory.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    async run(args) {
      const resolved = resolveInside(args.path);
      if (typeof resolved !== 'string') return resolved.error;
      const entries = await readdir(resolved, { withFileTypes: true }).catch(
        () => undefined,
      );
      if (!entries) return `directory not found: ${args.path}`;
      const lines = entries
        .slice(0, MAX_LIST_ENTRIES)
        .map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`);
      if (entries.length > MAX_LIST_ENTRIES) {
        lines.push(`…<truncated; ${entries.length - MAX_LIST_ENTRIES} more>`);
      }
      return lines.join('\n');
    },
  };

  const glob: ToolHandler<GlobArgs, string> = {
    name: 'glob',
    args: GlobArgsSchema,
    definition: {
      name: 'glob',
      description:
        'Find workspace files matching a glob pattern (e.g. "src/**/*.ts"). Returns workspace-relative paths, one per line.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          cwd: { type: 'string' },
        },
        required: ['pattern'],
      },
    },
    async run(args) {
      const base = args.cwd ? resolveInside(args.cwd) : workspaceRoot;
      if (typeof base !== 'string') return base.error;
      const all = await (opts.walk ?? walkFs)(base);
      const regex = globToRegex(args.pattern);
      const matches: string[] = [];
      for (const abs of all) {
        const rel = relative(workspaceRoot, abs).split(sep).join('/');
        if (regex.test(rel)) {
          matches.push(rel);
          if (matches.length >= MAX_GLOB_RESULTS) {
            matches.push(`…<truncated at ${MAX_GLOB_RESULTS} matches>`);
            break;
          }
        }
      }
      return matches.length === 0 ? '(no matches)' : matches.join('\n');
    },
  };

  const grep: ToolHandler<GrepArgs, string> = {
    name: 'grep',
    args: GrepArgsSchema,
    definition: {
      name: 'grep',
      description:
        'Search workspace files for a regex pattern. Returns "path:line:content" lines.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: 'Restrict to a file or subdir.' },
          flags: { type: 'string', description: 'JS regex flags (default: empty).' },
        },
        required: ['pattern'],
      },
    },
    async run(args) {
      let regex: RegExp;
      try {
        // Strip 'g' — we test() line-by-line, and stateful lastIndex would
        // skip matches across the loop.
        const cleanFlags = (args.flags ?? '').replace(/g/g, '');
        regex = new RegExp(args.pattern, cleanFlags);
      } catch (err) {
        return `invalid regex: ${err instanceof Error ? err.message : String(err)}`;
      }
      const base = args.path ? resolveInside(args.path) : workspaceRoot;
      if (typeof base !== 'string') return base.error;
      const targets: string[] = [];
      const info = await stat(base).catch(() => undefined);
      if (!info) return `path not found: ${args.path ?? '.'}`;
      if (info.isFile()) {
        targets.push(base);
      } else {
        for (const f of await (opts.walk ?? walkFs)(base)) targets.push(f);
      }
      const lines: string[] = [];
      for (const file of targets) {
        const buf = await readFile(file).catch(() => undefined);
        if (!buf || isLikelyBinary(buf)) continue;
        const rel = relative(workspaceRoot, file).split(sep).join('/');
        const text = buf.toString('utf8');
        const fileLines = text.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
          if (regex.test(fileLines[i] ?? '')) {
            lines.push(`${rel}:${i + 1}:${fileLines[i]}`);
            if (lines.length >= MAX_GREP_RESULTS) {
              lines.push(`…<truncated at ${MAX_GREP_RESULTS} matches>`);
              return lines.join('\n');
            }
          }
        }
      }
      return lines.length === 0 ? '(no matches)' : lines.join('\n');
    },
  };

  return { read_file, list_dir, glob, grep };
}

function isLikelyBinary(buffer: Buffer): boolean {
  // Heuristic: NUL byte in the first 8 KiB → binary.
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

async function walkFs(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'out')
        continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await recurse(full);
      else if (e.isFile()) out.push(full);
    }
  }
  await recurse(dir);
  return out;
}

/**
 * Minimal glob → RegExp translator. Supports `*`, `?`, and `**` segments;
 * everything else is treated as a literal. Sufficient for the MVP scope —
 * future iterations can wire in `picomatch` when consumer demand justifies
 * the dependency.
 */
export function globToRegex(pattern: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      // `**/` — zero or more path segments.
      re += '(?:[^/]*/)*';
      i += 3;
      continue;
    }
    if (c === '*' && pattern[i + 1] === '*') {
      // Trailing `**` — match anything remaining.
      re += '.*';
      i += 2;
      continue;
    }
    if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+()|^${}[]\\'.includes(c ?? '')) {
      re += `\\${c}`;
    } else {
      re += c;
    }
    i += 1;
  }
  re += '$';
  return new RegExp(re);
}
