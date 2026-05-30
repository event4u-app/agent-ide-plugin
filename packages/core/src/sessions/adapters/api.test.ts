import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiSessionAdapter } from './api.js';

describe('ApiSessionAdapter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-api-'));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'conv-1.json'),
      JSON.stringify({
        id: 'conv-1',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        startedAt: '2024-05-30T08:00:00.000Z',
        cwd: '/repo',
        totalCostUsd: 0.0156,
        totalTokens: 1234,
        status: 'completed',
        messages: [
          {
            role: 'user',
            content: 'a quick question about zod',
            timestamp: '2024-05-30T08:00:00.000Z',
          },
          { role: 'assistant', content: 'sure', timestamp: '2024-05-30T08:00:03.000Z' },
        ],
      }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('summarizes plugin chats with origin=plugin', async () => {
    const { summaries } = await new ApiSessionAdapter(dir).listSummaries();
    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s.id).toBe('api:conv-1');
    expect(s.origin).toBe('plugin');
    expect(s.provider).toBe('anthropic');
    expect(s.title).toBe('a quick question about zod');
    expect(s.totalCostUsd).toBeCloseTo(0.0156);
    expect(s.totalTokens).toBe(1234);
    expect(s.messageCount).toBe(2);
    expect(s.lastMessageAt).toBe(Date.parse('2024-05-30T08:00:03.000Z'));
  });

  it('loads messages', async () => {
    const messages = await new ApiSessionAdapter(dir).loadMessages({
      source: 'api',
      id: 'api:conv-1',
      rawFilePath: join(dir, 'conv-1.json'),
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
  });

  it('degrades a corrupt json file but keeps origin=plugin', async () => {
    await writeFile(join(dir, 'broken.json'), '{ not valid');
    const { summaries, diagnostics } = await new ApiSessionAdapter(dir).listSummaries();
    const broken = summaries.find((s) => s.status === 'unknown');
    expect(broken?.origin).toBe('plugin');
    expect(diagnostics.some((d) => d.code === 'parse_failed')).toBe(true);
  });
});
