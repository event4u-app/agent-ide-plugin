import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Envelope, LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import { InMemoryConversationStore } from '../chat/store.js';
import type { LlmBackend } from '../llm/backend.js';
import { PermissionGate } from '../permissions/gate.js';
import { buildDefaultToolRegistry } from './tool-registry.js';
import { AgentTurnHandler, type AgentTurnHandlerDeps } from './turn-handler.js';

const USAGE = { input_tokens: 10, output_tokens: 5 };

/** Records every per-iteration request, then replays one scripted event list per call. */
function capturingBackend(turns: LlmStreamEvent[][]): {
  backend: LlmBackend;
  requests: LlmRequest[];
} {
  const requests: LlmRequest[] = [];
  let i = 0;
  const backend: LlmBackend = {
    id: 'fake',
    mode: 'api',
    async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      requests.push(request);
      const events = turns[Math.min(i, turns.length - 1)] ?? [];
      i += 1;
      for (const event of events) yield event;
    },
  };
  return { backend, requests };
}

/** A write_files tool turn then a final text turn → two iterations. */
function writeThenDone(input: unknown): LlmStreamEvent[][] {
  return [
    [
      { kind: 'tool_use_start', id: 'tc1', name: 'write_files' },
      { kind: 'tool_use_input_delta', id: 'tc1', json_delta: JSON.stringify(input) },
      { kind: 'tool_use_end', id: 'tc1', name: 'write_files', input: undefined },
      { kind: 'stop', reason: 'tool_use', usage: USAGE },
    ],
    [
      { kind: 'text_delta', text: 'Done.' },
      { kind: 'stop', reason: 'end_turn', usage: USAGE },
    ],
  ];
}

function baseDeps(overrides: Partial<AgentTurnHandlerDeps>): AgentTurnHandlerDeps {
  return {
    resolveBackend: () =>
      capturingBackend([[{ kind: 'stop', reason: 'end_turn', usage: USAGE }]]).backend,
    resolveModel: () => 'test-model',
    store: new InMemoryConversationStore(),
    gate: new PermissionGate({}),
    registry: buildDefaultToolRegistry({ workspaceRoot: '/tmp' }),
    decide: () => Promise.resolve('allow_once'),
    ...overrides,
  };
}

function sink(): { emit: (e: Envelope) => void } {
  return { emit: () => {} };
}

describe('AgentTurnHandler — workspace guidelines folded into the system prompt (T-1307)', () => {
  it('folds guidelines ahead of the static base system prompt', async () => {
    const { backend, requests } = capturingBackend([
      [
        { kind: 'text_delta', text: 'hi' },
        { kind: 'stop', reason: 'end_turn', usage: USAGE },
      ],
    ]);
    const handler = new AgentTurnHandler(
      baseDeps({
        resolveBackend: () => backend,
        system: 'BASE AGENT PROMPT',
        loadGuidelines: async () => 'Never delete files.',
      }),
    );
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'go' }, sink().emit);

    expect(requests[0]!.system).toContain('Never delete files.');
    expect(requests[0]!.system).toContain('BASE AGENT PROMPT');
    expect(requests[0]!.system!.indexOf('Never delete files.')).toBeLessThan(
      requests[0]!.system!.indexOf('BASE AGENT PROMPT'),
    );
  });

  it('loads guidelines ONCE per turn and reuses the same system across iterations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-guidelines-'));
    let loadCount = 0;
    const { backend, requests } = capturingBackend(
      writeThenDone({ edits: [{ file: 'a.txt', originalCode: '', newCode: 'x\n' }] }),
    );
    const handler = new AgentTurnHandler(
      baseDeps({
        resolveBackend: () => backend,
        registry: buildDefaultToolRegistry({ workspaceRoot: root }),
        loadGuidelines: async () => {
          loadCount += 1;
          return 'Stable rule.';
        },
      }),
    );
    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'edit a.txt' },
      sink().emit,
    );

    expect((terminal.data as { iterations: number }).iterations).toBe(2);
    expect(loadCount).toBe(1); // loaded once, not per iteration
    expect(requests).toHaveLength(2);
    expect(requests[0]!.system).toContain('Stable rule.');
    expect(requests[0]!.system).toBe(requests[1]!.system);
  });

  it('omits `system` when no guidelines and no base prompt are set', async () => {
    const { backend, requests } = capturingBackend([
      [{ kind: 'stop', reason: 'end_turn', usage: USAGE }],
    ]);
    const handler = new AgentTurnHandler(baseDeps({ resolveBackend: () => backend }));
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'go' }, sink().emit);

    expect(requests[0]!.system).toBeUndefined();
  });

  it('fails open: a guidelines load error degrades to the base system prompt', async () => {
    const { backend, requests } = capturingBackend([
      [{ kind: 'stop', reason: 'end_turn', usage: USAGE }],
    ]);
    const handler = new AgentTurnHandler(
      baseDeps({
        resolveBackend: () => backend,
        system: 'BASE',
        loadGuidelines: async () => {
          throw new Error('disk gone');
        },
      }),
    );
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'go' }, sink().emit);

    expect(requests[0]!.system).toBe('BASE');
  });
});
