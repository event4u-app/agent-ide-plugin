import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml, YAMLParseError } from 'yaml';

/**
 * agent-config tree-walker (T-401, pulled forward from Phase 4).
 *
 * Scans the consumer project for skills / rules / commands distributed by
 * agent-config and indexes them in memory. Pure data transformation — no IDE
 * coupling, no networking. Schema validation is intentionally lax in v0:
 * frontmatter is exposed as a `Record<string, unknown>` so the walker stays
 * useful across the entire MVP without tracking agent-config's evolving
 * frontmatter contracts. T-402+ commands consume this index.
 */

export type ConfigKind = 'skill' | 'rule' | 'command';

export interface ConfigNode {
  /** "skill" / "rule" / "command" — derived from the directory it was found in. */
  kind: ConfigKind;
  /** File-base name without extension, e.g. "commit" or "verify-before-complete". */
  name: string;
  /** Absolute path to the source file. */
  absPath: string;
  /** Path relative to the source root that won the priority race. */
  relPath: string;
  /** Source root that won, e.g. ".event4u-agent". */
  sourceRoot: SourceRootId;
  /** Parsed YAML frontmatter (empty object when none present). */
  frontmatter: Record<string, unknown>;
  /** Body content after the closing `---`, or whole file if no frontmatter. */
  body: string;
}

export type SourceRootId = '.event4u-agent' | '.augment' | '.agent-src';

export const DEFAULT_SOURCE_ROOTS: readonly SourceRootId[] = [
  '.event4u-agent',
  '.augment',
  '.agent-src',
];

interface WalkOptions {
  /** Override the default search order. The first existing root wins per kind. */
  sourceRoots?: readonly SourceRootId[];
  /** Override the directory layout within a source root. Useful for tests. */
  kindDirs?: Record<ConfigKind, string>;
}

const DEFAULT_KIND_DIRS: Record<ConfigKind, string> = {
  skill: 'skills',
  rule: 'rules',
  command: 'commands',
};

export class AgentConfigWalkError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentConfigWalkError';
  }
}

/**
 * Walk the consumer project under `projectRoot` and return every Skill, Rule,
 * and Command discovered. Source-root priority: `.event4u-agent/` →
 * `.augment/` → `.agent-src/`. For a given kind, the first existing root wins
 * and shadows later roots; this matches the precedence described in the
 * roadmap (T-401) and in agent-config's customisation contract.
 *
 * On the same kind from two different roots: the higher-priority root's
 * nodes overlay lower-priority ones with the same `name`. This is the
 * agent-config layering rule.
 */
export async function walkAgentConfig(
  projectRoot: string,
  opts: WalkOptions = {},
): Promise<ConfigNode[]> {
  const roots = opts.sourceRoots ?? DEFAULT_SOURCE_ROOTS;
  const kindDirs = opts.kindDirs ?? DEFAULT_KIND_DIRS;
  const byKindAndName = new Map<string, ConfigNode>();

  for (const root of roots) {
    for (const [kind, subdir] of Object.entries(kindDirs) as Array<[ConfigKind, string]>) {
      const dir = join(projectRoot, root, subdir);
      const files = await listMarkdownFiles(dir);
      for (const file of files) {
        const key = `${kind}::${baseName(file)}`;
        if (byKindAndName.has(key)) continue; // higher-priority root already won
        const node = await loadNode(kind, file, projectRoot, root);
        byKindAndName.set(key, node);
      }
    }
  }

  return [...byKindAndName.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name);
  });
}

/**
 * Index a flat ConfigNode list by `kind`. Convenience for callers that want
 * `byKind.skill` etc.
 */
export function indexByKind(nodes: readonly ConfigNode[]): Record<ConfigKind, ConfigNode[]> {
  const out: Record<ConfigKind, ConfigNode[]> = { skill: [], rule: [], command: [] };
  for (const n of nodes) out[n.kind].push(n);
  return out;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (isErrno(err) && err.code === 'ENOENT') return [];
    throw new AgentConfigWalkError(`cannot read ${dir}`, err);
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue; // race / stale symlink — skip silently
    }
    if (s.isDirectory()) {
      // One nested level supports `skills/<slug>/SKILL.md` layouts.
      const nested = await readdir(full).catch(() => []);
      for (const n of nested) {
        if (n.endsWith('.md')) out.push(join(full, n));
      }
      continue;
    }
    if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

async function loadNode(
  kind: ConfigKind,
  absPath: string,
  projectRoot: string,
  sourceRoot: SourceRootId,
): Promise<ConfigNode> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch (err) {
    throw new AgentConfigWalkError(`cannot read ${absPath}`, err);
  }
  const { frontmatter, body } = splitFrontmatter(text, absPath);
  return {
    kind,
    name: baseName(absPath),
    absPath,
    relPath: relative(projectRoot, absPath).split(sep).join('/'),
    sourceRoot,
    frontmatter,
    body,
  };
}

/**
 * Parse a markdown document that *may* begin with a YAML frontmatter block
 * fenced by `---`. Mirrors gray-matter's behaviour for our subset: leading
 * BOM stripped, frontmatter is whatever sits between the first two `---`
 * delimiters, body is what follows. Files without a frontmatter open with
 * `frontmatter = {}` and body = entire file.
 */
export function splitFrontmatter(
  text: string,
  sourceLabel = '<inline>',
): { frontmatter: Record<string, unknown>; body: string } {
  const stripped = text.replace(/^\uFEFF/, '');
  if (!stripped.startsWith('---')) {
    return { frontmatter: {}, body: stripped };
  }
  // Tolerate `---` on the first line with optional trailing whitespace.
  const lines = stripped.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: stripped };
  }
  const closing = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
  if (closing === -1) {
    return { frontmatter: {}, body: stripped };
  }
  const yamlText = lines.slice(1, closing).join('\n');
  const body = lines.slice(closing + 1).join('\n');
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new AgentConfigWalkError(
        `frontmatter parse error in ${sourceLabel} at line ${err.linePos?.[0]?.line ?? '?'}: ${err.message}`,
        err,
      );
    }
    throw new AgentConfigWalkError(`frontmatter parse error in ${sourceLabel}`, err);
  }
  if (parsed == null) {
    return { frontmatter: {}, body };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentConfigWalkError(
      `frontmatter in ${sourceLabel} must be a mapping, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    );
  }
  return { frontmatter: parsed as Record<string, unknown>, body };
}

function baseName(path: string): string {
  const file = path.split(sep).pop() ?? path;
  // Conventional `skills/<slug>/SKILL.md` collapses to the slug; otherwise
  // strip the .md extension.
  if (file === 'SKILL.md') {
    const parts = path.split(sep);
    return parts[parts.length - 2] ?? 'SKILL';
  }
  return file.replace(/\.md$/, '');
}

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
