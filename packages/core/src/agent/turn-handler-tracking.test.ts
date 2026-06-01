import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import { InMemoryConversationStore } from '../chat/store.js';
import type { LlmBackend } from '../llm/backend.js';
import { PermissionGate } from '../permissions/gate.js';
import { PricingBook } from '../pricing/loader.js';
import type { StepEvent } from '../tracking/db.js';
import type { StepRecorder } from '../tracking/step-recorder.js';
import { buildDefaultToolRegistry } from './tool-registry.js';
import { AgentTurnHandler } from './turn-handler.js';

/**
 * ADR-035 — live step-event recording in the agent turn. One priced step per
 * turn with usage aggregated across iterations, `activity: 'agent'`.
 */

const USAGE = { input_tokens: 10, output_tokens: 5 };
const PRICES = `
version: 9
last_updated: '2026-06-01'
currency: USD
models:
  - id: test-model
    family: anthropic
    input_per_mtok: 3.00
    output_per_mtok: 15.00
    context_window: 200000
`;

function scriptedBackend(turns: LlmStreamEvent[][], mode: 'api' | 'cli' = 'api'): LlmBackend {
  let i = 0;
  return {
    id: 'fake',
    mode,
    async *stream(_req: LlmRequest): AsyncIterable<LlmStreamEvent> {
      const events = turns[Math.min(i, turns.length - 1)] ?? [];
      i += 1;
      for (const event of events) yield event;
    },
  };
}

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

function spyStep(): { recorder: StepRecorder; written: StepEvent[] } {
  const written: StepEvent[] = [];
  return {
    recorder: {
      async writeStep(e) {
        written.push(e);
      },
    },
    written,
  };
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-track-'));
}

describe('AgentTurnHandler — step recording (ADR-035)', () => {
  it('records one aggregated agent step across a multi-iteration turn', async () => {
    const root = await tempWorkspace();
    const spy = spyStep();
    const handler = new AgentTurnHandler({
      resolveBackend: () =>
        scriptedBackend(
          writeThenDone({ edits: [{ file: 'note.txt', originalCode: '', newCode: 'hi\n' }] }),
        ),
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      gate: new PermissionGate({}),
      decide: () => Promise.resolve('allow_once'),
      registry: buildDefaultToolRegistry({ workspaceRoot: root }),
      pricing: PricingBook.parse(PRICES),
      step: spy.recorder,
    });

    await handler.handleTurn('m1', { conversationId: 'c1', message: 'create note.txt' }, () => {});

    expect(spy.written).toHaveLength(1);
    const ev = spy.written[0]!;
    expect(ev.activity).toBe('agent');
    expect(ev.step_index).toBe(0);
    expect(ev.pricing_book_version).toBe(9);
    // Usage aggregated across both iterations (10 in + 5 out each).
    expect(ev.input_tokens).toBe(20);
    expect(ev.output_tokens).toBe(10);
    expect(ev.stop_reason).toBe('end_turn');
  });

  it('skips recording when no pricing book is configured', async () => {
    const spy = spyStep();
    const handler = new AgentTurnHandler({
      resolveBackend: () => scriptedBackend([[{ kind: 'stop', reason: 'end_turn', usage: USAGE }]]),
      resolveModel: () => 'test-model',
      store: new InMemoryConversationStore(),
      gate: new PermissionGate({}),
      decide: () => Promise.resolve('allow_once'),
      registry: buildDefaultToolRegistry({ workspaceRoot: await tempWorkspace() }),
      step: spy.recorder,
    });

    await handler.handleTurn('m1', { conversationId: 'c1', message: 'just answer' }, () => {});

    expect(spy.written).toEqual([]);
  });
});
