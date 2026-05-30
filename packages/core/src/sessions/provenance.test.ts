import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionProvenanceIndex } from './provenance.js';
import type { SessionSummary } from './types.js';

function summary(id: string, source: SessionSummary['source']): SessionSummary {
  return {
    id,
    source,
    origin: 'unknown',
    provider: 'x',
    title: 't',
    startedAt: 1,
    lastMessageAt: 2,
    messageCount: 1,
    status: 'completed',
  };
}

describe('SessionProvenanceIndex', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'event4u-prov-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('classifies api as plugin and indexed CLI ids as plugin', async () => {
    const file = join(dir, 'session-index.json');
    await writeFile(file, JSON.stringify({ sessions: [{ id: 'claude-cli:known' }] }));
    const index = new SessionProvenanceIndex(file);
    const out = await index.apply([
      summary('api:c1', 'api'),
      summary('claude-cli:known', 'claude-cli'),
      summary('claude-cli:unknown', 'claude-cli'),
    ]);
    expect(out.map((s) => s.origin)).toEqual(['plugin', 'plugin', 'external']);
  });

  it('treats a missing index file as external (normal empty state)', async () => {
    const index = new SessionProvenanceIndex(join(dir, 'absent.json'));
    const out = await index.apply([summary('codex-cli:x', 'codex-cli')]);
    expect(out[0]!.origin).toBe('external');
  });

  it('marks CLI sessions unknown when the index is unreadable', async () => {
    const file = join(dir, 'broken.json');
    await writeFile(file, '{ broken json');
    const index = new SessionProvenanceIndex(file);
    const out = await index.apply([summary('codex-cli:x', 'codex-cli'), summary('api:y', 'api')]);
    expect(out[0]!.origin).toBe('unknown');
    expect(out[1]!.origin).toBe('plugin'); // api is always plugin
  });

  it('memoizes until invalidated', async () => {
    const file = join(dir, 'session-index.json');
    await writeFile(file, JSON.stringify({ sessions: [] }));
    const index = new SessionProvenanceIndex(file);
    expect((await index.apply([summary('codex-cli:x', 'codex-cli')]))[0]!.origin).toBe('external');
    await writeFile(file, JSON.stringify({ sessions: [{ id: 'codex-cli:x' }] }));
    // Still cached → external.
    expect((await index.apply([summary('codex-cli:x', 'codex-cli')]))[0]!.origin).toBe('external');
    index.invalidate();
    expect((await index.apply([summary('codex-cli:x', 'codex-cli')]))[0]!.origin).toBe('plugin');
  });
});
