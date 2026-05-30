import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionLocations } from './locations.js';
import {
  ChokidarSessionWatcher,
  FakeSessionWatcher,
  type SessionWatchEvent,
  resolveSource,
  watchTargets,
} from './watcher.js';

const LOCATIONS: SessionLocations = {
  apiChatsDir: '/home/u/.event4u-agent/chats',
  claudeProjectsDir: '/home/u/.claude/projects',
  codexSessionsDir: '/home/u/.codex/sessions',
  geminiSessionsDir: '/home/u/.gemini/sessions',
  aiderHistoryFile: '/repo/.aider.chat.history.md',
};

describe('resolveSource', () => {
  it('maps a path under each root to its source', () => {
    expect(resolveSource('/home/u/.claude/projects/p/s.jsonl', LOCATIONS)).toBe('claude-cli');
    expect(resolveSource('/home/u/.codex/sessions/a/b.jsonl', LOCATIONS)).toBe('codex-cli');
    expect(resolveSource('/home/u/.gemini/sessions/x', LOCATIONS)).toBe('gemini-cli');
    expect(resolveSource('/home/u/.event4u-agent/chats/c.json', LOCATIONS)).toBe('api');
  });
  it('matches the aider file exactly', () => {
    expect(resolveSource('/repo/.aider.chat.history.md', LOCATIONS)).toBe('aider');
  });
  it('returns undefined for unrelated paths', () => {
    expect(resolveSource('/tmp/elsewhere/file.jsonl', LOCATIONS)).toBeUndefined();
  });
});

describe('watchTargets', () => {
  it('returns configured targets and skips unset ones', () => {
    expect(watchTargets({ claudeProjectsDir: '/a', aiderHistoryFile: '/b' })).toEqual(['/a', '/b']);
    expect(watchTargets({})).toEqual([]);
  });
});

describe('FakeSessionWatcher', () => {
  it('drives listeners synchronously with resolved source', async () => {
    const events: SessionWatchEvent[] = [];
    const watcher = new FakeSessionWatcher(LOCATIONS);
    await watcher.start((e) => events.push(e));
    watcher.emit('created', '/home/u/.codex/sessions/new.jsonl');
    expect(events).toEqual([
      { kind: 'created', path: '/home/u/.codex/sessions/new.jsonl', source: 'codex-cli' },
    ]);
  });
  it('stops emitting after close', async () => {
    const events: SessionWatchEvent[] = [];
    const watcher = new FakeSessionWatcher(LOCATIONS);
    await watcher.start((e) => events.push(e));
    await watcher.close();
    watcher.emit('changed', '/home/u/.claude/projects/p/s.jsonl');
    expect(events).toEqual([]);
  });
});

describe('ChokidarSessionWatcher (integration)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-watch-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits a debounced event with a resolved source when a session file appears', async () => {
    const locations: SessionLocations = { claudeProjectsDir: dir };
    const watcher = new ChokidarSessionWatcher(locations, { debounceMs: 20 });
    const received = new Promise<SessionWatchEvent>((resolve) => {
      void watcher.start((e) => resolve(e));
    });
    // Give chokidar a tick to attach before writing.
    await new Promise((r) => setTimeout(r, 150));
    await writeFile(join(dir, 'fresh.jsonl'), '{}');
    const event = await received;
    expect(event.kind).toBe('created');
    expect(event.source).toBe('claude-cli');
    await watcher.close();
  });
});
