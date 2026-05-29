import { describe, expect, it } from 'vitest';
import type { LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import {
  AnthropicApiBackend,
  type AnthropicLike,
  type RawAnthropicEvent,
} from './anthropic-api.js';
import { collectStream } from './backend.js';

function makeClient(events: RawAnthropicEvent[], opts: { tokens?: number } = {}): AnthropicLike {
  return {
    messages: {
      create: () =>
        Promise.resolve(
          (async function* () {
            for (const event of events) {
              yield event;
            }
          })(),
        ),
      countTokens:
        opts.tokens !== undefined
          ? () => Promise.resolve({ input_tokens: opts.tokens! })
          : undefined,
    },
  };
}

const baseRequest: LlmRequest = {
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 2048,
};

describe('AnthropicApiBackend.stream', () => {
  it('emits text_delta + stop with usage from a simple text stream', async () => {
    const events: RawAnthropicEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello, ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world!' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const backend = new AnthropicApiBackend({ apiKey: 'x', client: makeClient(events) });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.text).toBe('Hello, world!');
    expect(collected.input_tokens).toBe(12);
    expect(collected.output_tokens).toBe(5);
    expect(collected.stop_reason).toBe('end_turn');
  });

  it('emits tool_use_* events for a tool call stream', async () => {
    const events: RawAnthropicEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 20 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":"' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'README.md"}' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ];
    const backend = new AnthropicApiBackend({ apiKey: 'x', client: makeClient(events) });
    const out: LlmStreamEvent[] = [];
    for await (const event of backend.stream(baseRequest)) out.push(event);
    expect(out.filter((e) => e.kind === 'tool_use_start')).toHaveLength(1);
    expect(out.filter((e) => e.kind === 'tool_use_input_delta')).toHaveLength(2);
    expect(out.filter((e) => e.kind === 'tool_use_end')).toHaveLength(1);
    const stop = out.find((e) => e.kind === 'stop');
    expect(stop?.kind === 'stop' ? stop.reason : null).toBe('tool_use');
  });

  it('carries cache_creation + cache_read counts when present', async () => {
    const events: RawAnthropicEvent[] = [
      {
        type: 'message_start',
        message: {
          usage: { input_tokens: 100, cache_creation_input_tokens: 80, cache_read_input_tokens: 20 },
        },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const backend = new AnthropicApiBackend({ apiKey: 'x', client: makeClient(events) });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.cache_creation_input_tokens).toBe(80);
    expect(collected.cache_read_input_tokens).toBe(20);
  });

  it('maps an error event to an LlmStreamEvent and stops', async () => {
    const events: RawAnthropicEvent[] = [
      { type: 'error', error: { type: 'overloaded_error', message: 'Server overloaded' } },
    ];
    const backend = new AnthropicApiBackend({ apiKey: 'x', client: makeClient(events) });
    const collected = backend.stream(baseRequest);
    await expect(collectStream(collected)).rejects.toThrow(/Server overloaded/);
  });

  it('honours an AbortSignal that was already aborted before iteration', async () => {
    const controller = new AbortController();
    controller.abort();
    const events: RawAnthropicEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];
    const backend = new AnthropicApiBackend({ apiKey: 'x', client: makeClient(events) });
    const out: LlmStreamEvent[] = [];
    for await (const event of backend.stream(baseRequest, controller.signal)) {
      out.push(event);
      if (event.kind === 'error') break;
    }
    expect(out.some((e) => e.kind === 'error' && e.code === 'aborted')).toBe(true);
  });

  it('forwards cache_control on system prompt when cache_system_prompt is true', async () => {
    const calls: unknown[] = [];
    const client: AnthropicLike = {
      messages: {
        create: (params) => {
          calls.push(params);
          return Promise.resolve(
            (async function* () {
              yield { type: 'message_stop' } as RawAnthropicEvent;
            })(),
          );
        },
      },
    };
    const backend = new AnthropicApiBackend({ apiKey: 'x', client });
    await collectStream(
      backend.stream({
        ...baseRequest,
        system: 'You are a helper.',
        cache_system_prompt: true,
      }),
    );
    const params = calls[0] as { system: unknown };
    expect(params.system).toEqual([
      { type: 'text', text: 'You are a helper.', cache_control: { type: 'ephemeral' } },
    ]);
  });
});

describe('AnthropicApiBackend.countInputTokens', () => {
  it('returns the token count from the SDK when available', async () => {
    const backend = new AnthropicApiBackend({
      apiKey: 'x',
      client: makeClient([], { tokens: 1234 }),
    });
    expect(await backend.countInputTokens(baseRequest)).toBe(1234);
  });

  it('returns undefined when the SDK does not support countTokens', async () => {
    const backend = new AnthropicApiBackend({ apiKey: 'x', client: makeClient([]) });
    expect(await backend.countInputTokens(baseRequest)).toBeUndefined();
  });
});
