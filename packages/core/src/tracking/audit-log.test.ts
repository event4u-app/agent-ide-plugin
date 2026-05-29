import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, type AuditEvent } from './audit-log.js';

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'event4u-audit-'));
  path = join(dir, 'audit-test.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AuditLog', () => {
  it('writes tool_call events', async () => {
    const log = new AuditLog({ path });
    await log.write({
      kind: 'tool_call',
      ts: '2026-05-29T10:00:00Z',
      session_id: 's1',
      conversation_id: 'c1',
      tool: 'read_file',
      args: { path: 'src/index.ts' },
      outcome: 'ok',
      duration_ms: 12,
    });
    const out = (await readFile(path, 'utf8')).trim();
    const parsed = JSON.parse(out) as AuditEvent;
    expect(parsed.kind).toBe('tool_call');
  });

  it('appends multiple rows in order', async () => {
    const log = new AuditLog({ path });
    await log.write({
      kind: 'permission_decision',
      ts: '2026-05-29T10:00:00Z',
      session_id: 's1',
      conversation_id: 'c1',
      tool: 'run_command',
      decision: 'ask_allow_once',
    });
    await log.write({
      kind: 'hard_floor_block',
      ts: '2026-05-29T10:00:01Z',
      session_id: 's1',
      conversation_id: 'c1',
      tool: 'run_command',
      args: { cmd: 'rm -rf /' },
      matched_pattern: 'rm-rf-root',
    });
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).kind).toBe('permission_decision');
    expect(JSON.parse(lines[1]!).kind).toBe('hard_floor_block');
  });

  it('rejects events that violate the schema', async () => {
    const log = new AuditLog({ path });
    await expect(
      log.write({
        kind: 'tool_call',
        ts: '',
        session_id: '',
        conversation_id: '',
        tool: '',
        args: {},
        outcome: 'ok',
        duration_ms: -1,
      } as unknown as AuditEvent),
    ).rejects.toThrow();
  });

  it('creates parent directories on first write', async () => {
    const deep = join(dir, 'nested', 'deeper', 'audit.jsonl');
    const log = new AuditLog({ path: deep });
    await log.write({
      kind: 'tool_call',
      ts: '2026-05-29T10:00:00Z',
      session_id: 's1',
      conversation_id: 'c1',
      tool: 'glob',
      args: { pattern: '*.ts' },
      outcome: 'ok',
      duration_ms: 5,
    });
    expect(await readFile(deep, 'utf8')).toMatch(/glob/);
  });
});
