import { describe, expect, it, vi } from 'vitest';
import { RiskLevelSchema as ProtocolRiskLevelSchema } from '@event4u-agent/protocol';
import type { ToolCallEvent } from '@event4u-agent/protocol';
import type { AuditEntry, AuditRecorder } from '../permissions/audit.js';
import {
  classifyRisk,
  PermissionGate,
  RiskLevelSchema,
  type PermissionDecision,
} from '../permissions/gate.js';
import type { NormalizedToolCall } from '../tools/normalizer.js';
import {
  type ApprovalContext,
  previewArgs,
  runToolCallWithApproval,
  type ToolExecResult,
} from './approval.js';

const OK: ToolExecResult = { ok: true, outputPreview: 'done' };

function gate(): PermissionGate {
  // In-memory (no filePath) with the default classifications:
  //   read_file = low · write_file = requires_diff_approval · run_command = requires_approval
  return new PermissionGate();
}

async function drain(call: NormalizedToolCall, ctx: ApprovalContext): Promise<ToolCallEvent[]> {
  const events: ToolCallEvent[] = [];
  for await (const event of runToolCallWithApproval(call, ctx)) events.push(event);
  return events;
}

const kinds = (events: ToolCallEvent[]): string[] => events.map((e) => e.kind);

describe('runToolCallWithApproval', () => {
  it('auto-allows a low-risk tool: started → result, no approval', async () => {
    const exec = vi.fn(async () => OK);
    const decide = vi.fn(async (): Promise<PermissionDecision> => 'allow_once');
    const events = await drain(
      { id: 't1', name: 'read_file', input: { path: 'a.ts' } },
      { gate: gate(), decide, exec },
    );
    expect(kinds(events)).toEqual(['started', 'result']);
    expect(decide).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledOnce();
    const started = events[0];
    expect(started.kind === 'started' && started.argsPreview).toBe('{"path":"a.ts"}');
  });

  it('asks then allows once: started → approvalRequested → approvalResolved → result', async () => {
    const exec = vi.fn(async () => OK);
    const events = await drain(
      { id: 't2', name: 'run_command', input: { cmd: 'ls' } },
      { gate: gate(), decide: async () => 'allow_once', exec },
    );
    expect(kinds(events)).toEqual(['started', 'approvalRequested', 'approvalResolved', 'result']);
    const ask = events[1];
    expect(ask.kind === 'approvalRequested' && ask.level).toBe('requires_approval');
    // Core classifies the badge: requires_approval → high (B2: event-only hint).
    expect(ask.kind === 'approvalRequested' && ask.riskLevel).toBe('high');
    expect(exec).toHaveBeenCalledOnce();
  });

  it('deny stops before execution: no result event, exec never runs', async () => {
    const exec = vi.fn(async () => OK);
    const events = await drain(
      { id: 't3', name: 'run_command', input: {} },
      { gate: gate(), decide: async () => 'deny', exec },
    );
    expect(kinds(events)).toEqual(['started', 'approvalRequested', 'approvalResolved']);
    const resolved = events[2];
    expect(resolved.kind === 'approvalResolved' && resolved.decision).toBe('deny');
    expect(exec).not.toHaveBeenCalled();
  });

  it('always persists the grant so the next identical call auto-allows', async () => {
    const g = gate();
    const first = await drain(
      { id: 't4', name: 'run_command', input: {} },
      { gate: g, decide: async () => 'always', exec: async () => OK },
    );
    expect(kinds(first)).toEqual(['started', 'approvalRequested', 'approvalResolved', 'result']);

    const decide = vi.fn(async (): Promise<PermissionDecision> => 'deny');
    const second = await drain(
      { id: 't5', name: 'run_command', input: {} },
      { gate: g, decide, exec: async () => OK },
    );
    expect(kinds(second)).toEqual(['started', 'result']);
    expect(decide).not.toHaveBeenCalled();
  });

  it('blocks a hard-floor command: started → error, exec never runs', async () => {
    const exec = vi.fn(async () => OK);
    const events = await drain(
      { id: 't6', name: 'run_command', input: { cmd: 'git push --force origin main' } },
      { gate: gate(), decide: async () => 'allow_once', exec },
    );
    expect(kinds(events)).toEqual(['started', 'error']);
    const error = events[1];
    expect(error.kind === 'error' && error.message).toMatch(/hard floor/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('surfaces an exec failure as a deterministic error event', async () => {
    const events = await drain(
      { id: 't7', name: 'read_file', input: {} },
      {
        gate: gate(),
        decide: async () => 'allow_once',
        exec: async () => {
          throw new Error('disk full');
        },
      },
    );
    expect(kinds(events)).toEqual(['started', 'error']);
    const error = events[1];
    expect(error.kind === 'error' && error.message).toBe('disk full');
  });

  it('a failing decision yields an error and never executes', async () => {
    const exec = vi.fn(async () => OK);
    const events = await drain(
      { id: 't8', name: 'run_command', input: {} },
      {
        gate: gate(),
        decide: async () => {
          throw new Error('user closed the dialog');
        },
        exec,
      },
    );
    expect(kinds(events)).toEqual(['started', 'approvalRequested', 'error']);
    const error = events[2];
    expect(error.kind === 'error' && error.message).toMatch(/approval decision failed/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('carries the diff review payload onto the approval card', async () => {
    const events = await drain(
      { id: 't9', name: 'write_file', input: { edits: [] } },
      {
        gate: gate(),
        decide: async () => 'allow_once',
        exec: async () => OK,
        review: { kind: 'diff', files: [{ path: 'a.ts', diff: 'd', isNewFile: false }] },
      },
    );
    const ask = events[1];
    expect(ask.kind === 'approvalRequested' && ask.level).toBe('requires_diff_approval');
    // requires_diff_approval → medium badge.
    expect(ask.kind === 'approvalRequested' && ask.riskLevel).toBe('medium');
    expect(ask.kind === 'approvalRequested' && ask.review?.files[0]?.path).toBe('a.ts');
  });

  it('respects a pre-aborted signal: started → error, no evaluation', async () => {
    const exec = vi.fn(async () => OK);
    const decide = vi.fn(async (): Promise<PermissionDecision> => 'allow_once');
    const events = await drain(
      { id: 't10', name: 'run_command', input: {} },
      { gate: gate(), decide, exec, signal: AbortSignal.abort() },
    );
    expect(kinds(events)).toEqual(['started', 'error']);
    expect(decide).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('truncates a long output preview', async () => {
    const events = await drain(
      { id: 't11', name: 'read_file', input: {} },
      {
        gate: gate(),
        decide: async () => 'allow_once',
        exec: async () => ({ ok: true, outputPreview: 'x'.repeat(500) }),
      },
    );
    const result = events[1];
    expect(result.kind === 'result' && result.outputPreview.endsWith('…')).toBe(true);
    expect(result.kind === 'result' && result.outputPreview.length).toBe(201);
  });
});

describe('runToolCallWithApproval — audit trail (T-PRD05)', () => {
  function recorder(): { audit: AuditRecorder; entries: Array<Omit<AuditEntry, 'ts'>> } {
    const entries: Array<Omit<AuditEntry, 'ts'>> = [];
    return {
      entries,
      audit: {
        record: async (e) => {
          entries.push(e);
        },
      },
    };
  }

  it('records a hard-floor block as deny_hard_floor with the matched pattern', async () => {
    const { audit, entries } = recorder();
    await drain(
      { id: 'a1', name: 'run_command', input: { cmd: 'git push --force origin main' } },
      { gate: gate(), decide: async () => 'allow_once', exec: async () => OK, audit },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('deny_hard_floor');
    expect(entries[0]?.tool).toBe('run_command');
    expect(entries[0]?.reason).toBeTruthy();
  });

  it('records grant_once / grant_always / deny_user for the ask path', async () => {
    const once = recorder();
    await drain(
      { id: 'a2', name: 'run_command', input: {} },
      { gate: gate(), decide: async () => 'allow_once', exec: async () => OK, audit: once.audit },
    );
    expect(once.entries.map((e) => e.kind)).toEqual(['grant_once']);

    const always = recorder();
    await drain(
      { id: 'a3', name: 'run_command', input: {} },
      { gate: gate(), decide: async () => 'always', exec: async () => OK, audit: always.audit },
    );
    expect(always.entries.map((e) => e.kind)).toEqual(['grant_always']);

    const denied = recorder();
    await drain(
      { id: 'a4', name: 'run_command', input: {} },
      { gate: gate(), decide: async () => 'deny', exec: async () => OK, audit: denied.audit },
    );
    expect(denied.entries.map((e) => e.kind)).toEqual(['deny_user']);
  });

  it('records nothing for an auto-allowed low-risk tool', async () => {
    const { audit, entries } = recorder();
    await drain(
      { id: 'a5', name: 'read_file', input: { path: 'a.ts' } },
      { gate: gate(), decide: async () => 'allow_once', exec: async () => OK, audit },
    );
    expect(entries).toEqual([]);
  });
});

describe('previewArgs', () => {
  it('stringifies object input', () => {
    expect(previewArgs({ a: 1 })).toBe('{"a":1}');
  });

  it('passes a string through', () => {
    expect(previewArgs('npm test')).toBe('npm test');
  });

  it('renders nullish input as empty', () => {
    expect(previewArgs(undefined)).toBe('');
    expect(previewArgs(null)).toBe('');
  });

  it('truncates a long preview to 200 chars + ellipsis', () => {
    const preview = previewArgs('y'.repeat(500));
    expect(preview.length).toBe(201);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('classifyRisk wiring (T-PRD05)', () => {
  it('maps each ask-level to its badge', () => {
    expect(classifyRisk('low')).toBe('low');
    expect(classifyRisk('requires_diff_approval')).toBe('medium');
    expect(classifyRisk('requires_approval')).toBe('high');
    expect(classifyRisk('denied')).toBe('high');
  });

  it('keeps the wire RiskLevel enum in lock-step with the core one (drift guard)', () => {
    // The protocol mirror and the core source must never diverge — a new core
    // risk band that is not on the wire would make the badge unrepresentable.
    expect(ProtocolRiskLevelSchema.options).toEqual(RiskLevelSchema.options);
  });
});
