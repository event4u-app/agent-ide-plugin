import { describe, expect, it } from 'vitest';
import {
  AgentToolEventSchema,
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  AnnotationSchema,
  CapVerdictSchema,
  ChatBudgetStatusSchema,
  ChatCostSchema,
  ChatEstimateEventSchema,
  ChatSendRequestSchema,
  ChatSendResponseSchema,
  ChatTokenEventSchema,
  CommandListRequestSchema,
  CommandListResponseSchema,
  CommandReadRequestSchema,
  CommandReadResponseSchema,
  ConfigReadRequestSchema,
  ConfigReadResponseSchema,
  ConnectRequestSchema,
  CodeSuggestionAnnotationSchema,
  ContextScopeSchema,
  ContextSnippetAnnotationSchema,
  ConversationListRequestSchema,
  ConversationListResponseSchema,
  ConversationRewindRequestSchema,
  ConversationRewindResponseSchema,
  ConversationSearchRequestSchema,
  ConversationSearchResponseSchema,
  CostReportRequestSchema,
  CostReportResponseSchema,
  EchoRequestSchema,
  EchoResponseSchema,
  EnvelopeSchema,
  GitReviewApplyFixRequestSchema,
  GitReviewApplyFixResponseSchema,
  GitReviewFindingSchema,
  MethodNameSchema,
  Methods,
  OnboardingDetectResponseSchema,
  PingResponseSchema,
  RootIndexStatusSchema,
  StatusRowAnnotationSchema,
  ToolCallEventSchema,
  ToolReviewSchema,
  TerminalEventSchema,
  TerminalInputResponseSchema,
  TerminalSubscribeRequestSchema,
  WorkspaceFolderSchema,
  WorkspaceFoldersChangedRequestSchema,
} from './schema.js';

describe('EnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    const parsed = EnvelopeSchema.parse({
      messageId: 'abc',
      messageType: 'ping',
      data: {},
      done: true,
    });
    expect(parsed.messageId).toBe('abc');
  });

  it('rejects an empty messageId', () => {
    expect(() =>
      EnvelopeSchema.parse({ messageId: '', messageType: 'ping', data: {}, done: true }),
    ).toThrow();
  });

  it('rejects a missing done flag', () => {
    expect(() => EnvelopeSchema.parse({ messageId: 'a', messageType: 'ping', data: {} })).toThrow();
  });
});

describe('method schemas', () => {
  it('ping responds with the pong literal', () => {
    expect(PingResponseSchema.parse({ result: 'pong' }).result).toBe('pong');
    expect(() => PingResponseSchema.parse({ result: 'nope' })).toThrow();
  });

  it('echo round-trips its text', () => {
    const req = EchoRequestSchema.parse({ text: 'hello' });
    expect(EchoResponseSchema.parse({ text: req.text }).text).toBe('hello');
  });
});

describe('workspace-folder schemas', () => {
  const folder = {
    uri: 'file:///repo/web',
    stableId: 'file:///repo/web',
    displayName: 'web',
    kind: 'folder',
  };

  it('accepts a well-formed workspace folder', () => {
    expect(WorkspaceFolderSchema.parse(folder).displayName).toBe('web');
  });

  it('rejects a folder with an empty uri', () => {
    expect(() => WorkspaceFolderSchema.parse({ ...folder, uri: '' })).toThrow();
  });

  it('connect handshake defaults to the empty single-root fallback', () => {
    expect(ConnectRequestSchema.parse({}).workspaceFolders).toEqual([]);
    expect(
      ConnectRequestSchema.parse({ workspaceFolders: [folder] }).workspaceFolders,
    ).toHaveLength(1);
  });

  it('workspaceFoldersChanged defaults added/removed to empty lists', () => {
    const parsed = WorkspaceFoldersChangedRequestSchema.parse({ added: [folder] });
    expect(parsed.added).toHaveLength(1);
    expect(parsed.removed).toEqual([]);
  });

  it('root index status round-trips with nullable fields', () => {
    const ready = RootIndexStatusSchema.parse({
      stableId: 's1',
      state: 'ready',
      fileCount: 42,
      totalFiles: 42,
      message: null,
    });
    expect(ready.state).toBe('ready');
    expect(() =>
      RootIndexStatusSchema.parse({ stableId: 's1', state: 'bogus', fileCount: 0 }),
    ).toThrow();
  });
});

describe('context scope (discriminated union)', () => {
  it('accepts all / roots / none', () => {
    expect(ContextScopeSchema.parse({ kind: 'all' }).kind).toBe('all');
    expect(ContextScopeSchema.parse({ kind: 'none' }).kind).toBe('none');
    const roots = ContextScopeSchema.parse({ kind: 'roots', rootIds: ['a', 'b'] });
    expect(roots.kind === 'roots' && roots.rootIds).toEqual(['a', 'b']);
  });

  it('rejects an empty explicit root set (use kind:none instead)', () => {
    expect(() => ContextScopeSchema.parse({ kind: 'roots', rootIds: [] })).toThrow();
  });
});

describe('annotation schemas (context-snippet + code-suggestion seams)', () => {
  const snippet = {
    kind: 'context-snippet' as const,
    rootId: 'A',
    filePath: 'src/auth.ts',
    startLine: 0,
    endLine: 2,
    relevance: 0.5,
    category: 'source' as const,
    preview: 'export function authenticateUser() {}',
  };

  it('accepts a well-formed context-snippet annotation via the union', () => {
    const parsed = AnnotationSchema.parse(snippet);
    expect(parsed.kind).toBe('context-snippet');
    expect(ContextSnippetAnnotationSchema.parse(snippet).filePath).toBe('src/auth.ts');
  });

  it('rejects relevance outside 0..1', () => {
    expect(() => ContextSnippetAnnotationSchema.parse({ ...snippet, relevance: 1.5 })).toThrow();
    expect(() => ContextSnippetAnnotationSchema.parse({ ...snippet, relevance: -0.1 })).toThrow();
  });

  it('rejects an unknown category and a negative line number', () => {
    expect(() =>
      ContextSnippetAnnotationSchema.parse({ ...snippet, category: 'binary' }),
    ).toThrow();
    expect(() => ContextSnippetAnnotationSchema.parse({ ...snippet, startLine: -1 })).toThrow();
  });

  const suggestion = {
    kind: 'code-suggestion' as const,
    suggestionId: 'edit-0',
    filePath: 'src/auth.ts',
    state: 'pending' as const,
    diffPreview: '@@ -1 +1 @@\n-a\n+b',
  };

  it('accepts a well-formed code-suggestion annotation via the union', () => {
    const parsed = AnnotationSchema.parse(suggestion);
    expect(parsed.kind).toBe('code-suggestion');
    expect(CodeSuggestionAnnotationSchema.parse(suggestion).state).toBe('pending');
  });

  it('carries an errorMessage only when present', () => {
    const errored = { ...suggestion, state: 'error' as const, errorMessage: 'not found' };
    expect(CodeSuggestionAnnotationSchema.parse(errored).errorMessage).toBe('not found');
    expect(CodeSuggestionAnnotationSchema.parse(suggestion).errorMessage).toBeUndefined();
  });

  it('rejects an unknown suggestion state and an empty suggestionId', () => {
    expect(() =>
      CodeSuggestionAnnotationSchema.parse({ ...suggestion, state: 'queued' }),
    ).toThrow();
    expect(() =>
      CodeSuggestionAnnotationSchema.parse({ ...suggestion, suggestionId: '' }),
    ).toThrow();
  });

  const statusRow = {
    kind: 'status-row' as const,
    statusId: 'phase-implement',
    label: 'Implement',
    state: 'active' as const,
    phase: 'implement' as const,
  };

  it('accepts a well-formed status-row annotation via the union', () => {
    const parsed = AnnotationSchema.parse(statusRow);
    expect(parsed.kind).toBe('status-row');
    expect(StatusRowAnnotationSchema.parse(statusRow).state).toBe('active');
  });

  it('treats phase and detail as optional (non-phase rows omit phase)', () => {
    const indexing = {
      kind: 'status-row' as const,
      statusId: 'indexing',
      label: 'Indexing',
      state: 'active' as const,
      detail: 'Indexing 4,238 / 21,500 files…',
    };
    const parsed = StatusRowAnnotationSchema.parse(indexing);
    expect(parsed.phase).toBeUndefined();
    expect(parsed.detail).toBe('Indexing 4,238 / 21,500 files…');
  });

  it('rejects an unknown status-row state, an unknown phase, and an empty statusId', () => {
    expect(() => StatusRowAnnotationSchema.parse({ ...statusRow, state: 'queued' })).toThrow();
    expect(() => StatusRowAnnotationSchema.parse({ ...statusRow, phase: 'done' })).toThrow();
    expect(() => StatusRowAnnotationSchema.parse({ ...statusRow, statusId: '' })).toThrow();
  });

  it('rejects an unknown annotation kind', () => {
    expect(() => AnnotationSchema.parse({ ...snippet, kind: 'bogus-kind' })).toThrow();
  });
});

describe('terminal schemas (Phase 9)', () => {
  it('subscribe defaults replayFromSeq to 0', () => {
    const parsed = TerminalSubscribeRequestSchema.parse({ commandId: 'c1', surfaceId: 'chat' });
    expect(parsed.replayFromSeq).toBe(0);
  });

  it('the event union discriminates on kind', () => {
    const out = TerminalEventSchema.parse({
      kind: 'output',
      commandId: 'c1',
      chunk: { seq: 0, data: 'x', at: '2026-01-01T00:00:00Z' },
    });
    expect(out.kind).toBe('output');
    const conflict = TerminalEventSchema.parse({
      kind: 'inputConflict',
      commandId: 'c1',
      inputRequestId: 'r1',
      winningSurfaceId: 'chat',
      losingSurfaceId: 'ide',
    });
    expect(conflict.kind).toBe('inputConflict');
    expect(() => TerminalEventSchema.parse({ kind: 'bogus', commandId: 'c1' })).toThrow();
  });

  it('input response carries an arbitration reason on rejection', () => {
    const rejected = TerminalInputResponseSchema.parse({
      accepted: false,
      reason: 'already-submitted',
      winningSurfaceId: 'chat',
    });
    expect(rejected.reason).toBe('already-submitted');
    expect(() => TerminalInputResponseSchema.parse({ accepted: false, reason: 'nope' })).toThrow();
  });
});

describe('chat schemas (vertical slice)', () => {
  it('chatSend request requires conversationId + message; provider/scope optional', () => {
    const req = ChatSendRequestSchema.parse({ conversationId: 'c1', message: 'hi' });
    expect(req.conversationId).toBe('c1');
    expect(req.providerId).toBeUndefined();
    const scoped = ChatSendRequestSchema.parse({
      conversationId: 'c1',
      message: 'hi',
      providerId: 'anthropic',
      scope: { kind: 'roots', rootIds: ['r1'] },
    });
    expect(scoped.scope).toEqual({ kind: 'roots', rootIds: ['r1'] });
    expect(() => ChatSendRequestSchema.parse({ message: 'hi' })).toThrow();
  });

  it('token event carries one streamed token', () => {
    expect(ChatTokenEventSchema.parse({ token: 'abc' }).token).toBe('abc');
  });

  // T-VS12 — the cost shape is the single source both clients only FORMAT.
  it('cost is the single shared shape: model + mode + totalUsd + isEstimate', () => {
    const cost = ChatCostSchema.parse({
      model: 'claude-sonnet-4-6',
      mode: 'cli',
      totalUsd: 0.0042,
      isEstimate: true,
    });
    expect(cost).toEqual({
      model: 'claude-sonnet-4-6',
      mode: 'cli',
      totalUsd: 0.0042,
      isEstimate: true,
    });
    // No extra per-client fields creep in — the contract is exactly these four.
    expect(Object.keys(ChatCostSchema.shape).sort()).toEqual([
      'isEstimate',
      'mode',
      'model',
      'totalUsd',
    ]);
    // A negative cost is rejected.
    expect(() =>
      ChatCostSchema.parse({ model: 'm', mode: 'api', totalUsd: -1, isEstimate: false }),
    ).toThrow();
  });

  it('response carries text, usage, cost, cancelled and stopReason', () => {
    const res = ChatSendResponseSchema.parse({
      messageId: 'm1',
      text: 'hello world',
      usage: { inputTokens: 10, outputTokens: 5 },
      cost: { model: 'test-model', mode: 'api', totalUsd: 0.001, isEstimate: false },
      cancelled: false,
      stopReason: 'end_turn',
    });
    expect(res.cost.mode).toBe('api');
    expect(res.usage.outputTokens).toBe(5);
    expect(() =>
      ChatSendResponseSchema.parse({
        messageId: 'm1',
        text: 't',
        usage: { inputTokens: 1, outputTokens: 1 },
        cost: { model: 'm', mode: 'bogus', totalUsd: 0, isEstimate: true },
        cancelled: false,
        stopReason: 'end_turn',
      }),
    ).toThrow();
  });
});

describe('method registry', () => {
  it('exposes the multi-project + terminal + chat methods alongside ping/echo', () => {
    expect(Object.keys(Methods).sort()).toEqual([
      'agentTurn',
      'chatCancel',
      'chatSend',
      'commandList',
      'commandRead',
      'configList',
      'configRead',
      'connect',
      'conversationList',
      'conversationRewind',
      'conversationSearch',
      'costReport',
      'echo',
      'gitCommitMessage',
      'gitPrDescription',
      'gitReviewApplyFix',
      'gitReviewSummary',
      'onboardingDetect',
      'ping',
      'rootStatus',
      'terminalInput',
      'terminalResize',
      'terminalSubscribe',
      'workspaceFoldersChanged',
    ]);
  });

  it('MethodNameSchema only accepts registered names', () => {
    expect(MethodNameSchema.parse('ping')).toBe('ping');
    expect(MethodNameSchema.parse('connect')).toBe('connect');
    expect(() => MethodNameSchema.parse('frobnicate')).toThrow();
  });

  it('registers agentTurn but not a bare toolCall method', () => {
    expect(Object.keys(Methods)).toContain('agentTurn');
    expect(Object.keys(Methods)).not.toContain('toolCall');
  });

  it('onboardingDetect response round-trips the readiness shape (booleans only, no key value)', () => {
    const res = OnboardingDetectResponseSchema.parse({
      node: { version: '20.11.1', major: 20, ok: true },
      anthropicKey: true,
      claudeCli: false,
      recommendedMode: 'api',
      ready: true,
      blockers: [],
    });
    expect(res.node.ok).toBe(true);
    expect(res.recommendedMode).toBe('api');
    expect(Object.keys(res).sort()).toEqual([
      'anthropicKey',
      'blockers',
      'claudeCli',
      'node',
      'ready',
      'recommendedMode',
    ]);
    // The wire shape carries no field that could leak the key value.
    expect(Object.keys(res)).not.toContain('apiKey');
  });

  it('conversationRewind round-trips a found plan and a not-found result', () => {
    const req = ConversationRewindRequestSchema.parse({
      conversationId: 'c1',
      checkpointId: 'cp1',
    });
    expect(req.checkpointId).toBe('cp1');

    const found = ConversationRewindResponseSchema.parse({
      conversationId: 'c1',
      checkpointId: 'cp1',
      found: true,
      targetTurnIndex: 2,
      changedFiles: ['src/a.ts'],
      warnings: [],
    });
    expect(found.found).toBe(true);
    expect(found.targetTurnIndex).toBe(2);
    // No message-body or workState field on the wire (council Q1/Q2=A).
    expect(Object.keys(found)).not.toContain('messagesToKeep');
    expect(Object.keys(found)).not.toContain('workState');

    const missing = ConversationRewindResponseSchema.parse({
      conversationId: 'c1',
      checkpointId: 'gone',
      found: false,
    });
    expect(missing.found).toBe(false);
    expect(missing.targetTurnIndex).toBeUndefined();

    // Empty conversationId/checkpointId are rejected at the request boundary.
    expect(() =>
      ConversationRewindRequestSchema.parse({ conversationId: '', checkpointId: 'x' }),
    ).toThrow();
  });

  it('conversationSearch round-trips a request and ranked results', () => {
    // Empty query is VALID (council Q2=A) — the IDE round-trips a cleared box.
    expect(ConversationSearchRequestSchema.parse({ query: '' }).query).toBe('');
    const req = ConversationSearchRequestSchema.parse({ query: 'auth bug', limit: 5 });
    expect(req.limit).toBe(5);
    // A non-positive / non-integer limit is rejected at the boundary.
    expect(() => ConversationSearchRequestSchema.parse({ query: 'x', limit: 0 })).toThrow();

    const res = ConversationSearchResponseSchema.parse({
      results: [
        {
          summary: {
            id: 'c1',
            title: 'Fix auth',
            messageCount: 4,
            checkpointCount: 1,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
          hitCount: 2,
          snippet: '…auth bug…',
        },
      ],
    });
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.summary.title).toBe('Fix auth');
    expect(res.results[0]!.hitCount).toBe(2);
    // parentId / snippet are optional and omitted cleanly.
    const noSnippet = ConversationSearchResponseSchema.parse({
      results: [
        {
          summary: {
            id: 'c2',
            title: 't',
            messageCount: 0,
            checkpointCount: 0,
            createdAt: 'a',
            updatedAt: 'b',
          },
          hitCount: 1,
        },
      ],
    });
    expect(noSnippet.results[0]!.snippet).toBeUndefined();
    expect(noSnippet.results[0]!.summary.parentId).toBeUndefined();
  });

  it('conversationList round-trips an optional limit and a capped listing with total', () => {
    // Empty request is valid — the IDE lists everything by default.
    expect(ConversationListRequestSchema.parse({}).limit).toBeUndefined();
    expect(ConversationListRequestSchema.parse({ limit: 25 }).limit).toBe(25);
    // A non-positive / non-integer limit is rejected at the boundary.
    expect(() => ConversationListRequestSchema.parse({ limit: 0 })).toThrow();

    const res = ConversationListResponseSchema.parse({
      conversations: [
        {
          id: 'c2',
          title: 'Billing',
          messageCount: 2,
          checkpointCount: 0,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
      total: 7,
    });
    expect(res.conversations).toHaveLength(1);
    // total > listed length is the "showing N of M" signal (council split Q3).
    expect(res.total).toBe(7);
    expect(res.conversations[0]!.parentId).toBeUndefined();
  });

  it('commandList round-trips an optional query + limit and a ranked listing with total', () => {
    // Both fields optional — an empty request lists every command.
    expect(CommandListRequestSchema.parse({}).query).toBeUndefined();
    expect(CommandListRequestSchema.parse({ query: 'comm', limit: 10 }).limit).toBe(10);
    // A non-positive / non-integer limit is rejected at the boundary.
    expect(() => CommandListRequestSchema.parse({ limit: 0 })).toThrow();

    const res = CommandListResponseSchema.parse({
      commands: [
        {
          name: 'commit',
          description: 'Create a commit',
          path: '/repo/.augment/commands/commit.md',
        },
      ],
      total: 3,
    });
    expect(res.commands).toHaveLength(1);
    // total > listed length is the "showing N of M" signal (mirrors conversationList).
    expect(res.total).toBe(3);
  });

  it('commandRead round-trips a body with a source enum and rejects an unknown source', () => {
    const req = CommandReadRequestSchema.parse({ name: 'commit' });
    expect(req.name).toBe('commit');

    const local = CommandReadResponseSchema.parse({
      name: 'commit',
      source: 'local',
      body: '# Commit',
    });
    expect(local.source).toBe('local');
    const missing = CommandReadResponseSchema.parse({ name: 'nope', source: 'missing', body: '' });
    expect(missing.body).toBe('');
    expect(() =>
      CommandReadResponseSchema.parse({ name: 'x', source: 'disk', body: '' }),
    ).toThrow();
  });

  it('configRead keys on {kind,name}, round-trips a local body, and rejects mcp/unknown source', () => {
    const req = ConfigReadRequestSchema.parse({ kind: 'skill', name: 'laravel' });
    expect(req.kind).toBe('skill');
    expect(req.name).toBe('laravel');
    // kind is required — name alone is not unique across kinds.
    expect(() => ConfigReadRequestSchema.parse({ name: 'laravel' })).toThrow();

    const local = ConfigReadResponseSchema.parse({
      kind: 'skill',
      name: 'laravel',
      source: 'local',
      body: '# Laravel',
    });
    expect(local.source).toBe('local');
    const missing = ConfigReadResponseSchema.parse({
      kind: 'rule',
      name: 'nope',
      source: 'missing',
      body: '',
    });
    expect(missing.body).toBe('');
    // Local-only: no `mcp` member (unlike CommandSource), and unknown rejects.
    expect(() =>
      ConfigReadResponseSchema.parse({ kind: 'skill', name: 'x', source: 'mcp', body: '' }),
    ).toThrow();
  });

  it('costReport request/response round-trip the aggregate shape', () => {
    const req = CostReportRequestSchema.parse({ since: '2026-06-01T00:00:00.000Z' });
    expect(req.since).toBe('2026-06-01T00:00:00.000Z');
    const res = CostReportResponseSchema.parse({
      totalUsd: 1.25,
      stepCount: 3,
      byActivity: { chat: 0.5, agent: 0.75 },
      byMode: { api: 1.0, cli: 0.25 },
      byModel: { 'claude-sonnet-4-6': 1.25 },
      shadowApiUsd: 0.25,
      cliStepCount: 1,
    });
    expect(res.totalUsd).toBe(1.25);
    expect(res.byMode.cli).toBe(0.25);
    expect(res.shadowApiUsd).toBe(0.25);
  });

  it('agentTurn request/response round-trip the wire shapes', () => {
    const req = AgentTurnRequestSchema.parse({
      conversationId: 'c1',
      message: 'edit the file',
      maxIterations: 5,
    });
    expect(req.maxIterations).toBe(5);
    const res = AgentTurnResponseSchema.parse({
      messageId: 'm1',
      text: 'done',
      usage: { inputTokens: 10, outputTokens: 4 },
      cost: { model: 'claude', mode: 'api', totalUsd: 0.01, isEstimate: false },
      changedFiles: ['a.ts', 'b.ts'],
      iterations: 2,
      cancelled: false,
      stopReason: 'end_turn',
      mode: 'edit',
    });
    expect(res.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(res.iterations).toBe(2);
    expect(res.mode).toBe('edit');
    const ev = AgentToolEventSchema.parse({
      toolEvent: { kind: 'started', id: 't1', name: 'write_files', argsPreview: '{}' },
    });
    expect(ev.toolEvent.kind).toBe('started');
  });

  it('carries a mixed annotations union (context-snippet + code-suggestion)', () => {
    const res = AgentTurnResponseSchema.parse({
      messageId: 'm1',
      text: 'done',
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: { model: 'claude', mode: 'api', totalUsd: 0, isEstimate: false },
      changedFiles: ['a.ts'],
      iterations: 1,
      cancelled: false,
      stopReason: 'end_turn',
      mode: 'edit',
      annotations: [
        {
          kind: 'context-snippet',
          rootId: 'A',
          filePath: 'src/auth.ts',
          startLine: 0,
          endLine: 2,
          relevance: 0.5,
          category: 'source',
          preview: 'x',
        },
        {
          kind: 'code-suggestion',
          suggestionId: 'call0-edit-0',
          filePath: 'a.ts',
          state: 'done',
          diffPreview: '@@ -1 +1 @@\n-a\n+b',
        },
      ],
    });
    // Both members ride the one `kind`-tagged array on the agent turn.
    expect(res.annotations?.map((a) => a.kind)).toEqual(['context-snippet', 'code-suggestion']);
  });
});

describe('tool-call lifecycle union (product-readiness Phase 1)', () => {
  it('discriminates every kind on `kind`', () => {
    const started = ToolCallEventSchema.parse({
      kind: 'started',
      id: 't1',
      name: 'run_command',
      argsPreview: 'npm test',
    });
    expect(started.kind).toBe('started');

    const resolved = ToolCallEventSchema.parse({
      kind: 'approvalResolved',
      id: 't1',
      decision: 'allow_once',
    });
    expect(resolved.kind === 'approvalResolved' && resolved.decision).toBe('allow_once');

    const result = ToolCallEventSchema.parse({
      kind: 'result',
      id: 't1',
      ok: true,
      outputPreview: 'ok',
    });
    expect(result.kind === 'result' && result.ok).toBe(true);

    expect(() => ToolCallEventSchema.parse({ kind: 'bogus', id: 't1' })).toThrow();
  });

  it('approvalRequested carries the gate level and an optional diff review', () => {
    const bare = ToolCallEventSchema.parse({
      kind: 'approvalRequested',
      id: 't2',
      level: 'requires_approval',
      riskLevel: 'high',
    });
    expect(bare.kind === 'approvalRequested' && bare.review).toBeUndefined();
    expect(bare.kind === 'approvalRequested' && bare.riskLevel).toBe('high');

    const withDiff = ToolCallEventSchema.parse({
      kind: 'approvalRequested',
      id: 't3',
      level: 'requires_diff_approval',
      riskLevel: 'medium',
      riskReason: 'writes 2 files',
      review: {
        kind: 'diff',
        files: [{ path: 'src/a.ts', diff: '@@ -1 +1 @@', isNewFile: false }],
      },
    });
    expect(withDiff.kind === 'approvalRequested' && withDiff.review?.files).toHaveLength(1);
    expect(withDiff.kind === 'approvalRequested' && withDiff.riskLevel).toBe('medium');
  });

  it('rejects an unknown approval level, risk level, and decision', () => {
    expect(() =>
      ToolCallEventSchema.parse({
        kind: 'approvalRequested',
        id: 't4',
        level: 'auto',
        riskLevel: 'high',
      }),
    ).toThrow();
    expect(() =>
      ToolCallEventSchema.parse({
        kind: 'approvalRequested',
        id: 't4',
        level: 'requires_approval',
        riskLevel: 'critical',
      }),
    ).toThrow();
    // riskLevel is required — an approvalRequested without it is rejected.
    expect(() =>
      ToolCallEventSchema.parse({
        kind: 'approvalRequested',
        id: 't4',
        level: 'requires_approval',
      }),
    ).toThrow();
    expect(() =>
      ToolCallEventSchema.parse({ kind: 'approvalResolved', id: 't4', decision: 'maybe' }),
    ).toThrow();
  });

  it('ToolReview is a diff payload of per-file diffs', () => {
    const review = ToolReviewSchema.parse({
      kind: 'diff',
      files: [
        { path: 'a.ts', diff: 'd1', isNewFile: true },
        { path: 'b.ts', diff: 'd2', isNewFile: false },
      ],
    });
    expect(review.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('chat cost & budget wire schemas (T-PRD06)', () => {
  it('parses a pre-send estimate event', () => {
    const event = ChatEstimateEventSchema.parse({
      estimate: { model: 'm', inputTokens: 1000, lowerUsd: 0.01, upperUsd: 0.12, typicalUsd: 0.04 },
    });
    expect(event.estimate.inputTokens).toBe(1000);
  });

  it('accepts a budget status with null limit fields (no budget configured)', () => {
    const status = ChatBudgetStatusSchema.parse({
      date: '2026-06-01',
      spentUsd: 0.5,
      limitUsd: null,
      remainingUsd: null,
      ratio: null,
      overBudget: false,
      warning: false,
    });
    expect(status.limitUsd).toBeNull();
  });

  it('ChatSendResponse keeps budget optional (older clients parse unchanged)', () => {
    const withoutBudget = ChatSendResponseSchema.parse({
      messageId: 'm1',
      text: 'hi',
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: { model: 'm', mode: 'api', totalUsd: 0, isEstimate: false },
      cancelled: false,
      stopReason: 'end_turn',
    });
    expect(withoutBudget.budget).toBeUndefined();

    const withBudget = ChatSendResponseSchema.parse({
      ...withoutBudget,
      budget: {
        date: '2026-06-01',
        spentUsd: 1,
        limitUsd: 10,
        remainingUsd: 9,
        ratio: 0.1,
        overBudget: false,
        warning: false,
      },
    });
    expect(withBudget.budget?.remainingUsd).toBe(9);
  });
});

describe('cost-cap verdict wire schema (T-411a, ADR-041)', () => {
  it('parses a minimal block verdict (single_step)', () => {
    const cap = CapVerdictSchema.parse({
      verdict: 'block',
      reason: 'single_step.hard_block_above_usd',
      projectedUsd: 3.03,
    });
    expect(cap.verdict).toBe('block');
    expect(cap.spentTodayUsd).toBeUndefined();
  });

  it('carries spentTodayUsd when a daily cap fired', () => {
    const cap = CapVerdictSchema.parse({
      verdict: 'confirm',
      reason: 'daily.confirm_above_usd',
      projectedUsd: 0.5,
      spentTodayUsd: 4.2,
    });
    expect(cap.spentTodayUsd).toBe(4.2);
  });

  it('rejects an unknown verdict (strict enum — no silent allow)', () => {
    expect(() => CapVerdictSchema.parse({ verdict: 'maybe', projectedUsd: 1 })).toThrow();
  });

  it('rides the pre-send estimate event for warn/confirm (additive optional)', () => {
    const base = {
      estimate: { model: 'm', inputTokens: 1000, lowerUsd: 0.01, upperUsd: 0.12, typicalUsd: 0.04 },
    };
    expect(ChatEstimateEventSchema.parse(base).cap).toBeUndefined();
    const withCap = ChatEstimateEventSchema.parse({
      ...base,
      cap: { verdict: 'warn', reason: 'single_step.warn_above_usd', projectedUsd: 3.03 },
    });
    expect(withCap.cap?.verdict).toBe('warn');
  });

  it('ChatSendResponse + AgentTurnResponse keep cap optional (older clients unchanged)', () => {
    const chat = ChatSendResponseSchema.parse({
      messageId: 'm1',
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: { model: 'm', mode: 'api', totalUsd: 0, isEstimate: true },
      cancelled: false,
      stopReason: 'cost_cap_blocked',
      cap: { verdict: 'block', reason: 'single_step.hard_block_above_usd', projectedUsd: 3.03 },
    });
    expect(chat.cap?.verdict).toBe('block');

    const agent = AgentTurnResponseSchema.parse({
      messageId: 'm1',
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: { model: 'm', mode: 'api', totalUsd: 0, isEstimate: true },
      changedFiles: [],
      iterations: 0,
      cancelled: false,
      stopReason: 'cost_cap_blocked',
      mode: 'edit',
    });
    expect(agent.cap).toBeUndefined(); // omitted parses fine
  });
});

describe('gitReviewApplyFix schemas (T-CR-404)', () => {
  it('a review finding carries the optional fix anchors + a required fixable flag', () => {
    const fixable = GitReviewFindingSchema.parse({
      file: 'src/foo.ts',
      line: 2,
      severity: 'high',
      category: 'bug',
      description: 'off-by-one',
      quotedSpan: 'i <= n',
      proposedFix: 'i < n',
      fixable: true,
    });
    expect(fixable.fixable).toBe(true);
    expect(fixable.proposedFix).toBe('i < n');

    // quotedSpan/proposedFix are optional; fixable is required.
    const bare = GitReviewFindingSchema.parse({
      file: 'src/foo.ts',
      line: null,
      severity: 'low',
      category: 'style',
      description: 'no fix proposed',
      fixable: false,
    });
    expect(bare.quotedSpan).toBeUndefined();
    expect(() =>
      GitReviewFindingSchema.parse({
        file: 'src/foo.ts',
        line: null,
        severity: 'low',
        category: 'style',
        description: 'missing fixable',
      }),
    ).toThrow();
  });

  it('the request requires a non-empty span; the response carries a diff review or a reason', () => {
    const req = GitReviewApplyFixRequestSchema.parse({
      cwd: '/repo',
      file: 'src/foo.ts',
      quotedSpan: 'i <= n',
      proposedFix: 'i < n',
    });
    expect(req.file).toBe('src/foo.ts');
    expect(() =>
      GitReviewApplyFixRequestSchema.parse({
        cwd: '/repo',
        file: 'src/foo.ts',
        quotedSpan: '',
        proposedFix: 'x',
      }),
    ).toThrow();

    const applied = GitReviewApplyFixResponseSchema.parse({
      applicable: true,
      review: {
        kind: 'diff',
        files: [{ path: 'src/foo.ts', diff: '@@ -1 +1 @@', isNewFile: false }],
      },
    });
    expect(applied.review?.files[0]?.path).toBe('src/foo.ts');

    const notApplicable = GitReviewApplyFixResponseSchema.parse({
      applicable: false,
      reason: 'span_drift',
    });
    expect(notApplicable.review).toBeUndefined();
    expect(notApplicable.reason).toBe('span_drift');
  });
});
