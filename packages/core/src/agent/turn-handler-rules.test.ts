import { describe, expect, it } from 'vitest';
import type { Envelope, LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import { InMemoryConversationStore } from '../chat/store.js';
import type { LlmBackend } from '../llm/backend.js';
import { PermissionGate } from '../permissions/gate.js';
import { buildDefaultToolRegistry } from './tool-registry.js';
import { AgentTurnHandler, type AgentTurnHandlerDeps } from './turn-handler.js';

const USAGE = { input_tokens: 10, output_tokens: 5 };

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

describe('AgentTurnHandler — always-active RULES folded into the system prompt (T-404, ADR-043)', () => {
  it('folds rules ahead of guidelines and the static base (parity with ChatHandler)', async () => {
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
        loadRules: async () => '## Rule: r\n\nHard rule body.',
      }),
    );
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'go' }, sink().emit);

    const system = requests[0]!.system!;
    expect(system).toContain('<workspace-rules>');
    expect(system.indexOf('Hard rule body.')).toBeLessThan(system.indexOf('Never delete files.'));
    expect(system.indexOf('Never delete files.')).toBeLessThan(system.indexOf('BASE AGENT PROMPT'));
  });

  it('folds rules even when no guidelines loader and no base prompt are set', async () => {
    const { backend, requests } = capturingBackend([
      [{ kind: 'stop', reason: 'end_turn', usage: USAGE }],
    ]);
    const handler = new AgentTurnHandler(
      baseDeps({
        resolveBackend: () => backend,
        loadRules: async () => '## Rule: r\n\nrules only',
      }),
    );
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'go' }, sink().emit);

    expect(requests[0]!.system).toContain('<workspace-rules>');
    expect(requests[0]!.system).toContain('rules only');
  });

  it('fails open: a rules load error degrades to the base system prompt', async () => {
    const { backend, requests } = capturingBackend([
      [{ kind: 'stop', reason: 'end_turn', usage: USAGE }],
    ]);
    const handler = new AgentTurnHandler(
      baseDeps({
        resolveBackend: () => backend,
        system: 'BASE',
        loadRules: async () => {
          throw new Error('walk exploded');
        },
      }),
    );
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'go' }, sink().emit);

    expect(requests[0]!.system).toBe('BASE');
  });
});
