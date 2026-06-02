import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Envelope, LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from './llm/backend.js';
import { ProviderRegistry, type ProviderSpec } from './llm/provider-registry.js';
import { InMemoryConversationStore } from './chat/store.js';
import { buildCoreDispatcher } from './sidecar.js';

/** A backend that streams fixed chunks then a stop event. */
function scriptedBackend(chunks: string[]): LlmBackend {
  return {
    id: 'fake',
    mode: 'api',
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      for (const text of chunks) yield { kind: 'text_delta', text };
      yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 2 } };
    },
  };
}

const TOOL_USAGE = { input_tokens: 10, output_tokens: 5 };

/**
 * A backend that plays one scripted event list per `stream` call: first a
 * `write_files` tool call (which the default `decide` denies), then a final
 * text turn so the loop terminates.
 */
function writeThenDoneBackend(): LlmBackend {
  const turns: LlmStreamEvent[][] = [
    [
      { kind: 'tool_use_start', id: 'tc1', name: 'write_files' },
      {
        kind: 'tool_use_input_delta',
        id: 'tc1',
        json_delta: JSON.stringify({
          edits: [{ file: 'note.txt', originalCode: '', newCode: 'hi\n' }],
        }),
      },
      { kind: 'tool_use_end', id: 'tc1', name: 'write_files', input: undefined },
      { kind: 'stop', reason: 'tool_use', usage: TOOL_USAGE },
    ],
    [
      { kind: 'text_delta', text: 'Done.' },
      { kind: 'stop', reason: 'end_turn', usage: TOOL_USAGE },
    ],
  ];
  let i = 0;
  return {
    id: 'fake',
    mode: 'api',
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      const events = turns[Math.min(i, turns.length - 1)] ?? [];
      i += 1;
      for (const event of events) yield event;
    },
  };
}

const agentEnv = (conversationId: string, message: string): Envelope => ({
  messageId: 'a1',
  messageType: 'agentTurn',
  data: { conversationId, message },
  done: true,
});

const scriptedSpec = (chunks: string[]): ProviderSpec => ({
  id: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  modelEnv: 'EVENT4U_ANTHROPIC_MODEL',
  build: () => scriptedBackend(chunks),
});

const sendEnv = (conversationId: string, message: string): Envelope => ({
  messageId: 's1',
  messageType: 'chatSend',
  data: { conversationId, message },
  done: true,
});

describe('buildCoreDispatcher — chatSend wiring', () => {
  it('answers chatSend (no longer chat_not_configured) and streams tokens', async () => {
    const registry = new ProviderRegistry({
      env: {},
      providers: [scriptedSpec(['Hello', ', ', 'world'])],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({
      registry,
      store: new InMemoryConversationStore(),
    });

    const streamed: Envelope[] = [];
    const terminal = await dispatcher.dispatch(sendEnv('c1', 'hi'), (e) => streamed.push(e));

    expect(terminal.messageType).toBe('chatSend');
    expect(terminal.done).toBe(true);
    const data = terminal.data as { text: string };
    expect(data.text).toBe('Hello, world');
    // Tokens arrived as done:false envelopes.
    expect(streamed.map((e) => (e.data as { token: string }).token)).toEqual([
      'Hello',
      ', ',
      'world',
    ]);
  });

  it('persists the turn in the wired store', async () => {
    const store = new InMemoryConversationStore();
    const registry = new ProviderRegistry({
      env: {},
      providers: [scriptedSpec(['ok'])],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({ registry, store });

    await dispatcher.dispatch(sendEnv('c2', 'question'), () => {});
    const convo = await store.load('c2');
    expect(convo?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(convo?.messages[0]?.content).toBe('question');
    expect(convo?.messages[1]?.content).toBe('ok');
  });

  it('surfaces provider_not_configured when the default provider is unconfigured', async () => {
    const registry = new ProviderRegistry({
      env: {},
      providers: [
        {
          id: 'anthropic',
          defaultModel: 'm',
          modelEnv: 'X',
          build: () => {
            throw new Error('missing API key: set ANTHROPIC_API_KEY');
          },
        },
      ],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({ registry, store: new InMemoryConversationStore() });

    const terminal = await dispatcher.dispatch(sendEnv('c3', 'hi'), () => {});
    expect(terminal.messageType).toBe('error');
    expect((terminal.data as { code: string }).code).toBe('provider_not_configured');
  });

  it('wires a daily-budget tracker from the cost option and surfaces a status (T-PRD06)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event4u-cost-'));
    const registry = new ProviderRegistry({
      env: {},
      providers: [scriptedSpec(['ok'])],
      defaultProvider: 'anthropic',
    });
    const dispatcher = buildCoreDispatcher({
      registry,
      store: new InMemoryConversationStore(),
      cwd: dir,
      cost: { dailyBudgetUsd: 10 },
    });

    const terminal = await dispatcher.dispatch(sendEnv('c4', 'hi'), () => {});
    const data = terminal.data as { budget?: { limitUsd: number | null } };
    expect(data.budget).toBeDefined();
    expect(data.budget!.limitUsd).toBe(10);
  });

  it('wires a live permission-audit log so a denied write records a row (T-PRD05, ADR-038)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'event4u-audit-'));
    const registry = new ProviderRegistry({
      env: {},
      providers: [
        {
          id: 'anthropic',
          defaultModel: 'claude-sonnet-4-6',
          modelEnv: 'EVENT4U_ANTHROPIC_MODEL',
          build: () => writeThenDoneBackend(),
        },
      ],
      defaultProvider: 'anthropic',
    });
    // No `audit` override → buildCoreDispatcher must construct a live AuditLog;
    // the default `decide` denies the `write_files` approval (no IDE round-trip
    // wired), so the orchestrator records a `deny_user` row to disk.
    const dispatcher = buildCoreDispatcher({
      registry,
      store: new InMemoryConversationStore(),
      cwd: dir,
    });

    const terminal = await dispatcher.dispatch(agentEnv('c-audit', 'edit the file'), () => {});
    expect(terminal.messageType).toBe('agentTurn');

    // Read whatever date-rotated file the recorder wrote (avoid recomputing the
    // UTC date here — a midnight boundary would flake an exact filename match).
    const auditDir = join(dir, '.event4u-agent', 'audit');
    const files = (await readdir(auditDir)).filter(
      (f) => f.startsWith('audit-') && f.endsWith('.jsonl'),
    );
    expect(files).toHaveLength(1);
    const raw = await readFile(join(auditDir, files[0]!), 'utf8');
    const rows = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; tool: string });
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: 'deny_user', tool: 'write_files' }),
    );

    dispatcher.dispose();
  });
});
