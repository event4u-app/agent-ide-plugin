import { describe, expect, it } from 'vitest';
import type { LlmStreamEvent } from '@event4u-agent/protocol';
import { collectToolCalls, toToolResultPart } from './normalizer.js';

async function* fromArray(events: LlmStreamEvent[]): AsyncIterable<LlmStreamEvent> {
  for (const event of events) yield event;
}

describe('collectToolCalls', () => {
  it('reassembles JSON input from streaming chunks', async () => {
    const events: LlmStreamEvent[] = [
      { kind: 'tool_use_start', id: 't1', name: 'read_file' },
      { kind: 'tool_use_input_delta', id: 't1', json_delta: '{"path":' },
      { kind: 'tool_use_input_delta', id: 't1', json_delta: '"README.md"}' },
      { kind: 'tool_use_end', id: 't1', name: 'read_file', input: undefined },
      { kind: 'stop', reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    const { calls } = await collectToolCalls(fromArray(events));
    expect(calls).toEqual([{ id: 't1', name: 'read_file', input: { path: 'README.md' } }]);
  });

  it('records two interleaved tool calls', async () => {
    const events: LlmStreamEvent[] = [
      { kind: 'tool_use_start', id: 'a', name: 'glob' },
      { kind: 'tool_use_start', id: 'b', name: 'grep' },
      { kind: 'tool_use_input_delta', id: 'a', json_delta: '{"pattern":"*.ts"}' },
      { kind: 'tool_use_input_delta', id: 'b', json_delta: '{"pattern":"TODO"}' },
      { kind: 'tool_use_end', id: 'a', name: 'glob', input: undefined },
      { kind: 'tool_use_end', id: 'b', name: 'grep', input: undefined },
    ];
    const { calls } = await collectToolCalls(fromArray(events));
    expect(calls.map((c) => c.name)).toEqual(['glob', 'grep']);
    expect(calls[0]?.input).toEqual({ pattern: '*.ts' });
    expect(calls[1]?.input).toEqual({ pattern: 'TODO' });
  });

  it('survives malformed JSON by recording the raw chunk', async () => {
    const events: LlmStreamEvent[] = [
      { kind: 'tool_use_start', id: 't1', name: 'read_file' },
      { kind: 'tool_use_input_delta', id: 't1', json_delta: '{this is not json' },
      { kind: 'tool_use_end', id: 't1', name: 'read_file', input: undefined },
    ];
    const { calls } = await collectToolCalls(fromArray(events));
    expect(calls[0]?.input).toMatchObject({ __parse_error__: true });
  });

  it('treats an end event without start as a best-effort capture', async () => {
    const events: LlmStreamEvent[] = [
      { kind: 'tool_use_end', id: 'orphan', name: 'noop', input: { x: 1 } },
    ];
    const { calls } = await collectToolCalls(fromArray(events));
    expect(calls).toEqual([{ id: 'orphan', name: 'noop', input: { x: 1 } }]);
  });

  it('returns no calls for a text-only stream', async () => {
    const events: LlmStreamEvent[] = [
      { kind: 'text_delta', text: 'hello' },
      { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    const { calls } = await collectToolCalls(fromArray(events));
    expect(calls).toEqual([]);
  });

  it('emits empty input when no json_delta arrived', async () => {
    const events: LlmStreamEvent[] = [
      { kind: 'tool_use_start', id: 't1', name: 'list_dir' },
      { kind: 'tool_use_end', id: 't1', name: 'list_dir', input: undefined },
    ];
    const { calls } = await collectToolCalls(fromArray(events));
    expect(calls[0]?.input).toEqual({});
  });
});

describe('toToolResultPart', () => {
  it('passes string outputs through unchanged', () => {
    const part = toToolResultPart({ id: 't', name: 'x', input: {} }, 'plain text');
    expect(part).toEqual({ type: 'tool_result', tool_use_id: 't', content: 'plain text' });
  });

  it('JSON-stringifies object outputs', () => {
    const part = toToolResultPart({ id: 't', name: 'x', input: {} }, { ok: true });
    expect(part).toEqual({
      type: 'tool_result',
      tool_use_id: 't',
      content: '{\n  "ok": true\n}',
    });
  });

  it('flags errors via is_error', () => {
    const part = toToolResultPart({ id: 't', name: 'x', input: {} }, 'permission denied', true);
    expect(part).toMatchObject({ is_error: true, content: 'permission denied' });
  });
});
