import { describe, expect, it } from 'vitest';
import {
  ConnectRequestSchema,
  ContextScopeSchema,
  EchoRequestSchema,
  EchoResponseSchema,
  EnvelopeSchema,
  MethodNameSchema,
  Methods,
  PingResponseSchema,
  RootIndexStatusSchema,
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

describe('method registry', () => {
  it('exposes the multi-project + terminal methods alongside ping/echo', () => {
    expect(Object.keys(Methods).sort()).toEqual([
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
});
