import { describe, expect, it } from 'vitest';
import type { LlmRequest } from '@event4u-agent/protocol';
import { collectStream } from './backend.js';
import { collectToolCalls } from '../tools/normalizer.js';
import {
  OpenAiApiBackend,
  type OpenAiLike,
  type RawOpenAiChunk,
  buildParams,
  toOpenAiMessages,
} from './openai-api.js';

function makeClient(chunks: RawOpenAiChunk[]): OpenAiLike {
  return {
    chat: {
      completions: {
        create: () =>
          Promise.resolve(
            (async function* () {
              for (const chunk of chunks) yield chunk;
            })(),
          ),
      },
    },
  };
}

function textChunk(
  content: string,
  finish: RawOpenAiChunk['choices'][0]['finish_reason'] = null,
): RawOpenAiChunk {
  return { choices: [{ delta: { content }, finish_reason: finish }] };
}

const baseRequest: LlmRequest = {
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 2048,
};

describe('OpenAiApiBackend.stream', () => {
  it('emits text_delta + stop with usage from a simple text stream', async () => {
    const chunks: RawOpenAiChunk[] = [
      textChunk('Hello, '),
      textChunk('world!', 'stop'),
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
    ];
    const backend = new OpenAiApiBackend({ apiKey: 'x', client: makeClient(chunks) });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.text).toBe('Hello, world!');
    expect(collected.input_tokens).toBe(12);
    expect(collected.output_tokens).toBe(5);
    expect(collected.stop_reason).toBe('end_turn');
  });

  it('captures reasoning_tokens into thinking_tokens and cached_tokens into cache_read', async () => {
    const chunks: RawOpenAiChunk[] = [
      textChunk('done', 'stop'),
      {
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          completion_tokens_details: { reasoning_tokens: 25 },
          prompt_tokens_details: { cached_tokens: 80 },
        },
      },
    ];
    const backend = new OpenAiApiBackend({ apiKey: 'x', client: makeClient(chunks) });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.thinking_tokens).toBe(25);
    expect(collected.cache_read_input_tokens).toBe(80);
  });

  it('assembles a streamed tool call into a NormalizedToolCall', async () => {
    const chunks: RawOpenAiChunk[] = [
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file' } }] },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 20, completion_tokens: 8 } },
    ];
    const backend = new OpenAiApiBackend({ apiKey: 'x', client: makeClient(chunks) });
    const events = backend.stream({
      ...baseRequest,
      tools: [{ name: 'read_file', description: 'read', input_schema: {} }],
    });
    const { calls } = await collectToolCalls(events);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'call_1', name: 'read_file', input: { path: 'a.ts' } });
  });

  it('maps finish_reason: tool_calls → tool_use stop reason', async () => {
    const chunks: RawOpenAiChunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ];
    const backend = new OpenAiApiBackend({ apiKey: 'x', client: makeClient(chunks) });
    const collected = await collectStream(backend.stream(baseRequest));
    expect(collected.stop_reason).toBe('tool_use');
    expect(collected.tool_uses).toHaveLength(1);
  });

  it('emits an aborted error when the signal is already aborted', async () => {
    const backend = new OpenAiApiBackend({
      apiKey: 'x',
      client: makeClient([textChunk('hi', 'stop')]),
    });
    const controller = new AbortController();
    controller.abort();
    const events: string[] = [];
    for await (const e of backend.stream(baseRequest, controller.signal)) {
      events.push(e.kind);
    }
    expect(events).toContain('error');
  });

  it('surfaces a request_failed error when the client rejects', async () => {
    const client: OpenAiLike = {
      chat: { completions: { create: () => Promise.reject(new Error('boom')) } },
    };
    const backend = new OpenAiApiBackend({ apiKey: 'x', client });
    const collected: string[] = [];
    for await (const e of backend.stream(baseRequest)) {
      if (e.kind === 'error') collected.push(e.code);
    }
    expect(collected).toEqual(['request_failed']);
  });

  it('uses an injectable id (compat endpoints override "openai")', () => {
    const backend = new OpenAiApiBackend({ apiKey: 'x', id: 'groq', client: makeClient([]) });
    expect(backend.id).toBe('groq');
    expect(backend.mode).toBe('api');
  });
});

describe('toOpenAiMessages', () => {
  it('prepends a standalone system prompt', () => {
    const msgs = toOpenAiMessages({ ...baseRequest, system: 'be terse' });
    expect(msgs[0]).toEqual({ role: 'system', content: 'be terse' });
  });

  it('converts assistant tool_use parts into tool_calls', () => {
    const msgs = toOpenAiMessages({
      ...baseRequest,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'x' } },
          ],
        },
      ],
    });
    const assistant = msgs.find((m) => m.role === 'assistant') as Extract<
      ReturnType<typeof toOpenAiMessages>[number],
      { role: 'assistant' }
    >;
    expect(assistant.content).toBe('calling');
    expect(assistant.tool_calls?.[0]).toMatchObject({
      id: 't1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"x"}' },
    });
  });

  it('converts tool_result parts into role:tool messages', () => {
    const msgs = toOpenAiMessages({
      ...baseRequest,
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }],
        },
      ],
    });
    expect(msgs).toContainEqual({ role: 'tool', tool_call_id: 't1', content: 'file body' });
  });
});

describe('buildParams', () => {
  it('requests usage in the stream and maps tools', () => {
    const params = buildParams({
      ...baseRequest,
      temperature: 0.5,
      tools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object' } }],
    });
    expect(params.stream).toBe(true);
    expect(params.stream_options).toEqual({ include_usage: true });
    expect(params.max_tokens).toBe(2048);
    expect(params.temperature).toBe(0.5);
    expect(params.tools?.[0]).toMatchObject({ type: 'function', function: { name: 'read_file' } });
  });
});
