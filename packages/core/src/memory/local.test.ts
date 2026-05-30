import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalMemoryStore, MEMORY_INDEX_FILE, MemoryStoreError, serializeRecord } from './local.js';

describe('LocalMemoryStore', () => {
  let dir: string;
  let store: LocalMemoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-mem-'));
    store = new LocalMemoryStore(join(dir, 'memories'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty list when the dir does not exist', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('writes a memory as md+frontmatter and round-trips it', async () => {
    await store.write({
      name: 'prefers-tabs',
      description: 'user prefers tabs over spaces',
      type: 'user',
      body: 'Always indent with tabs.',
    });
    const read = await store.read('prefers-tabs');
    expect(read).toEqual({
      name: 'prefers-tabs',
      description: 'user prefers tabs over spaces',
      type: 'user',
      body: 'Always indent with tabs.',
    });
    const raw = await readFile(join(store.directory, 'prefers-tabs.md'), 'utf8');
    expect(raw).toContain('name: prefers-tabs');
    expect(raw).toContain('type: user');
  });

  it('regenerates the MEMORY.md index on write', async () => {
    await store.write({ name: 'a-rule', description: 'first', type: 'feedback', body: 'x' });
    await store.write({ name: 'b-rule', description: 'second', type: 'user', body: 'y' });
    const index = await readFile(join(store.directory, MEMORY_INDEX_FILE), 'utf8');
    expect(index).toContain('# Memory index');
    expect(index).toContain('- [a-rule](a-rule.md) — first');
    expect(index).toContain('- [b-rule](b-rule.md) — second');
  });

  it('lists all records sorted, excluding the index file', async () => {
    await store.write({ name: 'zebra', description: 'z', type: 'user', body: 'b' });
    await store.write({ name: 'alpha', description: 'a', type: 'user', body: 'b' });
    const names = (await store.list()).map((r) => r.name);
    expect(names).toEqual(['alpha', 'zebra']);
  });

  it('deletes a memory and prunes it from the index', async () => {
    await store.write({ name: 'keep', description: 'k', type: 'user', body: 'b' });
    await store.write({ name: 'drop', description: 'd', type: 'user', body: 'b' });
    await store.delete('drop');
    expect(await store.read('drop')).toBeUndefined();
    const index = await readFile(join(store.directory, MEMORY_INDEX_FILE), 'utf8');
    expect(index).not.toContain('drop.md');
    expect(index).toContain('keep.md');
  });

  it('reads an agent-config-authored memory file (external compat)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(store.directory, { recursive: true });
    await writeFile(
      join(store.directory, 'external.md'),
      '---\nname: external\ndescription: hand-written\nmetadata:\n  type: project\n  node_type: memory\n---\n\nSome body.\n',
      'utf8',
    );
    const read = await store.read('external');
    expect(read).toMatchObject({ name: 'external', type: 'project', description: 'hand-written' });
    expect(read?.body).toBe('Some body.');
  });

  it('rejects an invalid (non-kebab) name', async () => {
    await expect(
      store.write({ name: 'Bad Name', description: 'x', type: 'user', body: 'b' }),
    ).rejects.toThrow(MemoryStoreError);
  });

  it('serializeRecord emits a frontmatter block then the body', () => {
    const out = serializeRecord({ name: 'n', description: 'd', type: 'feedback', body: 'hello' });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('type: feedback');
    expect(out.trimEnd().endsWith('hello')).toBe(true);
  });
});
