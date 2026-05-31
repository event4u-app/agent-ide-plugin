import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ConversationStore,
  type ConversationStoreDeps,
  FileConversationStore,
  InMemoryConversationStore,
} from './store.js';

/** Deterministic clock + id factory so persisted facts are reproducible. */
function deterministicDeps(): ConversationStoreDeps {
  let tick = 0;
  let id = 0;
  const base = Date.parse('2026-01-01T00:00:00Z');
  return {
    now: () => new Date(base + tick++ * 1000).toISOString(),
    idFactory: () => `id-${++id}`,
  };
}

describe('InMemoryConversationStore basics', () => {
  it('creates, appends, and loads a conversation', async () => {
    const store = new InMemoryConversationStore(deterministicDeps());
    const conv = await store.create({ title: 'My chat' });
    expect(conv.id).toBe('id-1');

    await store.appendMessage(conv.id, { role: 'user', content: 'hello' });
    await store.appendMessage(conv.id, { role: 'assistant', content: 'hi there' });

    const loaded = await store.load(conv.id);
    expect(loaded?.messages.map((m) => m.content)).toEqual(['hello', 'hi there']);
    expect(loaded?.messages[0]?.turnIndex).toBe(0);
  });

  it('returns undefined when appending to a missing conversation', async () => {
    const store = new InMemoryConversationStore(deterministicDeps());
    expect(await store.appendMessage('nope', { role: 'user', content: 'x' })).toBeUndefined();
  });
});

/** Shared behavioural contract run against both store implementations. */
function contract(
  makeStore: (deps: ConversationStoreDeps) => Promise<ConversationStore> | ConversationStore,
) {
  it('records a checkpoint with the current turn count', async () => {
    const store = await makeStore(deterministicDeps());
    const conv = await store.create();
    await store.appendMessage(conv.id, { role: 'user', content: 'do X' });
    await store.appendMessage(conv.id, { role: 'assistant', content: 'doing X' });

    const cp = await store.recordCheckpoint(conv.id, {
      phase: 'implement',
      changedFiles: ['a.ts', 'b.ts'],
      workState: { phase: 'implement' },
    });
    expect(cp?.turnIndex).toBe(2);

    const loaded = await store.load(conv.id);
    expect(loaded?.checkpoints).toHaveLength(1);
    expect(loaded?.checkpoints[0]?.changedFiles).toEqual(['a.ts', 'b.ts']);
  });

  it('forks copy-on-write at a turn index, leaving the parent untouched', async () => {
    const store = await makeStore(deterministicDeps());
    const conv = await store.create({ title: 'parent' });
    await store.appendMessage(conv.id, { role: 'user', content: 'q1' });
    await store.appendMessage(conv.id, { role: 'assistant', content: 'a1' });
    await store.appendMessage(conv.id, { role: 'user', content: 'q2' });

    const fork = await store.fork(conv.id, 1, { editedUserMessage: 'q1-edited' });
    expect(fork?.parentId).toBe(conv.id);
    expect(fork?.forkedFromTurnIndex).toBe(1);
    expect(fork?.messages.map((m) => m.content)).toEqual(['q1', 'q1-edited']);

    // Parent is unchanged (copy-on-write, not a move).
    const parent = await store.load(conv.id);
    expect(parent?.messages.map((m) => m.content)).toEqual(['q1', 'a1', 'q2']);
  });

  it('clamps a fork turn index to the available prefix', async () => {
    const store = await makeStore(deterministicDeps());
    const conv = await store.create();
    await store.appendMessage(conv.id, { role: 'user', content: 'only' });
    const fork = await store.fork(conv.id, 99);
    expect(fork?.forkedFromTurnIndex).toBe(1);
    expect(fork?.messages.map((m) => m.content)).toEqual(['only']);
  });

  it('returns undefined when forking a missing conversation', async () => {
    const store = await makeStore(deterministicDeps());
    expect(await store.fork('ghost', 0)).toBeUndefined();
  });

  it('lists conversations newest-updated first', async () => {
    const store = await makeStore(deterministicDeps());
    const a = await store.create({ title: 'A' });
    const b = await store.create({ title: 'B' });
    await store.appendMessage(a.id, { role: 'user', content: 'later touch on A' });

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(list[0]?.messageCount).toBe(1);
    expect(list.find((s) => s.id === b.id)?.messageCount).toBe(0);
  });

  it('searches across titles and bodies with token-AND matching', async () => {
    const store = await makeStore(deterministicDeps());
    const a = await store.create({ title: 'Login flow' });
    await store.appendMessage(a.id, {
      role: 'user',
      content: 'the login button is broken on mobile',
    });
    const b = await store.create({ title: 'Billing' });
    await store.appendMessage(b.id, { role: 'user', content: 'invoice totals are wrong' });

    const hits = await store.search('login mobile');
    expect(hits.map((h) => h.summary.id)).toEqual([a.id]);
    expect(hits[0]?.snippet).toContain('login');

    expect(await store.search('login billing')).toHaveLength(0); // no single conv has both
    expect(await store.search('')).toHaveLength(0);
  });
}

describe('InMemoryConversationStore (contract)', () => {
  contract((deps) => new InMemoryConversationStore(deps));
});

describe('FileConversationStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-chat-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  contract((deps) => new FileConversationStore(join(dir, 'chats'), deps));

  it('persists an append-only JSONL log per conversation', async () => {
    const store = new FileConversationStore(join(dir, 'chats'), deterministicDeps());
    const conv = await store.create({ title: 'persisted' });
    await store.appendMessage(conv.id, { role: 'user', content: 'line one' });

    const raw = await readFile(join(dir, 'chats', `${conv.id}.jsonl`), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).type).toBe('created');
    expect(JSON.parse(lines[1]!).type).toBe('message');
  });

  it('survives a torn trailing line on reload (fail-open)', async () => {
    const chats = join(dir, 'chats');
    const store = new FileConversationStore(chats, deterministicDeps());
    const conv = await store.create();
    await store.appendMessage(conv.id, { role: 'user', content: 'intact' });

    // Simulate a crash mid-append: a partial JSON line at EOF.
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(chats, `${conv.id}.jsonl`), '{"type":"message","v":1,"at":"z"', 'utf8');

    const loaded = await store.load(conv.id);
    expect(loaded?.messages.map((m) => m.content)).toEqual(['intact']);
  });

  it('returns an empty list when the chats dir does not exist yet', async () => {
    const store = new FileConversationStore(join(dir, 'missing'), deterministicDeps());
    expect(await store.list()).toEqual([]);
    expect(await store.load('whatever')).toBeUndefined();
  });
});
