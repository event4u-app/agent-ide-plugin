import { describe, expect, it } from 'vitest';
import type { LlmUsage } from '@event4u-agent/protocol';
import { serializeRequest, translate } from './claude-cli.js';

describe('serializeRequest', () => {
  it('emits one JSONL line with the last user message', () => {
    const out = serializeRequest({
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'You are' },
        { role: 'user', content: 'Hi' },
      ],
      max_tokens: 2048,
    });
    expect(out.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual({ type: 'user', text: 'Hi', model: 'claude-sonnet-4-6' });
  });

  it('serializes structured content to a JSON string', () => {
    const out = serializeRequest({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      max_tokens: 2048,
    });
    const parsed = JSON.parse(out.trim());
    expect(typeof parsed.text).toBe('string');
    expect(parsed.text).toMatch(/Hi/);
  });
});

describe('translate', () => {
  const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };

  it('text → text_delta', () => {
    expect(translate({ type: 'text', text: 'hi' }, { ...usage })).toEqual({
      kind: 'text_delta',
      text: 'hi',
    });
  });

  it('tool_use → tool_use_start', () => {
    expect(translate({ type: 'tool_use', id: 't1', name: 'read_file' }, { ...usage })).toEqual({
      kind: 'tool_use_start',
      id: 't1',
      name: 'read_file',
    });
  });

  it('thinking → thinking_delta', () => {
    expect(translate({ type: 'thinking', text: 'thinking out loud' }, { ...usage })).toEqual({
      kind: 'thinking_delta',
      text: 'thinking out loud',
    });
  });

  it('result populates usage and emits stop', () => {
    const u = { ...usage };
    const out = translate(
      {
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      },
      u,
    );
    expect(out).toMatchObject({ kind: 'stop', reason: 'end_turn' });
    expect(u).toMatchObject({ input_tokens: 10, output_tokens: 5 });
  });

  it('falls back to end_turn for unknown stop reasons', () => {
    const out = translate(
      { type: 'result', stop_reason: 'mystery', usage: { input_tokens: 1, output_tokens: 1 } },
      { ...usage },
    );
    expect(out).toMatchObject({ kind: 'stop', reason: 'end_turn' });
  });

  it('error → error event', () => {
    expect(translate({ type: 'error', code: 'cli_oops', message: 'broken' }, { ...usage })).toEqual(
      { kind: 'error', code: 'cli_oops', message: 'broken' },
    );
  });

  it('unknown event type returns undefined', () => {
    expect(translate({ type: 'mystery' }, { ...usage })).toBeUndefined();
  });
});
