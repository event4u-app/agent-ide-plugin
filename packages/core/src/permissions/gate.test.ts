import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyRisk, normalizeArgsBlob, PermissionGate } from './gate.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'event4u-perm-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('PermissionGate.classify', () => {
  it('low for read tools', () => {
    const gate = new PermissionGate();
    expect(gate.classify('read_file').level).toBe('low');
    expect(gate.classify('list_dir').level).toBe('low');
    expect(gate.classify('glob').level).toBe('low');
    expect(gate.classify('grep').level).toBe('low');
  });

  it('requires_diff_approval for write_file', () => {
    expect(new PermissionGate().classify('write_file').level).toBe('requires_diff_approval');
  });

  it('requires_approval for unknown tools', () => {
    expect(new PermissionGate().classify('unknown_tool').level).toBe('requires_approval');
  });
});

describe('PermissionGate.evaluate — hard floor', () => {
  it('blocks rm -rf / via run_command args', async () => {
    const gate = new PermissionGate();
    const result = await gate.evaluate({
      tool: 'run_command',
      args: { cmd: 'rm -rf / --no-preserve-root' },
    });
    expect(result.result).toBe('block');
  });

  it('blocks DROP TABLE', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'run_command',
      args: { cmd: 'DROP TABLE users' },
    });
    expect(result.result).toBe('block');
  });

  it('blocks git push --force', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'run_command',
      args: { cmd: 'git push --force origin main' },
    });
    expect(result.result).toBe('block');
  });

  // Obfuscation bypass classes — the tripwire normalizes args before matching
  // (ADR-004 § boundary vs. tripwire). Not exhaustive, but trivial dodges fail.
  it('blocks rm -rf / split with the $IFS word-splitting trick', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'run_command',
      args: { cmd: 'rm${IFS}-rf${IFS}/${IFS}--no-preserve-root' },
    });
    expect(result.result).toBe('block');
  });

  it('blocks git push --force when quotes break up the flag', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'run_command',
      args: { cmd: "git push --fo''rce origin main" },
    });
    expect(result.result).toBe('block');
  });

  it('blocks DROP TABLE when quotes break up the keyword', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'run_command',
      args: { cmd: 'DR""OP TABLE users' },
    });
    expect(result.result).toBe('block');
  });
});

describe('normalizeArgsBlob', () => {
  it('expands $IFS, strips quotes, and collapses whitespace', () => {
    expect(normalizeArgsBlob('rm${IFS}-rf${IFS}/')).toBe('rm -rf /');
    expect(normalizeArgsBlob("git push --fo''rce")).toBe('git push --force');
    expect(normalizeArgsBlob('a   b\t c')).toBe('a b c');
  });

  it('leaves a benign blob substantively unchanged', () => {
    expect(normalizeArgsBlob('read_file {path:src/foo.ts}')).toBe('read_file {path:src/foo.ts}');
  });
});

describe('PermissionGate.evaluate — flow', () => {
  it('allows low tools without asking', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'read_file',
      args: { path: 'src/index.ts' },
    });
    expect(result.result).toBe('allow');
  });

  it('asks for write_file via the diff-approval channel', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'write_file',
      args: { path: 'src/index.ts', content: 'x' },
    });
    expect(result.result).toBe('ask');
    if (result.result === 'ask') {
      expect(result.level).toBe('requires_diff_approval');
    }
  });

  it('asks for unknown tools via the generic permission dialog', async () => {
    const result = await new PermissionGate().evaluate({
      tool: 'run_command',
      args: { cmd: 'ls' },
    });
    expect(result.result).toBe('ask');
  });

  it('honours an "always" grant after the first allow', async () => {
    const gate = new PermissionGate({ filePath: join(dir, 'perms.json') });
    await gate.grantAlways('run_command', 'ls');
    const result = await gate.evaluate({ tool: 'run_command', args: { path: 'ls' } });
    // Scope is the path arg; this call has path:'ls' so the "ls" scope matches.
    expect(result.result).toBe('allow');
  });

  it('grants without scope match every call', async () => {
    const gate = new PermissionGate({ filePath: join(dir, 'perms.json') });
    await gate.grantAlways('run_command');
    const result = await gate.evaluate({
      tool: 'run_command',
      args: { cmd: 'whatever' },
    });
    expect(result.result).toBe('allow');
  });

  it('persists grants across instances when filePath is set', async () => {
    const path = join(dir, 'perms.json');
    const first = new PermissionGate({ filePath: path });
    await first.grantAlways('run_command', 'ls');
    const second = new PermissionGate({ filePath: path });
    const result = await second.evaluate({ tool: 'run_command', args: { path: 'ls' } });
    expect(result.result).toBe('allow');
  });

  it('revokeAll clears persisted grants', async () => {
    const path = join(dir, 'perms.json');
    const gate = new PermissionGate({ filePath: path });
    await gate.grantAlways('run_command');
    await gate.revokeAll();
    const fresh = new PermissionGate({ filePath: path });
    const result = await fresh.evaluate({ tool: 'run_command', args: {} });
    expect(result.result).toBe('ask');
  });
});

describe('classifyRisk (T-PRD05)', () => {
  it('maps the permission level to a risk badge', () => {
    expect(classifyRisk('low')).toBe('low');
    expect(classifyRisk('requires_diff_approval')).toBe('medium');
    expect(classifyRisk('requires_approval')).toBe('high');
    expect(classifyRisk('denied')).toBe('high');
  });
});
