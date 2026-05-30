import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeCliAdapter } from './claude-cli.js';

const SESSION = [
  JSON.stringify({ type: 'summary', summary: 'ignored meta line' }),
  JSON.stringify({
    type: 'user',
    sessionId: 'sess-1',
    cwd: '/repo/app',
    timestamp: '2024-05-30T10:00:00.000Z',
    message: { role: 'user', content: 'Refactor the auth middleware please' },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2024-05-30T10:00:05.000Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'On it.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }),
  'this is a corrupt line that must be skipped',
  JSON.stringify({
    type: 'user',
    timestamp: '2024-05-30T10:01:00.000Z',
    message: { role: 'user', content: 'thanks' },
  }),
].join('\n');

describe('ClaudeCliAdapter', () => {
  let home: string;
  let projectsDir: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'event4u-claude-'));
    projectsDir = join(home, 'projects');
    await mkdir(join(projectsDir, 'repo-app', 'sessions'), { recursive: true });
    await writeFile(join(projectsDir, 'repo-app', 'sessions', 'sess-1.jsonl'), SESSION);
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('summarizes a session with title, model, tokens, count', async () => {
    const { summaries, diagnostics } = await new ClaudeCliAdapter(projectsDir).listSummaries();
    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s.id).toBe('claude-cli:sess-1');
    expect(s.source).toBe('claude-cli');
    expect(s.provider).toBe('anthropic');
    expect(s.model).toBe('claude-sonnet-4-6');
    expect(s.title).toBe('Refactor the auth middleware please');
    expect(s.messageCount).toBe(3); // 2 user + 1 assistant; summary line excluded
    expect(s.totalTokens).toBe(150);
    expect(s.cwd).toBe('/repo/app');
    expect(s.startedAt).toBe(Date.parse('2024-05-30T10:00:00.000Z'));
    expect(s.lastMessageAt).toBe(Date.parse('2024-05-30T10:01:00.000Z'));
    // The corrupt line is reported but does not break the scan.
    expect(diagnostics.some((d) => d.code === 'partial_parse')).toBe(true);
  });

  it('loads normalized messages, skipping meta + corrupt lines', async () => {
    const messages = await new ClaudeCliAdapter(projectsDir).loadMessages({
      source: 'claude-cli',
      id: 'claude-cli:sess-1',
      rawFilePath: join(projectsDir, 'repo-app', 'sessions', 'sess-1.jsonl'),
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]!.content).toBe('Refactor the auth middleware please');
    expect(messages[1]!.content).toBe('On it.');
  });

  it('reports location_missing when no dir is configured', async () => {
    const { summaries, diagnostics } = await new ClaudeCliAdapter(undefined).listSummaries();
    expect(summaries).toEqual([]);
    expect(diagnostics[0]!.code).toBe('location_missing');
  });

  it('degrades a fully-corrupt file instead of throwing', async () => {
    await writeFile(
      join(projectsDir, 'repo-app', 'sessions', 'bad.jsonl'),
      'garbage\nmore garbage',
    );
    const { summaries, diagnostics } = await new ClaudeCliAdapter(projectsDir).listSummaries();
    expect(summaries.some((s) => s.status === 'unknown')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'parse_failed')).toBe(true);
  });
});
