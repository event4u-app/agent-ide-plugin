import { describe, expect, it } from 'vitest';
import {
  ChatCostSchema,
  ChatSendRequestSchema,
  ChatSendResponseSchema,
  ChatTokenEventSchema,
  ConnectRequestSchema,
  ContextScopeSchema,
  EchoRequestSchema,
  EchoResponseSchema,
  EnvelopeSchema,
  MethodNameSchema,
  Methods,
  PingResponseSchema,
  RootIndexStatusSchema,
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
      'chatCancel',
      'chatSend',
      'connect',
      'echo',
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

  it('does NOT register a tool-call method yet (transport deferred this slice)', () => {
    expect(Object.keys(Methods)).not.toContain('agentTurn');
    expect(Object.keys(Methods)).not.toContain('toolCall');
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
    });
    expect(bare.kind === 'approvalRequested' && bare.review).toBeUndefined();

    const withDiff = ToolCallEventSchema.parse({
      kind: 'approvalRequested',
      id: 't3',
      level: 'requires_diff_approval',
      riskReason: 'writes 2 files',
      review: {
        kind: 'diff',
        files: [{ path: 'src/a.ts', diff: '@@ -1 +1 @@', isNewFile: false }],
      },
    });
    expect(withDiff.kind === 'approvalRequested' && withDiff.review?.files).toHaveLength(1);
  });

  it('rejects an unknown approval level and decision', () => {
    expect(() =>
      ToolCallEventSchema.parse({ kind: 'approvalRequested', id: 't4', level: 'auto' }),
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
