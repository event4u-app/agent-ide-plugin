import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexCliAdapter } from './codex-cli.js';

const ROLLOUT = [
  JSON.stringify({
    type: 'session_meta',
    timestamp: '2024-05-30T09:00:00.000Z',
    payload: { id: 'codex-abc', cwd: '/repo/svc', model: 'gpt-5.5' },
  }),
  JSON.stringify({
    type: 'response_item',
    timestamp: '2024-05-30T09:00:01.000Z',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'fix the failing test' }],
    },
  }),
  JSON.stringify({
    type: 'response_item',
    timestamp: '2024-05-30T09:00:09.000Z',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done' }],
    },
  }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', total: 10 } }),
].join('\n');

describe('CodexCliAdapter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-codex-'));
    await mkdir(join(dir, '2024', '05', '30'), { recursive: true });
    await writeFile(join(dir, '2024', '05', '30', 'rollout-codex-abc.jsonl'), ROLLOUT);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('summarizes a wrapped-payload rollout', async () => {
    const { summaries } = await new CodexCliAdapter(dir).listSummaries();
    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s.id).toBe('codex-cli:codex-abc');
    expect(s.provider).toBe('openai');
    expect(s.model).toBe('gpt-5.5');
    expect(s.title).toBe('fix the failing test');
    expect(s.cwd).toBe('/repo/svc');
    expect(s.messageCount).toBe(2); // event_msg + session_meta excluded
    expect(s.startedAt).toBe(Date.parse('2024-05-30T09:00:00.000Z'));
  });

  it('loads only user/assistant messages', async () => {
    const messages = await new CodexCliAdapter(dir).loadMessages({
      source: 'codex-cli',
      id: 'codex-cli:codex-abc',
      rawFilePath: join(dir, '2024', '05', '30', 'rollout-codex-abc.jsonl'),
    });
    expect(messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:fix the failing test',
      'assistant:done',
    ]);
  });
});
