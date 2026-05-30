import { describe, expect, it } from 'vitest';
import type { LlmRequest, LlmUsage } from '@event4u-agent/protocol';
import { collectStream } from './backend.js';
import { CodexCliBackend, promptFromRequest, translateCodex } from './codex-cli.js';
import { makeFakeSpawn } from './cli-test-util.js';

const baseRequest: LlmRequest = {
  model: 'gpt-5-codex',
  messages: [{ role: 'user', content: 'Reply with hello' }],
  max_tokens: 2048,
};

describe('promptFromRequest', () => {
  it('uses the last user-turn text and ends with a newline', () => {
    const out = promptFromRequest({
      ...baseRequest,
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'do the thing' },
      ],
    });
    expect(out).toBe('do the thing\n');
  });

  it('flattens structured text parts', () => {
    const out = promptFromRequest({
      ...baseRequest,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    });
    expect(out).toBe('a\nb\n');
  });
});

describe('translateCodex', () => {
  const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };

  it('agent_message item → text_delta', () => {
    expect(
      translateCodex(
        { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } },
        { ...usage },
      ),
    ).toEqual({ kind: 'text_delta', text: 'hello' });
  });

  it('reasoning item → thinking_delta', () => {
    expect(
      translateCodex(
        { type: 'item.completed', item: { type: 'reasoning', text: 'hmm' } },
        { ...usage },
      ),
    ).toEqual({ kind: 'thinking_delta', text: 'hmm' });
  });

  it('turn.completed maps usage incl cached + reasoning tokens and emits stop', () => {
    const u = { ...usage };
    const out = translateCodex(
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 30,
          cached_input_tokens: 22,
          output_tokens: 5,
          reasoning_output_tokens: 3,
        },
      },
      u,
    );
    expect(out).toMatchObject({ kind: 'stop', reason: 'end_turn' });
    expect(u).toMatchObject({
      input_tokens: 30,
      output_tokens: 5,
      cache_read_input_tokens: 22,
      thinking_tokens: 3,
    });
  });

  it('turn.failed → error', () => {
    expect(translateCodex({ type: 'turn.failed', message: 'nope' }, { ...usage })).toMatchObject({
      kind: 'error',
      code: 'cli_error',
      message: 'nope',
    });
  });

  it('unknown event → undefined', () => {
    expect(translateCodex({ type: 'turn.started' }, { ...usage })).toBeUndefined();
  });
});

describe('CodexCliBackend.stream', () => {
  it('drains a real-shaped JSONL stream and preserves the thread id', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-xyz' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i0', type: 'agent_message', text: 'hello' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 30,
          cached_input_tokens: 22,
          output_tokens: 5,
          reasoning_output_tokens: 0,
        },
      }),
    ];
    let stdinSeen = '';
    const { spawnFn } = makeFakeSpawn(lines, { onStdin: (d) => (stdinSeen += d) });
    const backend = new CodexCliBackend({ spawnFn });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.text).toBe('hello');
    expect(collected.input_tokens).toBe(30);
    expect(collected.output_tokens).toBe(5);
    expect(collected.stop_reason).toBe('end_turn');
    expect(backend.lastSessionId).toBe('thread-xyz');
    expect(stdinSeen).toBe('Reply with hello\n');
    expect(backend.mode).toBe('cli');
    expect(backend.id).toBe('codex-cli');
  });
});
