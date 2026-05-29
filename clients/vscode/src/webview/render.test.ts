import { describe, expect, it } from 'vitest';
import { renderMessages, renderSnapshot } from './render.js';
import type { ChatModelSnapshot } from './chat-model.js';

describe('renderMessages', () => {
  it('renders a user + assistant pair', () => {
    const html = renderMessages([
      { kind: 'user', id: 'u1', text: 'Hello' },
      {
        kind: 'assistant',
        id: 'a1',
        text: 'Hi there',
        streaming: false,
        toolCalls: [],
        costFooter: null,
      },
    ]);
    expect(html).toContain('event4u-card--user');
    expect(html).toContain('event4u-card--assistant');
    expect(html).toContain('Hello');
    expect(html).toContain('Hi there');
  });

  it('includes a streaming tag while in flight', () => {
    const html = renderMessages([
      {
        kind: 'assistant',
        id: 'a1',
        text: 'partial',
        streaming: true,
        toolCalls: [],
        costFooter: null,
      },
    ]);
    expect(html).toContain('event4u-streaming-tag');
  });

  it('renders a cost footer when present', () => {
    const html = renderMessages([
      {
        kind: 'assistant',
        id: 'a1',
        text: 'done',
        streaming: false,
        toolCalls: [],
        costFooter: {
          durationMs: 4200,
          inputTokens: 18_422,
          cacheReadTokens: 14_200,
          outputTokens: 487,
          usd: 0.0156,
          stepCount: 3,
          toolCallCount: 3,
          timeToFirstTokenMs: 412,
        },
      },
    ]);
    expect(html).toContain('event4u-cost');
    expect(html).toContain('$0.0156');
    expect(html).toContain('TTFT 412ms');
  });

  it('renders halt cards with option buttons + free-text form', () => {
    const html = renderMessages([
      {
        kind: 'halt',
        id: 'h1',
        question: 'Which fix?',
        options: [
          { id: 'a', label: 'Option A', description: 'first one' },
          { id: 'b', label: 'Option B' },
        ],
        allowFreeText: true,
      },
    ]);
    expect(html).toContain('event4u-card--halt');
    expect(html).toContain('data-action="halt-answer"');
    expect(html).toContain('Option A');
    expect(html).toContain('data-action="halt-text"');
  });

  it('renders tool calls with outcome marker', () => {
    const html = renderMessages([
      {
        kind: 'assistant',
        id: 'a1',
        text: '',
        streaming: false,
        toolCalls: [
          {
            name: 'read_file',
            argsPreview: '{"path":"x"}',
            outcome: 'ok',
            output: 'file contents',
          },
          {
            name: 'write_file',
            argsPreview: '{"path":"y"}',
            outcome: 'error',
            output: 'permission denied',
          },
        ],
        costFooter: null,
      },
    ]);
    expect(html).toContain('✅');
    expect(html).toContain('❌');
    expect(html).toContain('event4u-tool-call--ok');
    expect(html).toContain('event4u-tool-call--error');
  });
});

describe('renderSnapshot', () => {
  function snapshot(partial: Partial<ChatModelSnapshot> = {}): ChatModelSnapshot {
    return {
      messages: [],
      mode: 'api',
      streamingSummary: null,
      sidecarHealthy: true,
      ...partial,
    };
  }

  it('reports the mode label', () => {
    expect(renderSnapshot(snapshot()).modeLabel).toBe('API');
    expect(renderSnapshot(snapshot({ mode: 'cli' })).modeLabel).toBe('CLI');
  });

  it('classifies status', () => {
    expect(renderSnapshot(snapshot()).statusClass).toBe('event4u-status--ready');
    expect(renderSnapshot(snapshot({ sidecarHealthy: false })).statusClass).toBe(
      'event4u-status--error',
    );
    expect(
      renderSnapshot(
        snapshot({ streamingSummary: { inputTokens: 1, outputTokens: 1, usdSoFar: 0.001 } }),
      ).statusClass,
    ).toBe('event4u-status--streaming');
  });

  it('emits a streaming line when streaming', () => {
    const out = renderSnapshot(
      snapshot({ streamingSummary: { inputTokens: 100, outputTokens: 10, usdSoFar: 0.01 } }),
    );
    expect(out.streamingLine).toMatch(/Streaming/);
  });
});
