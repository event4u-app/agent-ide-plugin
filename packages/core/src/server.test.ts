import { describe, expect, it } from 'vitest';
import type { Envelope, LlmStreamEvent } from '@event4u-agent/protocol';
import { NdjsonParser, encodeEnvelope } from '@event4u-agent/shared';
import { Dispatcher } from './server.js';
import { WorkspaceCoordinator, type RootWalker } from './context/workspace-coordinator.js';
import type { RootRegistry } from './context/roots.js';
import type { LlmBackend } from './llm/backend.js';
import type { GitRunner } from './commands/commit.js';
import { GitHandler } from './git/handler.js';

const request = (messageType: string, data: unknown, messageId = 'r1'): Envelope => ({
  messageId,
  messageType,
  data,
  done: true,
});

describe('Dispatcher', () => {
  const dispatcher = new Dispatcher();

  it('answers ping with pong, preserving messageId', async () => {
    const res = await dispatcher.dispatch(request('ping', {}, 'p42'));
    expect(res.messageId).toBe('p42');
    expect(res.messageType).toBe('ping');
    expect(res.data).toEqual({ result: 'pong' });
    expect(res.done).toBe(true);
  });

  it('echoes the request text', async () => {
    const res = await dispatcher.dispatch(request('echo', { text: 'hi there' }));
    expect(res.data).toEqual({ text: 'hi there' });
  });

  it('returns an error envelope for an unknown method', async () => {
    const res = await dispatcher.dispatch(request('frobnicate', {}));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'unknown_method' });
  });

  it('returns an error envelope when echo payload is invalid', async () => {
    const res = await dispatcher.dispatch(request('echo', { text: 123 }));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'handler_error' });
  });
});

describe('Dispatcher — multi-project methods (T-MR11)', () => {
  function makeDispatcher(): { dispatcher: Dispatcher; coordinator: WorkspaceCoordinator } {
    const coordinator = new WorkspaceCoordinator({
      debounceMs: 0,
      readFile: async () => 'export const x = 1;\n',
      walkerFactory: (registry: RootRegistry): RootWalker => ({
        async walk() {
          return registry.walkable().map((r) => ({ rootId: r.stableId, path: 'src/index.ts' }));
        },
      }),
    });
    return { dispatcher: new Dispatcher(coordinator), coordinator };
  }

  const wsFolder = (stableId: string) => ({
    uri: `/repo/${stableId}`,
    stableId,
    displayName: stableId,
    kind: 'folder',
  });

  it('connect acks with resolved roots and per-root status', async () => {
    const { dispatcher } = makeDispatcher();
    const res = await dispatcher.dispatch(
      request('connect', { workspaceFolders: [wsFolder('A'), wsFolder('B')] }, 'c1'),
    );
    expect(res.messageId).toBe('c1');
    expect(res.data).toMatchObject({ ack: true });
    const data = res.data as { roots: unknown[]; status: { stableId: string }[] };
    expect(data.roots).toHaveLength(2);
    expect(data.status.map((s) => s.stableId).sort()).toEqual(['A', 'B']);
  });

  it('rootStatus reports ready once indexing settles', async () => {
    const { dispatcher, coordinator } = makeDispatcher();
    await dispatcher.dispatch(request('connect', { workspaceFolders: [wsFolder('A')] }, 'c2'));
    await coordinator.whenIdle();

    const res = await dispatcher.dispatch(request('rootStatus', {}, 's1'));
    const data = res.data as { status: { stableId: string; state: string; fileCount: number }[] };
    expect(data.status).toEqual([
      { stableId: 'A', state: 'ready', fileCount: 1, totalFiles: 1, message: null },
    ]);
  });

  it('workspaceFoldersChanged acks a removal delta', async () => {
    const { dispatcher } = makeDispatcher();
    await dispatcher.dispatch(
      request('connect', { workspaceFolders: [wsFolder('A'), wsFolder('B')] }),
    );
    const res = await dispatcher.dispatch(
      request('workspaceFoldersChanged', { removed: ['B'] }, 'd1'),
    );
    expect(res.data).toMatchObject({ ack: true });
    const data = res.data as { status: { stableId: string }[] };
    expect(data.status.map((s) => s.stableId)).toEqual(['A']);
  });

  it('connect defaults an omitted folder list to the empty single-root fallback', async () => {
    const { dispatcher } = makeDispatcher();
    const res = await dispatcher.dispatch(request('connect', {}, 'c3'));
    expect(res.data).toMatchObject({ ack: true, roots: [], status: [] });
  });
});

describe('full wire round-trip (encode -> parse -> dispatch)', () => {
  it('processes a serialized request through the parser', async () => {
    const dispatcher = new Dispatcher();
    const parsed: Envelope[] = [];
    const parser = new NdjsonParser((e) => parsed.push(e));

    parser.push(encodeEnvelope(request('echo', { text: 'wire' }, 'w1')));
    expect(parsed).toHaveLength(1);

    const res = await dispatcher.dispatch(parsed[0]!);
    expect(res.messageId).toBe('w1');
    expect(res.data).toEqual({ text: 'wire' });
  });
});

describe('Dispatcher — git-loop methods (product-readiness Phase 4 transport)', () => {
  const DIFF = `diff --git a/x.ts b/x.ts
index 1..2 100644
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

  function gitDispatcher(reply: string): Dispatcher {
    const backend: LlmBackend = {
      id: 'fake',
      mode: 'api',
      async *stream(): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: reply };
        yield { kind: 'stop', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    const runner: GitRunner = {
      run: () => Promise.resolve({ stdout: DIFF, stderr: '', exitCode: 0 }),
    };
    const git = new GitHandler({
      resolveBackend: () => backend,
      resolveModel: () => 'claude-sonnet-4-6',
      defaultCwd: '/repo',
      runner,
    });
    return new Dispatcher(new WorkspaceCoordinator(), undefined, git);
  }

  it('routes gitCommitMessage to the handler and returns the parsed result', async () => {
    const dispatcher = gitDispatcher('feat(git): expose the loop');
    const res = await dispatcher.dispatch(request('gitCommitMessage', { cwd: '/repo' }, 'g1'));
    expect(res.messageType).toBe('gitCommitMessage');
    expect(res.messageId).toBe('g1');
    expect(res.data).toMatchObject({ ok: true, text: 'feat(git): expose the loop' });
  });

  it('returns git_not_configured when no git handler is wired', async () => {
    const dispatcher = new Dispatcher();
    const res = await dispatcher.dispatch(request('gitCommitMessage', { cwd: '/repo' }));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'git_not_configured' });
  });
});

describe('Dispatcher — onboardingDetect (T-PRD12 first-run readiness)', () => {
  type Probes = {
    nodeVersion: () => string | null;
    env: (name: string) => string | undefined;
    commandExists: (command: string) => boolean;
  };
  const dispatcherWith = (probes: Probes): Dispatcher =>
    new Dispatcher(new WorkspaceCoordinator(), undefined, undefined, undefined, undefined, probes);
  const detect = async (probes: Probes) =>
    (await dispatcherWith(probes).dispatch(request('onboardingDetect', {}, 'o1'))).data as {
      node: { version: string | null; major: number | null; ok: boolean };
      anthropicKey: boolean;
      claudeCli: boolean;
      recommendedMode: string;
      ready: boolean;
      blockers: string[];
    };

  it('reports ready=api when Node is new enough and a key is present', async () => {
    const data = await detect({
      nodeVersion: () => '20.11.1',
      env: (name) => (name === 'ANTHROPIC_API_KEY' ? 'sk-secret-value' : undefined),
      commandExists: () => false,
    });
    expect(data).toMatchObject({
      anthropicKey: true,
      recommendedMode: 'api',
      ready: true,
      blockers: [],
    });
    expect(data.node.ok).toBe(true);
  });

  it('falls back to keyless CLI mode when only the claude CLI is present', async () => {
    const data = await detect({
      nodeVersion: () => 'v22.0.0',
      env: () => undefined,
      commandExists: (command) => command === 'claude',
    });
    expect(data).toMatchObject({
      anthropicKey: false,
      claudeCli: true,
      recommendedMode: 'cli',
      ready: true,
    });
  });

  it('is not ready and lists blockers when Node is too old and no provider exists', async () => {
    const data = await detect({
      nodeVersion: () => '18.19.0',
      env: () => undefined,
      commandExists: () => false,
    });
    expect(data.ready).toBe(false);
    expect(data.recommendedMode).toBe('none');
    expect(data.blockers.length).toBe(2);
    expect(data.node).toMatchObject({ major: 18, ok: false });
  });

  it('never serializes the raw key value — only the anthropicKey boolean', async () => {
    const data = await detect({
      nodeVersion: () => '20.0.0',
      env: (name) => (name === 'ANTHROPIC_API_KEY' ? 'sk-DO-NOT-LEAK' : undefined),
      commandExists: () => false,
    });
    expect(JSON.stringify(data)).not.toContain('sk-DO-NOT-LEAK');
    expect(data.anthropicKey).toBe(true);
  });
});
