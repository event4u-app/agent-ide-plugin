import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GeminiCliAdapter } from './gemini-cli.js';

describe('GeminiCliAdapter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-gemini-'));
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses whole-file JSON with role:model + parts', async () => {
    await writeFile(
      join(dir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'gem-1',
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'user', parts: [{ text: 'explain RRF' }], timestamp: '2024-05-30T07:00:00.000Z' },
          {
            role: 'model',
            parts: [{ text: 'reciprocal rank fusion…' }],
            timestamp: '2024-05-30T07:00:04.000Z',
          },
        ],
      }),
    );
    const { summaries } = await new GeminiCliAdapter(dir).listSummaries();
    const s = summaries[0]!;
    expect(s.id).toBe('gemini-cli:gem-1');
    expect(s.provider).toBe('google');
    expect(s.model).toBe('gemini-2.5-pro');
    expect(s.title).toBe('explain RRF');
    expect(s.messageCount).toBe(2);

    const messages = await new GeminiCliAdapter(dir).loadMessages({
      source: 'gemini-cli',
      id: s.id,
      rawFilePath: s.rawFilePath!,
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('falls back to JSONL parsing', async () => {
    await writeFile(
      join(dir, 'session-2.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'hello', timestamp: 1_717_000_000_000 }),
        JSON.stringify({ role: 'model', content: 'hi', timestamp: 1_717_000_001_000 }),
      ].join('\n'),
    );
    const { summaries } = await new GeminiCliAdapter(dir).listSummaries();
    expect(summaries[0]!.messageCount).toBe(2);
    expect(summaries[0]!.title).toBe('hello');
  });

  it('degrades an unrecognized format with a diagnostic', async () => {
    await writeFile(join(dir, 'weird.bin'), 'NOTJSON\x00\x01binary');
    const { summaries, diagnostics } = await new GeminiCliAdapter(dir).listSummaries();
    expect(summaries[0]!.status).toBe('unknown');
    expect(diagnostics.some((d) => d.code === 'unsupported_format')).toBe(true);
  });
});
