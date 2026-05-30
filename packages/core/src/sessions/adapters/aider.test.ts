import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiderAdapter } from './aider.js';

const HISTORY = [
  '# aider chat started at 2024-05-30 08:00:00',
  '',
  '#### add a healthcheck endpoint',
  'Sure, here is the patch.',
  '',
  '#### now add a test',
  'Added.',
  '',
  '# aider chat started at 2024-05-30 12:30:00',
  '',
  '#### refactor the config loader',
  'Done.',
  '',
].join('\n');

describe('AiderAdapter', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-aider-'));
    file = join(dir, '.aider.chat.history.md');
    await writeFile(file, HISTORY);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('splits the markdown into one summary per "chat started" block', async () => {
    const { summaries } = await new AiderAdapter(file).listSummaries();
    expect(summaries).toHaveLength(2);
    // Sorted newest-first.
    expect(summaries[0]!.title).toBe('refactor the config loader');
    expect(summaries[0]!.messageCount).toBe(1);
    expect(summaries[1]!.title).toBe('add a healthcheck endpoint');
    expect(summaries[1]!.messageCount).toBe(2);
    expect(summaries.every((s) => s.provider === 'aider' && s.source === 'aider')).toBe(true);
  });

  it('loads user + assistant turns for a block', async () => {
    const { summaries } = await new AiderAdapter(file).listSummaries();
    const oldest = summaries[1]!;
    const messages = await new AiderAdapter(file).loadMessages({
      source: 'aider',
      id: oldest.id,
      rawFilePath: file,
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0]!.content).toBe('add a healthcheck endpoint');
    expect(messages[1]!.content).toContain('Sure, here is the patch.');
  });

  it('returns nothing (no error) when the file is absent', async () => {
    const { summaries, diagnostics } = await new AiderAdapter(join(dir, 'nope.md')).listSummaries();
    expect(summaries).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
