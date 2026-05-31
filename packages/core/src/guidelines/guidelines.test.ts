import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileGuidelinesStore,
  GUIDELINES_FILE,
  InMemoryGuidelinesStore,
  MAX_GUIDELINES_BYTES,
  composeSystemPrompt,
} from './guidelines.js';

describe('composeSystemPrompt', () => {
  it('returns the base unchanged when guidelines are empty', () => {
    expect(composeSystemPrompt('base system', '   ')).toBe('base system');
    expect(composeSystemPrompt(undefined, '')).toBeUndefined();
  });

  it('prepends a delimited guidelines block ahead of the base prompt', () => {
    const out = composeSystemPrompt('You are a helpful agent.', 'Always use tabs.');
    expect(out).toContain('<workspace-guidelines>');
    expect(out).toContain('Always use tabs.');
    expect(out!.indexOf('Always use tabs.')).toBeLessThan(out!.indexOf('You are a helpful agent.'));
  });

  it('returns just the block when there is no base prompt', () => {
    const out = composeSystemPrompt(undefined, 'Rule one.');
    expect(out).toContain('Rule one.');
    expect(out!.startsWith('<workspace-guidelines>')).toBe(true);
  });

  it('clamps oversized guidelines to the byte budget with a truncation marker', () => {
    const huge = 'x'.repeat(MAX_GUIDELINES_BYTES * 2);
    const out = composeSystemPrompt(undefined, huge)!;
    expect(out).toContain('[guidelines truncated]');
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThan(MAX_GUIDELINES_BYTES + 200);
  });
});

describe('InMemoryGuidelinesStore', () => {
  it('round-trips content', async () => {
    const store = new InMemoryGuidelinesStore('initial');
    expect(await store.load()).toBe('initial');
    await store.save('updated');
    expect(await store.load()).toBe('updated');
  });
});

describe('FileGuidelinesStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-guidelines-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty string when the file is absent (fail-open)', async () => {
    expect(await new FileGuidelinesStore(dir).load()).toBe('');
  });

  it('saves and reloads guidelines, trimming surrounding whitespace', async () => {
    const store = new FileGuidelinesStore(dir);
    await store.save('Use British spelling.');
    expect(await store.load()).toBe('Use British spelling.');
  });

  it('reads an externally-edited guidelines.md', async () => {
    await writeFile(join(dir, GUIDELINES_FILE), '# Rules\n\nNo any.\n', 'utf8');
    expect(await new FileGuidelinesStore(dir).load()).toBe('# Rules\n\nNo any.');
  });
});
