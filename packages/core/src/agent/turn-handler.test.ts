import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

describe('AgentTurnHandler — code-suggestion annotations', () => {
  it('folds an applied edit onto the turn as a `done` suggestion', async () => {
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

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'create note.txt' },
      () => {},
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.annotations).toHaveLength(1);
    expect(res.annotations?.[0]).toMatchObject({
      kind: 'code-suggestion',
      // Namespaced by the per-call ordinal so multiple write_files never collide.
      suggestionId: 'call0-edit-0',
      filePath: 'note.txt',
      state: 'done',
    });
  });

  it('marks a denied edit as `error` (Denied by user) and writes nothing', async () => {
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

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'edit' },
      () => {},
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.annotations?.[0]).toMatchObject({
      suggestionId: 'call0-edit-0',
      state: 'error',
      errorMessage: 'Denied by user',
    });
  });

  it('keeps an unresolved edit as a terminal `error` even when the call runs', async () => {
    const root = await tempWorkspace();
    await writeFile(join(root, 'b.txt'), 'real content', 'utf8');
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        resolveBackend: () =>
          scriptedBackend(
            writeThenDone({
              edits: [{ file: 'b.txt', originalCode: 'NOT PRESENT', newCode: 'x' }],
            }),
          ),
      }),
    );

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'edit' },
      () => {},
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.annotations?.[0]?.state).toBe('error');
    expect(res.changedFiles).toEqual([]);
  });

  it('namespaces ids per call so multiple write_files turns never collide', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        resolveBackend: () =>
          scriptedBackend([
            [
              { kind: 'tool_use_start', id: 'a', name: 'write_files' },
              {
                kind: 'tool_use_input_delta',
                id: 'a',
                json_delta: JSON.stringify({
                  edits: [{ file: 'one.txt', originalCode: '', newCode: '1\n' }],
                }),
              },
              { kind: 'tool_use_end', id: 'a', name: 'write_files', input: undefined },
              { kind: 'stop', reason: 'tool_use', usage: USAGE },
            ],
            [
              { kind: 'tool_use_start', id: 'b', name: 'write_files' },
              {
                kind: 'tool_use_input_delta',
                id: 'b',
                json_delta: JSON.stringify({
                  edits: [{ file: 'two.txt', originalCode: '', newCode: '2\n' }],
                }),
              },
              { kind: 'tool_use_end', id: 'b', name: 'write_files', input: undefined },
              { kind: 'stop', reason: 'tool_use', usage: USAGE },
            ],
            [
              { kind: 'text_delta', text: 'Done.' },
              { kind: 'stop', reason: 'end_turn', usage: USAGE },
            ],
          ]),
      }),
    );

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'two edits' },
      () => {},
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.annotations?.map((a) => a.suggestionId)).toEqual(['call0-edit-0', 'call1-edit-0']);
    expect(res.annotations?.every((a) => a.state === 'done')).toBe(true);
  });

  it('omits annotations on a turn that proposes no edits', async () => {
    const handler = new AgentTurnHandler(
      baseDeps({
        registry: buildDefaultToolRegistry({ workspaceRoot: '/tmp' }),
        resolveBackend: () =>
          scriptedBackend([
            [
              { kind: 'text_delta', text: 'No edits needed.' },
              { kind: 'stop', reason: 'end_turn', usage: USAGE },
            ],
          ]),
      }),
    );
    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'hi' },
      () => {},
    );
    expect((terminal.data as AgentTurnResponse).annotations).toBeUndefined();
  });
});

describe('AgentTurnHandler — agent-mode gating (T-PRD08)', () => {
  /** A backend that records the tool names advertised on its first stream call. */
  function recordingBackend(advertised: string[]): LlmBackend {
    return {
      id: 'fake',
      mode: 'api',
      async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
        for (const def of request.tools ?? []) advertised.push(def.name);
        yield { kind: 'stop', reason: 'end_turn', usage: USAGE };
      },
    };
  }

  it('does NOT advertise write_files in a read-only mode (ask), but lists the read tools', async () => {
    const root = await tempWorkspace();
    const advertised: string[] = [];
    const handler = new AgentTurnHandler(
      baseDeps({
        registry: buildDefaultToolRegistry({ workspaceRoot: root }),
        resolveBackend: () => recordingBackend(advertised),
      }),
    );
    await handler.handleTurn('m1', { conversationId: 'c1', message: 'hi', mode: 'ask' }, () => {});

    expect(advertised).not.toContain('write_files');
    expect(advertised).toEqual(expect.arrayContaining(['read_file', 'list_dir', 'glob', 'grep']));
  });

  it('DOES advertise write_files in edit mode (and when mode is omitted = default edit)', async () => {
    const root = await tempWorkspace();
    const adWithMode: string[] = [];
    const adDefault: string[] = [];
    await new AgentTurnHandler(
      baseDeps({
        registry: buildDefaultToolRegistry({ workspaceRoot: root }),
        resolveBackend: () => recordingBackend(adWithMode),
      }),
    ).handleTurn('m1', { conversationId: 'c1', message: 'hi', mode: 'edit' }, () => {});
    await new AgentTurnHandler(
      baseDeps({
        registry: buildDefaultToolRegistry({ workspaceRoot: root }),
        resolveBackend: () => recordingBackend(adDefault),
      }),
    ).handleTurn('m2', { conversationId: 'c2', message: 'hi' }, () => {});

    expect(adWithMode).toContain('write_files');
    expect(adDefault).toContain('write_files');
  });

  it('refuses a stale write_files call in a read-only mode and writes nothing (B3 backstop)', async () => {
    const root = await tempWorkspace();
    // The model emits a write_files call from prior context even though the
    // read-only mode never advertised it — the backstop must refuse it.
    const handler = new AgentTurnHandler(
      baseDeps({
        registry: buildDefaultToolRegistry({ workspaceRoot: root }),
        resolveBackend: () =>
          scriptedBackend(
            writeThenDone({ edits: [{ file: 'note.txt', originalCode: '', newCode: 'hi\n' }] }),
          ),
      }),
    );
    const { emit, envelopes } = collect();

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'create note.txt', mode: 'plan' },
      emit,
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.changedFiles).toEqual([]);
    expect(res.mode).toBe('plan');
    // Never reached approval/exec — only started + error for the refused call.
    const kinds = toolEvents(envelopes).map((t) => t.kind);
    expect(kinds).toEqual(['started', 'error']);
    const err = toolEvents(envelopes).find((t) => t.kind === 'error');
    expect(err?.kind === 'error' && err.message).toContain("'plan' mode");
    // No file was written to disk.
    await expect(readFile(join(root, 'note.txt'), 'utf8')).rejects.toThrow();
  });

  it('surfaces the resolved mode on the response (ask) and defaults to edit when omitted', async () => {
    const root = await tempWorkspace();
    const make = (): AgentTurnHandler =>
      new AgentTurnHandler(
        baseDeps({ registry: buildDefaultToolRegistry({ workspaceRoot: root }) }),
      );

    const ask = (
      await make().handleTurn('m1', { conversationId: 'c1', message: 'hi', mode: 'ask' }, () => {})
    ).data as AgentTurnResponse;
    const def = (await make().handleTurn('m2', { conversationId: 'c2', message: 'hi' }, () => {}))
      .data as AgentTurnResponse;

    expect(ask.mode).toBe('ask');
    expect(def.mode).toBe('edit');
  });
});

describe('AgentTurnHandler — anti-loop guard (T-702c)', () => {
  /** A scripted write_files tool turn (input merged from the json_delta). */
  function writeTurn(id: string, input: unknown): LlmStreamEvent[] {
    return [
      { kind: 'tool_use_start', id, name: 'write_files' },
      { kind: 'tool_use_input_delta', id, json_delta: JSON.stringify(input) },
      { kind: 'tool_use_end', id, name: 'write_files', input: undefined },
      { kind: 'stop', reason: 'tool_use', usage: USAGE },
    ];
  }
  const doneTurn: LlmStreamEvent[] = [
    { kind: 'text_delta', text: 'Recovered.' },
    { kind: 'stop', reason: 'end_turn', usage: USAGE },
  ];

  it('stops the turn when the model re-proposes the identical write_files batch twice', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const sameBatch = { edits: [{ file: 'loop.txt', originalCode: '', newCode: 'created\n' }] };
    // The backend repeats the SAME batch every iteration (scriptedBackend repeats
    // its last turn). maxIterations is high so reaching a stop at iteration 3
    // proves the GUARD stopped it, not the natural iteration cap.
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        maxIterations: 10,
        resolveBackend: () => scriptedBackend([writeTurn('tc', sameBatch)]),
      }),
    );
    const { emit, envelopes } = collect();

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'loop' },
      emit,
    );
    const res = terminal.data as AgentTurnResponse;

    // 1st occurrence runs; 2nd (first repeat) is nudged; 3rd stops the turn.
    expect(res.iterations).toBe(3);
    expect(res.stopReason).toBe('max_iterations');
    // The batch applied exactly ONCE — the repeats short-circuited before any
    // redundant apply (one `started` lifecycle event, from iteration 1 only).
    expect(toolEvents(envelopes).filter((t) => t.kind === 'started')).toHaveLength(1);
    expect(res.changedFiles).toEqual(['loop.txt']);
  });

  it('does not flag identical content sent to DIFFERENT files (path is in the hash)', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    // Same newCode, different file path → different batch hash → no false repeat.
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        resolveBackend: () =>
          scriptedBackend([
            writeTurn('a', { edits: [{ file: 'x.txt', originalCode: '', newCode: 'same\n' }] }),
            writeTurn('b', { edits: [{ file: 'y.txt', originalCode: '', newCode: 'same\n' }] }),
            doneTurn,
          ]),
      }),
    );
    const { emit, envelopes } = collect();

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'two files' },
      emit,
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.stopReason).toBe('end_turn');
    expect(res.iterations).toBe(3);
    expect(res.changedFiles.sort()).toEqual(['x.txt', 'y.txt']);
    // Both writes executed — neither short-circuited.
    expect(toolEvents(envelopes).filter((t) => t.kind === 'started')).toHaveLength(2);
    expect(await readFile(join(root, 'x.txt'), 'utf8')).toBe('same\n');
    expect(await readFile(join(root, 'y.txt'), 'utf8')).toBe('same\n');
  });

  it('nudges once on the first repeat and lets the model recover (no premature stop)', async () => {
    const root = await tempWorkspace();
    const registry = buildDefaultToolRegistry({ workspaceRoot: root });
    const batch = { edits: [{ file: 'note.txt', originalCode: '', newCode: 'hi\n' }] };
    // Iteration 1 applies; iteration 2 re-proposes the identical batch (first
    // repeat → one nudge, no apply); iteration 3 the model changes course and
    // ends the turn cleanly.
    const handler = new AgentTurnHandler(
      baseDeps({
        registry,
        resolveBackend: () =>
          scriptedBackend([writeTurn('tc1', batch), writeTurn('tc2', batch), doneTurn]),
      }),
    );
    const { emit, envelopes } = collect();

    const terminal = await handler.handleTurn(
      'm1',
      { conversationId: 'c1', message: 'edit then loop then recover' },
      emit,
    );
    const res = terminal.data as AgentTurnResponse;

    expect(res.stopReason).toBe('end_turn');
    expect(res.iterations).toBe(3);
    expect(res.text).toBe('Recovered.');
    // Only the first occurrence applied; the repeat was nudged, not re-run.
    expect(toolEvents(envelopes).filter((t) => t.kind === 'started')).toHaveLength(1);
    expect(res.changedFiles).toEqual(['note.txt']);
  });
});
