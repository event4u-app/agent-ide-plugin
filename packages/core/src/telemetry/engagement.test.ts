import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEngagementRecorder,
  JsonlEngagementRecorder,
  NoOpEngagementRecorder,
  readEngagementEvents,
  EngagementEventSchema,
} from './engagement.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engagement-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

let clock = 0;
const fixedNow = () => `2026-05-31T0${clock++}:00:00.000Z`;

describe('createEngagementRecorder', () => {
  it('returns a no-op recorder when disabled and writes nothing', async () => {
    const rec = createEngagementRecorder({ enabled: false, baseDir: dir });
    expect(rec).toBeInstanceOf(NoOpEngagementRecorder);
    expect(rec.enabled).toBe(false);
    await rec.record({ kind: 'skill', name: 'laravel' });
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('returns a JSONL recorder when enabled', () => {
    const rec = createEngagementRecorder({ enabled: true, baseDir: dir });
    expect(rec).toBeInstanceOf(JsonlEngagementRecorder);
    expect(rec.enabled).toBe(true);
  });
});

describe('JsonlEngagementRecorder', () => {
  it('writes a content-free event to a date-rotated file', async () => {
    const rec = new JsonlEngagementRecorder({
      baseDir: dir,
      now: () => '2026-05-31T12:00:00.000Z',
    });
    await rec.record({ kind: 'command', name: '/commit', outcome: 'succeeded', durationMs: 1200 });
    const files = await readdir(dir);
    expect(files).toEqual(['telemetry-2026-05-31.jsonl']);
    const text = await readFile(join(dir, files[0]), 'utf8');
    const row = JSON.parse(text.trim());
    expect(row).toEqual({
      schema_version: 1,
      ts: '2026-05-31T12:00:00.000Z',
      kind: 'command',
      name: '/commit',
      outcome: 'succeeded',
      duration_ms: 1200,
    });
  });

  it('builds only from allowlisted fields — stray content never reaches disk', async () => {
    const rec = new JsonlEngagementRecorder({
      baseDir: dir,
      now: () => '2026-05-31T12:00:00.000Z',
    });
    // A buggy caller passes a prompt via an extra field. TS would reject it,
    // so we cast — the runtime guarantee is the recorder ignores it entirely.
    await rec.record({ kind: 'skill', name: 'laravel', prompt: 'secret user code' } as never);
    const text = await readFile(join(dir, 'telemetry-2026-05-31.jsonl'), 'utf8');
    expect(text).not.toContain('secret user code');
    expect(text).not.toContain('prompt');
    expect(JSON.parse(text.trim())).toEqual({
      schema_version: 1,
      ts: '2026-05-31T12:00:00.000Z',
      kind: 'skill',
      name: 'laravel',
    });
  });

  it('rotates files by date', async () => {
    let day = 0;
    const rec = new JsonlEngagementRecorder({
      baseDir: dir,
      now: () => `2026-06-0${++day}T08:00:00.000Z`,
    });
    await rec.record({ kind: 'tool', name: 'grep' });
    await rec.record({ kind: 'tool', name: 'read' });
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['telemetry-2026-06-01.jsonl', 'telemetry-2026-06-02.jsonl']);
  });
});

describe('EngagementEventSchema', () => {
  it('rejects unknown keys (strict)', () => {
    const bad = EngagementEventSchema.safeParse({
      schema_version: 1,
      ts: '2026-05-31T00:00:00.000Z',
      kind: 'skill',
      name: 'x',
      prompt: 'leak',
    });
    expect(bad.success).toBe(false);
  });
});

describe('readEngagementEvents', () => {
  it('returns [] for a missing directory', async () => {
    expect(await readEngagementEvents(join(dir, 'nope'))).toEqual([]);
  });

  it('reads events across multiple day files in order', async () => {
    clock = 0;
    const rec = new JsonlEngagementRecorder({ baseDir: dir, now: fixedNow });
    await rec.record({ kind: 'skill', name: 'a' });
    await rec.record({ kind: 'tool', name: 'b' });
    const events = await readEngagementEvents(dir);
    expect(events.map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('skips malformed lines without throwing', async () => {
    const rec = new JsonlEngagementRecorder({
      baseDir: dir,
      now: () => '2026-05-31T00:00:00.000Z',
    });
    await rec.record({ kind: 'skill', name: 'good' });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      join(dir, 'telemetry-2026-05-31.jsonl'),
      'not json\n{"kind":"bogus"}\n',
      'utf8',
    );
    const events = await readEngagementEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('good');
  });
});
