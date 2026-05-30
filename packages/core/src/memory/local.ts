import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { splitFrontmatter } from '../config/agent-config-walker.js';

/**
 * T-1104 — local memory store.
 *
 * The roadmap wording said "JSON files", but the actual agent-config memory
 * contract on disk is Markdown with YAML frontmatter (`name` / `description` /
 * `metadata.type`) plus a `MEMORY.md` index — the format humans edit and Git
 * tracks. Per the unanimous Phase 11 council, this store round-trips that
 * format so memories written here are readable by agent-config (and vice
 * versa). See ADR-006.
 *
 * Memories live under `<workspace>/.event4u-agent/memories/`. Each record is
 * one file `<name>.md`; `MEMORY.md` is a regenerated index (one pointer line
 * per record).
 */

/** MVP memory types (additive — unknown types are read through, not rejected). */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryRecord {
  /** kebab-case slug; the file is `<name>.md`. */
  name: string;
  /** One-line summary used by recall / the index. */
  description: string;
  /** Memory class; `user` and `feedback` are the MVP types. */
  type: string;
  /** The memory body (everything after the frontmatter). */
  body: string;
}

export const MEMORY_INDEX_FILE = 'MEMORY.md';

export class MemoryStoreError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MemoryStoreError';
  }
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class LocalMemoryStore {
  constructor(private readonly dir: string) {}

  /** Absolute path to the memories directory this store manages. */
  get directory(): string {
    return this.dir;
  }

  /** Read every memory record (skips the index file). Sorted by name. */
  async list(): Promise<MemoryRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') return [];
      throw new MemoryStoreError(`cannot read memory dir ${this.dir}`, err);
    }
    const records: MemoryRecord[] = [];
    for (const entry of entries) {
      if (entry === MEMORY_INDEX_FILE || !entry.endsWith('.md')) continue;
      const record = await this.readFileRecord(join(this.dir, entry), entry.replace(/\.md$/, ''));
      if (record) records.push(record);
    }
    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Read one record by name, or `undefined` when it does not exist. */
  async read(name: string): Promise<MemoryRecord | undefined> {
    assertName(name);
    return (await this.readFileRecord(join(this.dir, `${name}.md`), name)) ?? undefined;
  }

  /**
   * Create or overwrite a memory, then regenerate `MEMORY.md`. The directory
   * is created on demand.
   */
  async write(record: MemoryRecord): Promise<void> {
    assertName(record.name);
    await mkdir(this.dir, { recursive: true });
    const content = serializeRecord(record);
    await writeFile(join(this.dir, `${record.name}.md`), content, 'utf8');
    await this.regenerateIndex();
  }

  /** Delete a memory (no-op if absent), then regenerate `MEMORY.md`. */
  async delete(name: string): Promise<void> {
    assertName(name);
    await rm(join(this.dir, `${name}.md`), { force: true });
    await this.regenerateIndex();
  }

  /** Rebuild `MEMORY.md` from the current set of records. */
  async regenerateIndex(): Promise<void> {
    const records = await this.list();
    const lines = ['# Memory index', ''];
    for (const r of records) {
      const hook = r.description.trim();
      lines.push(`- [${r.name}](${r.name}.md)${hook ? ` — ${hook}` : ''}`);
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, MEMORY_INDEX_FILE), `${lines.join('\n')}\n`, 'utf8');
  }

  private async readFileRecord(absPath: string, name: string): Promise<MemoryRecord | undefined> {
    let text: string;
    try {
      text = await readFile(absPath, 'utf8');
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') return undefined;
      throw new MemoryStoreError(`cannot read memory ${absPath}`, err);
    }
    const { frontmatter, body } = splitFrontmatter(text, absPath);
    const meta = (frontmatter.metadata ?? {}) as Record<string, unknown>;
    return {
      name: typeof frontmatter.name === 'string' ? frontmatter.name : name,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      type: typeof meta.type === 'string' ? meta.type : 'user',
      body: body.replace(/^\n+/, '').replace(/\s+$/, ''),
    };
  }
}

/** Serialize a record to frontmatter + body, matching the agent-config shape. */
export function serializeRecord(record: MemoryRecord): string {
  const frontmatter = stringifyYaml({
    name: record.name,
    description: record.description,
    metadata: { type: record.type },
  }).trimEnd();
  const body = record.body.trim();
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new MemoryStoreError(`invalid memory name '${name}' (expected kebab-case slug)`);
  }
}

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
