import { describe, expect, it } from 'vitest';
import type { LlmUsage } from '@event4u-agent/protocol';
import { serializeRequest, translate } from './claude-cli.js';

describe('serializeRequest', () => {
  it('emits one Messages-API-shaped JSONL line with the last user message', () => {
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
    expect(parsed).toEqual({ type: 'user', message: { role: 'user', content: 'Hi' } });
  });

  it('serializes structured content to a JSON string', () => {
    const out = serializeRequest({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      max_tokens: 2048,
    });
    const parsed = JSON.parse(out.trim());
    expect(typeof parsed.message.content).toBe('string');
    expect(parsed.message.content).toMatch(/Hi/);
  });
});

describe('translate', () => {
  const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };

  it('assistant message → text_delta from message.content text blocks', () => {
    expect(
      translate(
        {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        },
        { ...usage },
      ),
    ).toEqual({ kind: 'text_delta', text: 'hi' });
  });

  it('assistant joins multiple text blocks and skips non-text blocks', () => {
    expect(
      translate(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'foo' },
              { type: 'tool_use', id: 't1', name: 'Read' },
              { type: 'text', text: 'bar' },
            ],
          },
        },
        { ...usage },
      ),
    ).toEqual({ kind: 'text_delta', text: 'foobar' });
  });

  it('assistant with no text blocks → undefined', () => {
    expect(
      translate(
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read' }] } },
        { ...usage },
      ),
    ).toBeUndefined();
  });

  it('result populates usage (incl. cache) and emits stop', () => {
    const u = { ...usage };
    const out = translate(
      {
        type: 'result',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 3,
        },
        stop_reason: 'end_turn',
      },
      u,
    );
    expect(out).toMatchObject({ kind: 'stop', reason: 'end_turn' });
    expect(u).toMatchObject({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 7,
      cache_creation_input_tokens: 3,
    });
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

  it('control frames (system, rate_limit_event, user echo) return undefined', () => {
    expect(translate({ type: 'system', subtype: 'init' }, { ...usage })).toBeUndefined();
    expect(translate({ type: 'rate_limit_event' }, { ...usage })).toBeUndefined();
    expect(translate({ type: 'user', message: { content: [] } }, { ...usage })).toBeUndefined();
  });
});
