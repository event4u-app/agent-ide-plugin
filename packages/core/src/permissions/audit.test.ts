import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLog, isoDate } from './audit.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'event4u-audit-'));
  dirs.push(d);
  return d;
}

const FIXED = new Date('2026-05-31T12:00:00.000Z');
const fixedNow = (): Date => FIXED;

afterEach(() => {
  dirs.length = 0;
});

describe('AuditLog', () => {
  it('appends entries to a date-rotated jsonl and reads them back', async () => {
    const dir = await tempDir();
    const log = new AuditLog({ dir, now: fixedNow });
    await log.record({ kind: 'grant_once', tool: 'run_command' });
    await log.record({ kind: 'deny_hard_floor', tool: 'run_command', reason: 'git push --force' });

    const entries = await log.readDay('2026-05-31');
    expect(entries.map((e) => e.kind)).toEqual(['grant_once', 'deny_hard_floor']);
    expect(entries[1]?.reason).toBe('git push --force');
    expect(entries[0]?.ts).toBe(FIXED.toISOString());
  });

  it('stamps ts from the injected clock when omitted', async () => {
    const dir = await tempDir();
    const log = new AuditLog({ dir, now: fixedNow });
    await log.record({ kind: 'grant_always', tool: 'write_file', scope: 'src/a.ts' });
    const [entry] = await log.readDay('2026-05-31');
    expect(entry?.ts).toBe(FIXED.toISOString());
    expect(entry?.scope).toBe('src/a.ts');
  });

  it('reads an empty list for a day with no log', async () => {
    const dir = await tempDir();
    const log = new AuditLog({ dir, now: fixedNow });
    expect(await log.readDay('2020-01-01')).toEqual([]);
  });

  it('tolerates torn / blank lines when reading', async () => {
    const dir = await tempDir();
    const log = new AuditLog({ dir, now: fixedNow });
    await log.record({ kind: 'grant_once', tool: 'a' });
    // Corrupt the file with a torn line + a blank line.
    const file = join(dir, 'audit-2026-05-31.jsonl');
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, '\n{not json\n', 'utf8');
    await log.record({ kind: 'deny_user', tool: 'b' });
    const entries = await log.readDay('2026-05-31');
    expect(entries.map((e) => e.tool)).toEqual(['a', 'b']);
  });

  it('is fail-open: a record into an unwritable dir does not throw', async () => {
    const log = new AuditLog({ dir: '/this/path/cannot/exist\0/x', now: fixedNow });
    await expect(log.record({ kind: 'grant_once', tool: 'a' })).resolves.toBeUndefined();
  });

  it('writes one JSON object per line', async () => {
    const dir = await tempDir();
    const log = new AuditLog({ dir, now: fixedNow });
    await log.record({ kind: 'grant_once', tool: 'a' });
    await log.record({ kind: 'grant_once', tool: 'b' });
    const raw = await readFile(join(dir, 'audit-2026-05-31.jsonl'), 'utf8');
    expect(raw.trimEnd().split('\n')).toHaveLength(2);
  });
});

describe('isoDate', () => {
  it('renders YYYY-MM-DD in UTC', () => {
    expect(isoDate(new Date('2026-05-31T23:59:59.000Z'))).toBe('2026-05-31');
  });
});
