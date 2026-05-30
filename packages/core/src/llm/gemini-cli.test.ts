import { describe, expect, it } from 'vitest';
import type { LlmRequest, LlmUsage } from '@event4u-agent/protocol';
import { collectStream } from './backend.js';
import { GeminiCliBackend, translateGemini } from './gemini-cli.js';
import { makeFakeSpawn } from './cli-test-util.js';

const baseRequest: LlmRequest = {
  model: 'gemini-3-flash-preview',
  messages: [{ role: 'user', content: 'Reply with hello' }],
  max_tokens: 2048,
};

describe('translateGemini', () => {
  const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };

  it('assistant message → text_delta', () => {
    expect(
      translateGemini(
        { type: 'message', role: 'assistant', content: 'hello', delta: true },
        { ...usage },
      ),
    ).toEqual({ kind: 'text_delta', text: 'hello' });
  });

  it('user message → undefined (echo ignored)', () => {
    expect(
      translateGemini({ type: 'message', role: 'user', content: 'Reply with hello' }, { ...usage }),
    ).toBeUndefined();
  });

  it('result success maps stats incl cached and emits stop', () => {
    const u = { ...usage };
    const out = translateGemini(
      {
        type: 'result',
        status: 'success',
        stats: { input_tokens: 38, output_tokens: 1, cached: 22 },
      },
      u,
    );
    expect(out).toMatchObject({ kind: 'stop', reason: 'end_turn' });
    expect(u).toMatchObject({ input_tokens: 38, output_tokens: 1, cache_read_input_tokens: 22 });
  });

  it('result error → error event', () => {
    expect(
      translateGemini({ type: 'result', status: 'error', error: 'quota', stats: {} }, { ...usage }),
    ).toMatchObject({ kind: 'error', code: 'cli_error', message: 'quota' });
  });
});

describe('GeminiCliBackend.stream', () => {
  it('drains a real-shaped stream-json stream and preserves the session id', async () => {
    const lines = [
      JSON.stringify({ type: 'init', session_id: 'sess-123', model: 'gemini-3-flash-preview' }),
      JSON.stringify({ type: 'message', role: 'user', content: 'Reply with hello\n' }),
      JSON.stringify({ type: 'message', role: 'assistant', content: 'hello', delta: true }),
      JSON.stringify({
        type: 'result',
        status: 'success',
        stats: { input_tokens: 38, output_tokens: 1, cached: 0 },
      }),
    ];
    const { spawnFn } = makeFakeSpawn(lines);
    const backend = new GeminiCliBackend({ spawnFn });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.text).toBe('hello');
    expect(collected.input_tokens).toBe(38);
    expect(collected.output_tokens).toBe(1);
    expect(collected.stop_reason).toBe('end_turn');
    expect(backend.lastSessionId).toBe('sess-123');
    expect(backend.id).toBe('gemini-cli');
  });
});
