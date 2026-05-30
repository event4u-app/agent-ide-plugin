import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVE_WINDOW_MS,
  SessionBrowser,
  createSessionBrowserFromLocations,
  filterSessions,
  groupSessionsByRecency,
  markActiveSessions,
} from './aggregator.js';
import type { SessionAdapter, SessionScanResult, SessionSummary } from './types.js';

function summary(
  over: Partial<SessionSummary> & Pick<SessionSummary, 'id' | 'source'>,
): SessionSummary {
  return {
    origin: 'unknown',
    provider: 'p',
    title: 't',
    startedAt: 1,
    lastMessageAt: 1,
    messageCount: 1,
    status: 'completed',
    ...over,
  };
}

function stubAdapter(source: SessionAdapter['source'], result: SessionScanResult): SessionAdapter {
  return { source, listSummaries: async () => result, loadMessages: async () => [] };
}

describe('SessionBrowser', () => {
  it('merges sources and sorts by lastMessageAt desc', async () => {
    const browser = new SessionBrowser([
      stubAdapter('api', {
        summaries: [summary({ id: 'api:a', source: 'api', lastMessageAt: 100 })],
        diagnostics: [],
      }),
      stubAdapter('claude-cli', {
        summaries: [summary({ id: 'claude-cli:b', source: 'claude-cli', lastMessageAt: 300 })],
        diagnostics: [
          { source: 'claude-cli', severity: 'info', code: 'partial_parse', message: 'x' },
        ],
      }),
    ]);
    const { summaries, diagnostics } = await browser.listSummaries();
    expect(summaries.map((s) => s.id)).toEqual(['claude-cli:b', 'api:a']);
    expect(diagnostics).toHaveLength(1);
  });

  it('is fail-open: a throwing adapter becomes a diagnostic', async () => {
    const throwing: SessionAdapter = {
      source: 'gemini-cli',
      listSummaries: async () => {
        throw new Error('boom');
      },
      loadMessages: async () => [],
    };
    const browser = new SessionBrowser([
      throwing,
      stubAdapter('api', { summaries: [summary({ id: 'api:a', source: 'api' })], diagnostics: [] }),
    ]);
    const { summaries, diagnostics } = await browser.listSummaries();
    expect(summaries.map((s) => s.id)).toEqual(['api:a']);
    expect(diagnostics.some((d) => d.source === 'gemini-cli' && d.message.includes('boom'))).toBe(
      true,
    );
  });

  it('routes loadMessages to the matching adapter', async () => {
    const adapter: SessionAdapter = {
      source: 'api',
      listSummaries: async () => ({ summaries: [], diagnostics: [] }),
      loadMessages: async () => [{ role: 'user', content: 'hi' }],
    };
    const browser = new SessionBrowser([adapter]);
    expect(await browser.loadMessages({ source: 'api', id: 'api:x' })).toEqual([
      { role: 'user', content: 'hi' },
    ]);
    expect(await browser.loadMessages({ source: 'aider', id: 'aider:y' })).toEqual([]);
  });
});

describe('createSessionBrowserFromLocations (end-to-end)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-browser-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('wires adapters + provenance over real fixture dirs', async () => {
    const chats = join(dir, 'chats');
    const claude = join(dir, 'claude', 'proj', 'sessions');
    await mkdir(chats, { recursive: true });
    await mkdir(claude, { recursive: true });
    await writeFile(
      join(chats, 'c1.json'),
      JSON.stringify({
        id: 'c1',
        provider: 'anthropic',
        messages: [{ role: 'user', content: 'hey' }],
      }),
    );
    await writeFile(
      join(claude, 's1.jsonl'),
      JSON.stringify({
        type: 'user',
        sessionId: 's1',
        message: { role: 'user', content: 'hello cli' },
      }),
    );
    await writeFile(
      join(dir, 'index.json'),
      JSON.stringify({ sessions: [{ id: 'claude-cli:s1' }] }),
    );

    const browser = createSessionBrowserFromLocations({
      apiChatsDir: chats,
      claudeProjectsDir: join(dir, 'claude'),
      pluginIndexFile: join(dir, 'index.json'),
    });
    const { summaries } = await browser.listSummaries();
    const byId = new Map(summaries.map((s) => [s.id, s]));
    expect(byId.get('api:c1')!.origin).toBe('plugin');
    expect(byId.get('claude-cli:s1')!.origin).toBe('plugin'); // listed in index
  });
});

describe('pure view helpers', () => {
  it('filterSessions by source, provider, origin, query', () => {
    const list = [
      summary({
        id: 'api:a',
        source: 'api',
        provider: 'anthropic',
        origin: 'plugin',
        title: 'auth refactor',
      }),
      summary({
        id: 'codex-cli:b',
        source: 'codex-cli',
        provider: 'openai',
        origin: 'external',
        title: 'fix tests',
        cwd: '/x',
      }),
    ];
    expect(filterSessions(list, { sources: ['api'] }).map((s) => s.id)).toEqual(['api:a']);
    expect(filterSessions(list, { origins: ['external'] }).map((s) => s.id)).toEqual([
      'codex-cli:b',
    ]);
    expect(filterSessions(list, { query: 'AUTH' }).map((s) => s.id)).toEqual(['api:a']);
    expect(filterSessions(list, { providers: ['openai'] }).map((s) => s.id)).toEqual([
      'codex-cli:b',
    ]);
  });

  it('markActiveSessions flips recent sessions to active', () => {
    const now = 1_000_000;
    const list = [
      summary({ id: 'a', source: 'api', lastMessageAt: now - 1000 }),
      summary({ id: 'b', source: 'api', lastMessageAt: now - ACTIVE_WINDOW_MS - 1 }),
    ];
    const marked = markActiveSessions(list, now);
    expect(marked[0]!.status).toBe('active');
    expect(marked[1]!.status).toBe('completed');
  });

  it('groupSessionsByRecency buckets by day boundaries', () => {
    const now = Date.parse('2024-05-30T12:00:00.000Z');
    const day = 24 * 60 * 60 * 1000;
    // Derive the local-midnight boundary the same way the function does, so the
    // test is timezone-robust (CI runners and the dev box differ).
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const todayStart = midnight.getTime();
    const list = [
      summary({ id: 'active', source: 'api', status: 'active', lastMessageAt: now }),
      summary({ id: 'today', source: 'api', lastMessageAt: todayStart + 1000 }),
      summary({ id: 'yest', source: 'api', lastMessageAt: todayStart - 1000 }),
      summary({ id: 'week', source: 'api', lastMessageAt: todayStart - 3 * day }),
      summary({ id: 'old', source: 'api', lastMessageAt: todayStart - 30 * day }),
    ];
    const g = groupSessionsByRecency(list, now);
    expect(g.active.map((s) => s.id)).toEqual(['active']);
    expect(g.today.map((s) => s.id)).toEqual(['today']);
    expect(g.yesterday.map((s) => s.id)).toEqual(['yest']);
    expect(g.lastWeek.map((s) => s.id)).toEqual(['week']);
    expect(g.older.map((s) => s.id)).toEqual(['old']);
  });
});
