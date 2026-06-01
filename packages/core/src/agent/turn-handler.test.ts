import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AgentTurnResponse,
  ContextScope,
  ContextSnippetAnnotation,
  Envelope,
  LlmRequest,
  LlmStreamEvent,
  ToolCallEvent,
} from '@event4u-agent/protocol';
import { InMemoryConversationStore } from '../chat/store.js';
import type { LlmBackend } from '../llm/backend.js';
import { PermissionGate } from '../permissions/gate.js';
import { Dispatcher } from '../server.js';
import { buildDefaultToolRegistry, MapToolRegistry, type ToolRegistry } from './tool-registry.js';
import { AgentTurnHandler, type AgentTurnHandlerDeps } from './turn-handler.js';

const USAGE = { input_tokens: 10, output_tokens: 5 };

/** A backend that plays one scripted event list per `stream` call (one per iteration). */
function scriptedBackend(turns: LlmStreamEvent[][], mode: 'api' | 'cli' = 'api'): LlmBackend {
  let i = 0;
  return {
    id: 'fake',
    mode,
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      const events = turns[Math.min(i, turns.length - 1)] ?? [];
      i += 1;
      for (const event of events) yield event;
    },
  };
}

/** One write_files tool-call turn followed by a final text turn. */
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

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-turn-'));
}

function baseDeps(
  overrides: Partial<AgentTurnHandlerDeps> & { registry: ToolRegistry },
): AgentTurnHandlerDeps {
  return {
    resolveBackend: () => scriptedBackend([[{ kind: 'stop', reason: 'end_turn', usage: USAGE }]]),
    resolveModel: () => 'test-model',
    store: new InMemoryConversationStore(),
    gate: new PermissionGate({}),
    decide: () => Promise.resolve('allow_once'),
    ...overrides,
  };
}

function collect(): { emit: (e: Envelope) => void; envelopes: Envelope[] } {
  const envelopes: Envelope[] = [];
  return { emit: (e) => envelopes.push(e), envelopes };
}

function toolEvents(envelopes: Envelope[]): ToolCallEvent[] {
  return envelopes
    .map((e) => (e.data as { toolEvent?: ToolCallEvent }).toolEvent)
    .filter((t): t is ToolCallEvent => t !== undefined);
}

describe('AgentTurnHandler — end-to-end edit', () => {
  it('edits one file across a tool turn then a final text turn', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        resolveBackend: () =>
          scriptedBackend(
            writeThenDone({ edits: [{ file: 'note.txt', originalCode: '', newCode: 'hi\n' }] }),
          ),
      }),
    );
    const { emit, envelopes } = collect();

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'create note.txt' },
      emit,
    );
    const res = terminal.data as AgentTurnResponse;

    expect(terminal.done).toBe(true);
    expect(res.changedFiles).toEqual(['note.txt']);
    expect(res.iterations).toBe(2);
    expect(res.stopReason).toBe('end_turn');
    expect(res.text).toBe('Done.');
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('hi\n');

    // The lifecycle stream carries the full approval story for the one call.
    const kinds = toolEvents(envelopes).map((t) => t.kind);
    expect(kinds).toEqual(['started', 'approvalRequested', 'approvalResolved', 'result']);
    // Usage is aggregated across both iterations (10 in + 5 out each).
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('aborts the edit when the decision is deny and feeds the model an error', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        decide: () => Promise.resolve('deny'),
        resolveBackend: () =>
          scriptedBackend(
            writeThenDone({ edits: [{ file: 'denied.txt', originalCode: '', newCode: 'x' }] }),
          ),
      }),
    );
    const { emit, envelopes } = collect();

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'edit' },
      emit,
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.changedFiles).toEqual([]);
    expect(res.stopReason).toBe('end_turn');
    await expect(readFile(join(root, 'denied.txt'), 'utf8')).rejects.toThrow();
    const decisions = toolEvents(envelopes).filter((t) => t.kind === 'approvalResolved');
    expect(decisions).toHaveLength(1);
  });

  it('caps a runaway loop at maxIterations', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    // Every iteration requests a tool — the loop never reaches end_turn.
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        maxIterations: 3,
        resolveBackend: () =>
          scriptedBackend([
            [
              { kind: 'tool_use_start', id: 'tc', name: 'write_files' },
              { kind: 'tool_use_input_delta', id: 'tc', json_delta: '{"edits":[]}' },
              { kind: 'tool_use_end', id: 'tc', name: 'write_files', input: undefined },
              { kind: 'stop', reason: 'tool_use', usage: USAGE },
            ],
          ]),
      }),
    );

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'spin' },
      () => {},
    );
    const res = terminal.data as AgentTurnResponse;
    expect(res.iterations).toBe(3);
    expect(res.stopReason).toBe('max_iterations');
  });

  it('reports an unknown tool as an error and recovers next turn', async () => {
    const handler = new AgentTurnHandler(
      baseDeps({
        registry: new MapToolRegistry([]),
        resolveBackend: () =>
          scriptedBackend([
            [
              { kind: 'tool_use_start', id: 'tc', name: 'frobnicate' },
              { kind: 'tool_use_end', id: 'tc', name: 'frobnicate', input: {} },
              { kind: 'stop', reason: 'tool_use', usage: USAGE },
            ],
            [
              { kind: 'text_delta', text: 'No such tool.' },
              { kind: 'stop', reason: 'end_turn', usage: USAGE },
            ],
          ]),
      }),
    );
    const { emit, envelopes } = collect();
    const terminal = await handler.handleTurn('m1', { conversationId: 'c1', message: 'x' }, emit);
    const res = terminal.data as AgentTurnResponse;
    expect(res.stopReason).toBe('end_turn');
    expect(res.text).toBe('No such tool.');
    expect(toolEvents(envelopes).some((t) => t.kind === 'error')).toBe(true);
  });

  it('a mid-tool cancel never writes and ends the turn cancelled', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        // Cancel the conversation the moment the approval decision is asked,
        // then deny — the loop must stop without writing.
        decide: () => {
          handler.cancel('c1');
          return Promise.resolve('deny');
        },
        resolveBackend: () =>
          scriptedBackend(
            writeThenDone({ edits: [{ file: 'cancel.txt', originalCode: '', newCode: 'x' }] }),
          ),
      }),
    );

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'edit' },
      () => {},
    );
    const res = terminal.data as AgentTurnResponse;
    expect(res.cancelled).toBe(true);
    expect(res.stopReason).toBe('cancelled');
    expect(res.changedFiles).toEqual([]);
    await expect(readFile(join(root, 'cancel.txt'), 'utf8')).rejects.toThrow();
  });

  it('rejects a concurrent turn for the same conversation', async () => {
    // Hold the first turn open by deferring the backend.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const handler = new AgentTurnHandler(
      baseDeps({
        registry: new MapToolRegistry([]),
        resolveBackend: () => ({
          id: 'slow',
          mode: 'api',
          async *stream(): AsyncIterable<LlmStreamEvent> {
            await gate;
            yield { kind: 'stop', reason: 'end_turn', usage: USAGE };
          },
        }),
      }),
    );
    const first = handler.handleTurn('m1', { conversationId: 'dup', message: 'a' }, () => {});
    await expect(
      handler.handleTurn('m2', { conversationId: 'dup', message: 'b' }, () => {}),
    ).rejects.toMatchObject({ code: 'agent_busy' });
    release();
    await first;
    expect(handler.isActive('dup')).toBe(false);
  });
});

describe('AgentTurnHandler — dispatcher wiring', () => {
  it('routes agentTurn through the dispatcher and returns the terminal envelope', async () => {
    const root = await tempWorkspace();
    const handler = new AgentTurnHandler(
      baseDeps({
        registry: buildDefaultToolRegistry({ workspaceRoot: root }),
        resolveBackend: () =>
          scriptedBackend([
            [
              { kind: 'text_delta', text: 'hi' },
              { kind: 'stop', reason: 'end_turn', usage: USAGE },
            ],
          ]),
      }),
    );
    const dispatcher = new Dispatcher(undefined, undefined, undefined, handler);
    const terminal = await dispatcher.dispatch({
      messageId: 'm1',
      messageType: 'agentTurn',
      data: { conversationId: 'c1', message: 'hi' },
      done: true,
    });
    expect(terminal.messageType).toBe('agentTurn');
    expect((terminal.data as AgentTurnResponse).text).toBe('hi');
    dispatcher.dispose();
  });

  it('returns agent_not_configured when no handler is wired', async () => {
    const dispatcher = new Dispatcher();
    const terminal = await dispatcher.dispatch({
      messageId: 'm1',
      messageType: 'agentTurn',
      data: { conversationId: 'c1', message: 'hi' },
      done: true,
    });
    expect(terminal.messageType).toBe('error');
    expect((terminal.data as { code: string }).code).toBe('agent_not_configured');
    dispatcher.dispose();
  });
});

describe('AgentTurnHandler — scoped context retrieval (T-MR13)', () => {
  /** A backend that records every request it streams (one per loop iteration). */
  function capturingBackend(turns: LlmStreamEvent[][]): {
    backend: LlmBackend;
    requests: LlmRequest[];
  } {
    const requests: LlmRequest[] = [];
    let i = 0;
    const backend: LlmBackend = {
      id: 'capture',
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

  const textTurn: LlmStreamEvent[][] = [
    [
      { kind: 'text_delta', text: 'ok' },
      { kind: 'stop', reason: 'end_turn', usage: USAGE },
    ],
  ];

  const snippet = (filePath: string): ContextSnippetAnnotation => ({
    kind: 'context-snippet',
    rootId: 'A',
    filePath,
    startLine: 1,
    endLine: 3,
    relevance: 1,
    category: 'source',
    preview: `// ${filePath}\nconst x = 1;`,
  });

  function handlerWith(
    backend: LlmBackend,
    retrieveContext: AgentTurnHandlerDeps['retrieveContext'],
    extra: Partial<AgentTurnHandlerDeps> = {},
  ): AgentTurnHandler {
    return new AgentTurnHandler(
      baseDeps({
        registry: new MapToolRegistry([]),
        resolveBackend: () => backend,
        ...(retrieveContext ? { retrieveContext } : {}),
        ...extra,
      }),
    );
  }

  async function run(handler: AgentTurnHandler, req: { scope?: ContextScope }): Promise<Envelope> {
    return handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'how does auth work?', ...req },
      () => {},
    );
  }

  it('folds snippets into the system prompt (after the static base) and surfaces them', async () => {
    const { backend, requests } = capturingBackend(textTurn);
    const calls: { query: string; scope: ContextScope }[] = [];
    const handler = handlerWith(
      backend,
      async (query, scope) => {
        calls.push({ query, scope });
        return [snippet('src/a.ts'), snippet('src/b.ts')];
      },
      { system: 'You are an editing agent.' },
    );

    const terminal = await run(handler, {});

    // Retriever saw the user message and the default `all` scope (fork B1 + E-default).
    expect(calls).toEqual([{ query: 'how does auth work?', scope: { kind: 'all' } }]);
    // Layer order A1: the static system precedes the <workspace-context> block.
    const system = requests[0]?.system ?? '';
    expect(system).toContain('You are an editing agent.');
    expect(system).toContain('<workspace-context>');
    expect(system).toContain('// src/a.ts:1-3');
    expect(system.indexOf('You are an editing agent.')).toBeLessThan(
      system.indexOf('<workspace-context>'),
    );
    // The response carries EXACTLY the injected snippets (fork C1).
    const res = terminal.data as AgentTurnResponse;
    expect(res.annotations?.map((a) => a.filePath)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('retrieves ONCE and reuses the same context block across every iteration (B1)', async () => {
    // Iteration 1 issues an (unknown) tool call → is_error fed back → iteration 2
    // is the final text turn. Both requests must carry the same context block.
    const { backend, requests } = capturingBackend(writeThenDone({ files: [] }));
    let retrievals = 0;
    const handler = handlerWith(backend, async () => {
      retrievals += 1;
      return [snippet('src/a.ts')];
    });

    await run(handler, {});

    expect(retrievals).toBe(1);
    expect(requests.length).toBe(2);
    for (const request of requests) {
      expect(request.system).toContain('<workspace-context>');
      expect(request.system).toContain('// src/a.ts:1-3');
    }
  });

  it('short-circuits scope `none` — no retrieval, no annotations, no context block', async () => {
    const { backend, requests } = capturingBackend(textTurn);
    let called = false;
    const handler = handlerWith(backend, async () => {
      called = true;
      return [snippet('x.ts')];
    });

    const terminal = await run(handler, { scope: { kind: 'none' } });

    expect(called).toBe(false);
    expect(requests[0]?.system).toBeUndefined();
    expect((terminal.data as AgentTurnResponse).annotations).toBeUndefined();
  });

  it('is a no-op when no retriever is wired (existing agent-turn path unchanged)', async () => {
    const { backend, requests } = capturingBackend(textTurn);
    const handler = handlerWith(backend, undefined);

    const terminal = await run(handler, {});

    expect(requests[0]?.system).toBeUndefined();
    expect((terminal.data as AgentTurnResponse).annotations).toBeUndefined();
  });

  it('fail-open: a retrieval error degrades to no context, the turn still completes', async () => {
    const { backend, requests } = capturingBackend(textTurn);
    const handler = handlerWith(backend, async () => {
      throw new Error('index exploded');
    });

    const terminal = await run(handler, {});

    expect(requests[0]?.system).toBeUndefined();
    expect((terminal.data as AgentTurnResponse).text).toBe('ok');
    expect((terminal.data as AgentTurnResponse).annotations).toBeUndefined();
  });

  it('re-throws an abort from retrieval (Stop must not be swallowed) and releases the slot', async () => {
    const { backend } = capturingBackend(textTurn);
    const handler = handlerWith(backend, async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    await expect(run(handler, {})).rejects.toThrow('aborted');
    expect(handler.isActive('c1')).toBe(false);
  });
});
