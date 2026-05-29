import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * T-413 — Append-only audit log.
 *
 * Every tool call + every permission-gate decision + every Hard-Floor block
 * writes one JSONL row to a session-rotated file under
 * `.event4u-agent/audit-<session>.jsonl`. The roadmap suggested chmod 444
 * after each write; that conflicts with append semantics, so v0 simply
 * uses one file per session (rotated by the host on session start).
 *
 * No reader UI in MVP — v1.0 Sprint 7 adds a drawer view. We just write.
 */

export const AuditEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool_call'),
    ts: z.string(),
    session_id: z.string(),
    conversation_id: z.string(),
    tool: z.string(),
    args: z.record(z.unknown()),
    outcome: z.enum(['ok', 'error']),
    duration_ms: z.number().int().nonnegative(),
    /** Truncated output preview — full output stays in the chat log. */
    preview: z.string().optional(),
  }),
  z.object({
    kind: z.literal('permission_decision'),
    ts: z.string(),
    session_id: z.string(),
    conversation_id: z.string(),
    tool: z.string(),
    /** `allow` / `block` / `ask_allow_once` / `ask_always` / `ask_deny`. */
    decision: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('hard_floor_block'),
    ts: z.string(),
    session_id: z.string(),
    conversation_id: z.string(),
    tool: z.string(),
    args: z.record(z.unknown()),
    matched_pattern: z.string(),
  }),
]);
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export interface AuditLogOptions {
  /** Resolves to `.event4u-agent/audit-<session_id>.jsonl` by default. */
  path: string;
}

export class AuditLog {
  constructor(private readonly opts: AuditLogOptions) {}

  async write(event: AuditEvent): Promise<void> {
    const validated = AuditEventSchema.parse(event);
    await mkdir(dirname(this.opts.path), { recursive: true });
    await appendFile(this.opts.path, `${JSON.stringify(validated)}\n`, 'utf8');
  }
}
