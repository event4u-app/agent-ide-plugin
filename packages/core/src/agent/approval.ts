import type { ToolCallEvent, ToolReview } from '@event4u-agent/protocol';
import type { AuditRecorder } from '../permissions/audit.js';
import { classifyRisk, type PermissionDecision, type PermissionGate } from '../permissions/gate.js';
import type { NormalizedToolCall } from '../tools/normalizer.js';

/**
 * T-PRD01 — tool-call approval orchestration (pure core).
 *
 * Turns one {@link NormalizedToolCall} into the ordered {@link ToolCallEvent}
 * stream an IDE renders as approval / diff / result cards, without knowing
 * anything about a webview, Swing, or the wire. The human decision and the
 * tool execution are injected, so the whole flow is unit-testable with plain
 * promises.
 *
 * Lifecycle (AI council 2026-05-31, UNANIMOUS — injected `decide` callback +
 * `AsyncIterable`, explicit `AbortSignal`, deterministic `error` event on a
 * failed decision; NOT yet wired into the multi-step `AgentDriver`):
 *
 *   started
 *   → (gate `block`)  → error               [hard floor; nothing executes]
 *   → (gate `ask`)    → approvalRequested
 *                        → approvalResolved(deny)            [stops here]
 *                        → approvalResolved(allow_once|always) → exec
 *   → (gate `allow`)  → exec
 *   exec → result | error
 *
 * An `always` decision is persisted via {@link PermissionGate.grantAlways} with
 * an unscoped record (matches every future call to the same tool) — the v0
 * "allow always for this tool" semantics; per-argument scoping is deferred.
 */

/** The outcome of executing the tool, summarised for the `result` card. */
export interface ToolExecResult {
  ok: boolean;
  outputPreview: string;
}

/** Context the IDE / caller injects around one tool-call. */
export interface ApprovalDecisionRequest {
  id: string;
  name: string;
  level: 'requires_diff_approval' | 'requires_approval';
  riskReason?: string;
  review?: ToolReview;
}

export interface ApprovalContext {
  gate: PermissionGate;
  /** Resolve the human (or policy) decision when the gate says `ask`. */
  decide: (request: ApprovalDecisionRequest) => Promise<PermissionDecision>;
  /** Execute the tool once it is auto-allowed or approved. */
  exec: () => Promise<ToolExecResult>;
  /** Structured review payload (e.g. a multi-file diff) for the approval card. */
  review?: ToolReview;
  /** Cooperative cancellation — checked before evaluation and before exec. */
  signal?: AbortSignal;
  /** Override the args preview; defaults to a truncated JSON of `call.input`. */
  argsPreview?: string;
  /** Optional reason surfaced on the approval card. */
  riskReason?: string;
  /** Optional audit trail — records hard-floor blocks + user decisions (T-PRD05). */
  audit?: AuditRecorder;
}

const PREVIEW_LIMIT = 200;

/**
 * Drive one tool-call through the gate and (when needed) a human decision,
 * yielding the lifecycle events in order. The generator is the source of
 * truth for ordering; a transport layer just forwards each event verbatim.
 */
export async function* runToolCallWithApproval(
  call: NormalizedToolCall,
  ctx: ApprovalContext,
): AsyncIterable<ToolCallEvent> {
  const { id, name } = call;
  yield { kind: 'started', id, name, argsPreview: ctx.argsPreview ?? previewArgs(call.input) };

  if (ctx.signal?.aborted) {
    yield { kind: 'error', id, message: 'cancelled before evaluation' };
    return;
  }

  const verdict = await ctx.gate.evaluate({ tool: name, args: asRecord(call.input) });
  if (verdict.result === 'block') {
    await ctx.audit?.record({ kind: 'deny_hard_floor', tool: name, reason: verdict.matched });
    yield { kind: 'error', id, message: `blocked by hard floor: ${verdict.matched}` };
    return;
  }

  if (verdict.result === 'ask') {
    const request: ApprovalDecisionRequest = {
      id,
      name,
      level: verdict.level,
      ...(ctx.riskReason ? { riskReason: ctx.riskReason } : {}),
      ...(ctx.review ? { review: ctx.review } : {}),
    };
    // Core owns the risk-badge classification (B2: presentation hint on the
    // event only — the decider keeps the authoritative `level`, never the
    // lossy projection). Both IDE clients render this one consistent badge.
    const riskLevel = classifyRisk(verdict.level);
    yield {
      kind: 'approvalRequested',
      id,
      level: verdict.level,
      riskLevel,
      ...(ctx.riskReason ? { riskReason: ctx.riskReason } : {}),
      ...(ctx.review ? { review: ctx.review } : {}),
    };

    let decision: PermissionDecision;
    try {
      decision = await ctx.decide(request);
    } catch (err) {
      yield { kind: 'error', id, message: `approval decision failed: ${errorMessage(err)}` };
      return;
    }

    yield { kind: 'approvalResolved', id, decision };
    if (decision === 'deny') {
      await ctx.audit?.record({ kind: 'deny_user', tool: name });
      return;
    }
    if (decision === 'always') {
      await ctx.gate.grantAlways(name);
      await ctx.audit?.record({ kind: 'grant_always', tool: name });
    } else {
      await ctx.audit?.record({ kind: 'grant_once', tool: name });
    }
  }

  if (ctx.signal?.aborted) {
    yield { kind: 'error', id, message: 'cancelled before execution' };
    return;
  }

  try {
    const result = await ctx.exec();
    yield { kind: 'result', id, ok: result.ok, outputPreview: truncate(result.outputPreview) };
  } catch (err) {
    yield { kind: 'error', id, message: errorMessage(err) };
  }
}

/** A truncated, human-readable preview of arbitrary tool input. */
export function previewArgs(input: unknown): string {
  if (input === undefined || input === null) return '';
  const text = typeof input === 'string' ? input : safeStringify(input);
  return truncate(text);
}

function truncate(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
