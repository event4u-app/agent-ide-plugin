import type {
  CapVerdict,
  ChatBudgetStatus,
  ChatCost,
  ChatEstimate,
  ChatSendRequest,
  ChatSendResponse,
  ChatUsage,
  ChatMessage,
  ContextScope,
  ContextSnippetAnnotation,
  ConversationListRequest,
  ConversationListResponse,
  ConversationRewindRequest,
  ConversationRewindResponse,
  ConversationSearchRequest,
  ConversationSearchResponse,
  Envelope,
  LlmMode,
  LlmRequest,
  LlmUsage,
} from '@event4u-agent/protocol';
import { isAbortError } from '../abort.js';
import type { BudgetRecorder, BudgetStatus } from '../cost/budget.js';
import { estimateCost, type CostRange } from '../cost/estimate.js';
import type { CalibrationLog } from '../cost/reconcile.js';
import type { LlmBackend } from '../llm/backend.js';
import { LlmStreamError } from '../llm/backend.js';
import { CancellationToken } from '../llm/cancellation.js';
import type { PricingBook } from '../pricing/loader.js';
import type { CapEvaluation, CapsEvaluator } from '../tracking/caps.js';
import { buildStepEvent, type StepRecorder } from '../tracking/step-recorder.js';
import { buildContextInjection } from './context-injection.js';
import { planRewind } from './rewind.js';
import type { ConversationStore } from './store.js';
import { resolveSystemPrompt, type LoadGuidelines, type LoadRules } from './system-prompt.js';

/**
 * T-VS03 / T-VS04 — chat-RPC handler (pure core).
 *
 * Drives a single LLM turn for `chatSend`: persists the user message, streams
 * the assistant's tokens back as `done:false` envelopes through an injected
 * {@link EnvelopeSink}, persists the assistant turn, and returns the terminal
 * `done:true` envelope carrying usage + cost. `chatCancel` aborts an in-flight
 * turn keyed by `conversationId`.
 *
 * Design ratified by AI council (codex-cli 0.134.0 + gemini 0.41.2,
 * 2026-05-31, UNANIMOUS):
 *  - The dispatcher owns the terminal envelope; this handler only ever emits
 *    `done:false` token envelopes (exactly-once terminal — risk #5).
 *  - Cancellation is keyed by `conversationId`; a second `chatSend` for a
 *    conversation with a turn in flight is rejected with {@link ChatBusyError}.
 *  - Provider-direct: a single LLM turn, no tool loop. The multi-step
 *    `AgentDriver` folds in as a follow-up (roadmap Phase-1 fallback).
 *  - A mid-stream cancel keeps and persists the partial assistant text.
 *
 * Cost & budget wiring (T-PRD06, AI council 2026-06-01, UNANIMOUS B/B1/B-inj/B-warn):
 *  - A pre-send {@link ChatEstimate} is emitted as an early `done:false`
 *    envelope BEFORE the first token (B1), when pricing + a local
 *    `countInputTokens` are both available; otherwise it is silently skipped.
 *  - An optional {@link BudgetRecorder} is injected (B-inj); the handler records
 *    each turn's ACTUAL spend exactly once, then surfaces the resulting
 *    {@link ChatBudgetStatus} on the terminal response.
 *  - `overBudget` is flagged, never blocked (B-warn) — the hard-cap dialog is IDE.
 *  - Spend is recorded only for real metered turns (`!cost.isEstimate`): CLI
 *    shadow cost and unpriced turns read status but never debit a real budget,
 *    and an errored turn throws before the record so it never counts.
 */

/** Sink for intermediate `done:false` stream envelopes. */
export type EnvelopeSink = (envelope: Envelope) => void;

/** Thrown when a second `chatSend` arrives while a turn is already in flight. */
export class ChatBusyError extends Error {
  readonly code = 'chat_busy';
  constructor(conversationId: string) {
    super(`A turn is already in flight for conversation "${conversationId}".`);
    this.name = 'ChatBusyError';
  }
}

/**
 * A coded chat error so the dispatcher surfaces a specific `code` (not the
 * generic `handler_error`), mirroring {@link GitRequestError}. Used for a true
 * fault — e.g. a rewind request naming a conversation the store has never seen.
 */
export class ChatRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChatRequestError';
  }
}

export interface ChatHandlerDeps {
  /** Resolve the backend for a turn. `providerId` is the per-request selector. */
  resolveBackend: (providerId?: string) => LlmBackend;
  /** Model id used for the request + cost. May depend on the resolved provider. */
  resolveModel: (providerId?: string) => string;
  /** Persistence for the conversation turns. */
  store: ConversationStore;
  /** Pricing book for the turn cost. Absent / unknown model → a $0 estimate. */
  pricing?: PricingBook;
  /**
   * Optional daily-budget recorder (T-PRD06). When set, the handler records
   * each real-cost turn's spend and surfaces the resulting status on the
   * response. Absent → no estimate-budget behaviour (backward-compatible).
   */
  budget?: BudgetRecorder;
  /**
   * Optional step-event recorder (T-408 wiring, ADR-035). When set, the handler
   * persists ONE priced {@link StepEvent} per turn (`activity: 'chat'`) to the
   * tracking trail the Cost Dashboard reads. Recorded at the SAME finalize point
   * as {@link recordSpend} — so an errored turn (thrown earlier) never records,
   * a cancelled turn records its partial usage at most once. Only recorded when
   * a pricing book + known model supply a positive `pricing_book_version`
   * (mirrors the estimate gate). Fail-open: a write error never breaks the turn.
   */
  step?: StepRecorder;
  /**
   * Optional calibration-drift log (T-706 wiring, ADR-036, AI council
   * 2026-06-02, UNANIMOUS A0–A6). When set, the handler reconciles the turn's
   * real cost against the pre-flight estimate at the SAME finalize point as
   * {@link recordSpend}; a turn whose real cost overruns the estimate's upper
   * bound by more than the drift threshold appends a calibration event the Cost
   * Dashboard surfaces (T-707). Only when a pre-flight estimate range was
   * produced AND the turn was not cancelled (a partial spend is not a fair test
   * of the estimate — A5). Drift covers both api real cost and cli shadow cost
   * (A4 — accuracy signal, not a billing event). Fail-open: a write error never
   * breaks the turn. Absent → no reconciliation (backward-compatible).
   */
  calibration?: CalibrationLog;
  /**
   * Optional pre-send cost-cap evaluator (T-411a host integration, AI council
   * 2026-06-02, UNANIMOUS Q0–Q6). When set, the handler projects the turn's
   * upper-bound cost from the SAME input-token count the estimate uses and
   * evaluates it against the configured `tracking.caps` thresholds BEFORE the
   * provider stream. A `block` verdict refuses the turn (no spend, no step,
   * `stopReason: 'cost_cap_blocked'`); `warn`/`confirm` ride the pre-send
   * estimate event and the turn proceeds (the confirm modal is an IDE
   * round-trip that does not exist yet — Q3=A). Absent / no caps configured →
   * no gate (backward-compatible). Fail-open: an evaluator error never blocks.
   */
  capsEvaluator?: CapsEvaluator;
  /**
   * Optional workspace-guidelines loader (T-1307, AI council 2026-06-01,
   * UNANIMOUS A2/C2/D1/E1/F1). When set, the handler folds the current
   * guidelines into the turn's `system` prompt (composed FRESH per turn so an
   * edit to `guidelines.md` between turns takes effect). Fail-open: a loader
   * error degrades to no guidelines, never breaks the turn. Absent → no system
   * prompt (backward-compatible).
   */
  loadGuidelines?: LoadGuidelines;
  /**
   * Optional always-active RULES loader (T-404 wiring, ADR-043). When set, the
   * handler folds the workspace rules block AHEAD of guidelines into the turn's
   * `system` prompt (so the agent's always-active rules reach the model — the
   * dead T-404 seam, sibling of the guidelines wiring). Fail-open; absent → no
   * rules (backward-compatible).
   */
  loadRules?: LoadRules;
  /**
   * Optional scoped-context retriever (T-MR13, AI council 2026-06-01,
   * UNANIMOUS A1/B1/C1/D1/E1/F1). When set, the handler retrieves the top-k
   * context snippets for the turn's {@link ContextScope}, folds them into the
   * system prompt (so the model sees them — D1), and surfaces them on the
   * response (so the IDE renders SnippetBadges — E1). Absent → no retrieval
   * (backward-compatible; the vertical-slice path is unchanged — F1). The
   * callback resolves the scope against the live enabled roots itself (the
   * {@link WorkspaceCoordinator} owns that set — C1).
   */
  retrieveContext?: (
    query: string,
    scope: ContextScope,
    signal: AbortSignal,
  ) => Promise<ContextSnippetAnnotation[]>;
  /** Output cap for the turn. Default 2048 (matches the `LlmRequest` default). */
  maxTokens?: number;
}

/**
 * Hard ceiling on `conversationSearch` results, independent of the request's
 * `limit` (T-1301). Bounds the NDJSON line so a missing / oversized `limit`
 * cannot produce a huge response (AI council 2026-06-02, UNANIMOUS Q3=B).
 */
export const MAX_CONVERSATION_SEARCH_RESULTS = 100;

/**
 * Hard ceiling on `conversationList` results, independent of the request's
 * `limit` (T-1301). Bounds the NDJSON line so a workspace with thousands of
 * conversations cannot produce a huge response — the sibling of
 * {@link MAX_CONVERSATION_SEARCH_RESULTS} (AI council 2026-06-02, split Q1
 * resolved B for sibling-consistency with `conversationSearch`).
 */
export const MAX_CONVERSATION_LIST_RESULTS = 100;

export class ChatHandler {
  /** In-flight cancellation tokens, keyed by `conversationId`. */
  private readonly active = new Map<string, CancellationToken>();

  constructor(private readonly deps: ChatHandlerDeps) {}

  /** Whether a turn is currently in flight for the conversation. */
  isActive(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  /**
   * Plan a rewind to a checkpoint (T-1303). Pure and non-mutating: loads the
   * conversation, runs {@link planRewind}, and projects the plan onto the wire.
   * Core has no file-restore authority — the IDE consumes this plan and restores
   * the conversation view + (via its own VCS/undo) the files.
   *
   * Per the AI council (codex-cli + gemini-cli, 2026-06-02): an unknown
   * `conversationId` is a true fault → `conversation_not_found` (gemini A); an
   * unknown `checkpointId` on an existing conversation is expected state
   * (checkpoints are not yet auto-recorded) → `found:false` (codex B). The opaque
   * `workState` and the full message bodies are deliberately NOT projected onto
   * the wire (Q1=A / Q2=A) — the IDE slices `[0, targetTurnIndex)` from the
   * conversation it already holds.
   */
  async rewind(req: ConversationRewindRequest): Promise<ConversationRewindResponse> {
    const conversation = await this.deps.store.load(req.conversationId);
    if (!conversation) {
      throw new ChatRequestError(
        'conversation_not_found',
        `No conversation on record for id "${req.conversationId}".`,
      );
    }
    const plan = planRewind(conversation, req.checkpointId);
    if (!plan) {
      // Expected state — the checkpoint id is not on this conversation.
      return { conversationId: req.conversationId, checkpointId: req.checkpointId, found: false };
    }
    return {
      conversationId: plan.conversationId,
      checkpointId: plan.checkpointId,
      found: true,
      targetTurnIndex: plan.targetTurnIndex,
      changedFiles: plan.changedFiles,
      warnings: plan.warnings,
    };
  }

  /**
   * Search across conversation history (T-1301). Read-only and non-mutating:
   * delegates to the pure {@link searchConversations} via the live
   * {@link ConversationStore}, clamps the result count to a hard ceiling
   * ({@link MAX_CONVERSATION_SEARCH_RESULTS}) so a missing / oversized `limit`
   * cannot produce a huge NDJSON line, and projects the ranked hits onto the
   * wire. An empty / whitespace-only query returns no results (the pure scan
   * yields `[]` for it) — the IDE round-trips a cleared search box cleanly.
   *
   * Per the AI council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02):
   * global scope over every conversation on record (UNANIMOUS Q4=A), the full
   * {@link ConversationSummary} rides the wire because the history sidebar needs
   * the title + timestamps (UNANIMOUS Q1=A).
   */
  async search(req: ConversationSearchRequest): Promise<ConversationSearchResponse> {
    const cap = Math.min(
      req.limit ?? MAX_CONVERSATION_SEARCH_RESULTS,
      MAX_CONVERSATION_SEARCH_RESULTS,
    );
    const hits = await this.deps.store.search(req.query, { limit: cap });
    return {
      results: hits.map((hit) => ({
        summary: {
          id: hit.summary.id,
          title: hit.summary.title,
          ...(hit.summary.parentId !== undefined ? { parentId: hit.summary.parentId } : {}),
          messageCount: hit.summary.messageCount,
          checkpointCount: hit.summary.checkpointCount,
          createdAt: hit.summary.createdAt,
          updatedAt: hit.summary.updatedAt,
        },
        hitCount: hit.hitCount,
        ...(hit.snippet !== undefined ? { snippet: hit.snippet } : {}),
      })),
    };
  }

  /**
   * List conversations for the IDE's history sidebar (T-1301). Read-only and
   * non-mutating: delegates to the pure {@link ConversationStore.list} (already
   * sorted newest-`updatedAt`-first) via the live store, clamps the count to a
   * hard ceiling ({@link MAX_CONVERSATION_LIST_RESULTS}) so a workspace with
   * thousands of conversations cannot produce a huge NDJSON line, and projects
   * lightweight summaries (no message bodies) onto the wire. Complementary to
   * {@link search}, which needs a query and returns `[]` for an empty one.
   *
   * Per the AI council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02):
   * the split Q1 resolved to a hard ceiling (gemini B) for sibling-consistency
   * with `conversationSearch`; `total` carries the full count before the cap so
   * the sidebar can show "showing N of M" — `list` means "show everything", so
   * a silent truncation would hide history (split Q3 resolved to carry `total`).
   * The `ConversationSummary` wire DTO is reused unchanged (UNANIMOUS Q2=A).
   */
  async list(req: ConversationListRequest): Promise<ConversationListResponse> {
    const cap = Math.min(req.limit ?? MAX_CONVERSATION_LIST_RESULTS, MAX_CONVERSATION_LIST_RESULTS);
    const summaries = await this.deps.store.list();
    return {
      conversations: summaries.slice(0, cap).map((summary) => ({
        id: summary.id,
        title: summary.title,
        ...(summary.parentId !== undefined ? { parentId: summary.parentId } : {}),
        messageCount: summary.messageCount,
        checkpointCount: summary.checkpointCount,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      })),
      total: summaries.length,
    };
  }

  /**
   * Run one streamed turn. Emits `done:false` token envelopes via `emit` and
   * RETURNS the terminal `done:true` envelope. Never emits a terminal envelope
   * itself — the dispatcher owns exactly-once terminal emission.
   */
  async handleSend(messageId: string, req: ChatSendRequest, emit: EnvelopeSink): Promise<Envelope> {
    if (this.active.has(req.conversationId)) {
      throw new ChatBusyError(req.conversationId);
    }
    const token = new CancellationToken();
    this.active.set(req.conversationId, token);
    const startedAt = Date.now();
    try {
      // Persist the user turn (create the conversation on first use).
      const existing = await this.deps.store.load(req.conversationId);
      if (!existing) await this.deps.store.create({ id: req.conversationId });
      await this.deps.store.appendMessage(req.conversationId, {
        role: 'user',
        content: req.message,
      });

      // Build the request from the persisted history.
      const convo = await this.deps.store.load(req.conversationId);
      const messages: ChatMessage[] = (convo?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      // Monotonic per-conversation step index for the tracking trail (ADR-035):
      // the count of prior assistant turns persisted here is this turn's 0-based
      // index. Derived from persisted history → restart-safe, no process counter.
      const stepIndex = (convo?.messages ?? []).filter((m) => m.role === 'assistant').length;
      const backend = this.deps.resolveBackend(req.providerId);
      const model = this.deps.resolveModel(req.providerId);
      // Retrieve scoped context, then fold both the context block and the
      // workspace guidelines into the system prompt BEFORE building the request,
      // so the pre-send estimate below counts the full system block exactly once
      // (council trap: the estimate must not undercount what the model sees).
      // The context block is the `base`; guidelines prepend ahead of it.
      const annotations = await this.retrieveContext(req, token.signal);
      const injection = buildContextInjection(annotations);
      const load = this.deps.loadGuidelines;
      const system =
        load || injection.system || this.deps.loadRules
          ? await resolveSystemPrompt(
              injection.system,
              load ?? (async () => ''),
              this.deps.loadRules,
            )
          : undefined;
      const request: LlmRequest = {
        model,
        messages,
        max_tokens: this.deps.maxTokens ?? 2048,
        ...(system ? { system } : {}),
      };

      // Pre-flight (B1 + T-411a): count input tokens ONCE, emit the pre-send
      // estimate BEFORE the first token so the composer can show it while the
      // turn runs, AND evaluate the cost caps from the same projection. A
      // `block` verdict refuses the turn HERE — before the provider stream,
      // before any spend or step row (Q2=B). Best-effort otherwise — skipped if
      // pricing or a local token count is unavailable, never allowed to break
      // the turn. The range is captured in a TURN-LOCAL (never a handler field)
      // so the finalize-point reconciliation compares THIS turn's real cost
      // against THIS turn's estimate — no stale leakage across reused handlers.
      const preflight = await this.preflight(messageId, request, backend, model, emit);
      if (preflight.blocked && preflight.cap) {
        return this.blockedResponse(messageId, model, backend.mode, preflight.cap);
      }
      const estimateRange = preflight.range;

      let text = '';
      let usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
      let stopReason = 'end_turn';
      let streamError: { code: string; message: string } | undefined;

      try {
        for await (const event of backend.stream(request, token.signal)) {
          if (token.isCancelled) break;
          switch (event.kind) {
            case 'text_delta':
              text += event.text;
              emit({
                messageId,
                messageType: 'chatSend',
                data: { token: event.text },
                done: false,
              });
              break;
            case 'stop':
              usage = event.usage;
              stopReason = event.reason;
              break;
            case 'error':
              streamError = { code: event.code, message: event.message };
              break;
            default:
              // tool_use_* / thinking_delta — ignored in the provider-direct slice.
              break;
          }
          if (streamError) break;
        }
      } catch (err) {
        // A backend that throws on abort is a cancel, not an error.
        if (!token.isCancelled) throw err;
      }

      const cancelled = token.isCancelled;

      // A genuine backend error (not a user cancel) closes the stream as error.
      if (streamError && !cancelled) {
        throw new LlmStreamError(streamError.code, streamError.message);
      }
      if (cancelled) stopReason = 'cancelled';

      // Persist the assistant turn — partial text on cancel is kept by design.
      const stored = await this.deps.store.appendMessage(req.conversationId, {
        role: 'assistant',
        content: text,
      });

      const cost = this.computeCost(model, backend.mode, usage);
      // Record this turn's ACTUAL spend exactly once (B-inj). Reached on the
      // normal + cancel paths but NOT on a thrown backend error (which exits
      // above) — so an errored turn never debits the budget.
      const budget = await this.recordSpend(cost, req.conversationId, model);
      // Persist one priced step row for the Cost Dashboard (ADR-035). Same
      // finalize point + once semantics as recordSpend; fail-open.
      await this.recordStep({
        conversationId: req.conversationId,
        stepIndex,
        mode: backend.mode,
        model,
        stopReason,
        usage,
        cost,
        durationMs: Date.now() - startedAt,
      });
      // Reconcile real cost vs the pre-flight estimate (T-706). Same finalize
      // point + once-semantics as recordSpend/recordStep; skips a cancelled
      // turn and a turn with no estimate; fail-open.
      await this.maybeReconcile({
        conversationId: req.conversationId,
        estimate: estimateRange,
        cost,
        cancelled,
      });

      const response: ChatSendResponse = {
        messageId: stored?.id ?? messageId,
        text,
        usage: toWireUsage(usage),
        cost,
        cancelled,
        stopReason,
        ...(budget ? { budget } : {}),
        // EXACTLY the snippets folded into `system` (council trap: the wire
        // annotations must reflect what the model saw, not a budget-dropped
        // superset). Omitted when nothing was injected.
        ...(injection.used.length ? { annotations: injection.used } : {}),
      };
      return { messageId, messageType: 'chatSend', data: response, done: true };
    } finally {
      this.active.delete(req.conversationId);
    }
  }

  /**
   * Retrieve the scoped context snippets for this turn. No-op (→ `[]`) unless a
   * `retrieveContext` callback is injected and the scope is not `none`
   * (`none` = "no code context", short-circuited before any retrieval). The
   * omitted scope defaults to `all` (F1). Fail-open: a retrieval error degrades
   * to no context so a flaky index never breaks the chat turn — but a
   * user-initiated abort is RE-THROWN, never swallowed (the T-1305
   * fail-open-must-not-eat-Stop lesson).
   */
  private async retrieveContext(
    req: ChatSendRequest,
    signal: AbortSignal,
  ): Promise<ContextSnippetAnnotation[]> {
    const retrieve = this.deps.retrieveContext;
    if (!retrieve) return [];
    const scope: ContextScope = req.scope ?? { kind: 'all' };
    if (scope.kind === 'none') return [];
    try {
      return await retrieve(req.message, scope, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      return [];
    }
  }

  /**
   * Abort the in-flight turn for `conversationId`. Returns `true` if a turn was
   * found and signalled, `false` if nothing was running.
   */
  cancel(conversationId: string): boolean {
    const token = this.active.get(conversationId);
    if (!token) return false;
    void token.requestCancel();
    return true;
  }

  /**
   * Pre-flight a turn: count input tokens ONCE, emit the pre-send estimate
   * envelope, AND evaluate the cost caps (T-411a) from the same projection
   * (council Q6=A — reuse the one token count, never count twice).
   *
   * Returns `{ range?, cap?, blocked }`:
   *  - `blocked: true` (+ `cap`) when a `block` verdict fired — the caller
   *    refuses the turn; NO estimate event is emitted for a block (the turn is
   *    not running).
   *  - otherwise emits the estimate event (carrying `cap` for `warn`/`confirm`
   *    — Q1=A) and returns the {@link CostRange} so the finalize point can
   *    reconcile the real cost against it (T-706) without a second
   *    `countInputTokens` call (A2).
   *
   * No-op (→ not blocked, no event, `range` undefined) unless a pricing book, a
   * known model, and a local `countInputTokens` are all present. Fail-open: any
   * error here is swallowed (→ not blocked, no event) so the turn still runs —
   * a cap NEVER blocks on infrastructure failure, only on an explicit `block`
   * verdict (council Q6 trap).
   */
  private async preflight(
    messageId: string,
    request: LlmRequest,
    backend: LlmBackend,
    model: string,
    emit: EnvelopeSink,
  ): Promise<{ range?: CostRange; cap?: CapEvaluation; blocked: boolean }> {
    const pricing = this.deps.pricing;
    if (!pricing || !pricing.getModel(model) || !backend.countInputTokens) {
      return { blocked: false };
    }
    try {
      const inputTokens = await backend.countInputTokens(request);
      if (inputTokens === undefined) return { blocked: false };
      // The output cap MUST match `max_tokens` actually sent to the provider —
      // a drift makes the cap leaky / unauthoritative (council trap).
      const maxOutputTokens = request.max_tokens ?? 2048;
      const range = estimateCost(pricing, { model, inputTokens, maxOutputTokens });
      // Caps fail open INDEPENDENTLY of the estimate: an evaluator error (e.g. a
      // torn daily-spend read) must neither block the turn NOR suppress the
      // estimate event (council Q6 trap).
      const cap = await this.evaluateCaps(model, inputTokens, maxOutputTokens).catch(
        () => undefined,
      );
      if (cap?.verdict === 'block') {
        // A block refuses the turn — surface it on the terminal response, NOT
        // on a pre-send estimate event.
        return { cap, blocked: true };
      }
      const estimate: ChatEstimate = toWireEstimate(range);
      // Only `warn`/`confirm` ride the estimate event; `allow` is never surfaced.
      const wireCap =
        cap && (cap.verdict === 'warn' || cap.verdict === 'confirm') ? toWireCap(cap) : undefined;
      emit({
        messageId,
        messageType: 'chatSend',
        data: { estimate, ...(wireCap ? { cap: wireCap } : {}) },
        done: false,
      });
      return { range, cap, blocked: false };
    } catch {
      // Best-effort: a failed estimate / cap eval must never break or block the turn.
      return { blocked: false };
    }
  }

  /**
   * Evaluate the cost caps for the projected turn. No-op (→ `undefined`) unless
   * a {@link CapsEvaluator} is injected; the evaluator returns `allow` when no
   * `tracking.caps` thresholds are configured, so an absent config is inert.
   * Its own errors propagate to the fail-open `catch` in {@link preflight}.
   */
  private async evaluateCaps(
    model: string,
    inputTokens: number,
    outputCapTokens: number,
  ): Promise<CapEvaluation | undefined> {
    const evaluator = this.deps.capsEvaluator;
    if (!evaluator) return undefined;
    return evaluator.evaluate({
      input_tokens: inputTokens,
      output_cap_tokens: outputCapTokens,
      model,
    });
  }

  /**
   * Build the terminal response for a turn refused by a `block` cost cap
   * (council Q2=B): empty text, $0 cost, `stopReason: 'cost_cap_blocked'`, and
   * the verdict on `cap`. No assistant message is persisted and no spend / step
   * is recorded — the turn never ran (the user message stays on record).
   */
  private blockedResponse(
    messageId: string,
    model: string,
    mode: LlmMode,
    cap: CapEvaluation,
  ): Envelope {
    const response: ChatSendResponse = {
      messageId,
      text: '',
      usage: toWireUsage({ input_tokens: 0, output_tokens: 0 }),
      cost: this.computeCost(model, mode, { input_tokens: 0, output_tokens: 0 }),
      cancelled: false,
      stopReason: 'cost_cap_blocked',
      cap: toWireCap(cap),
    };
    return { messageId, messageType: 'chatSend', data: response, done: true };
  }

  /**
   * Reconcile the turn's real cost against its pre-flight estimate (T-706,
   * ADR-036, AI council 2026-06-02, UNANIMOUS A0–A6). No-op unless a
   * {@link CalibrationLog} is injected AND a pre-flight estimate range was
   * produced for this turn. A CANCELLED turn is skipped — its partial spend is
   * not a fair test of the estimate (A5). The raw `cost.totalUsd` is used
   * regardless of `isEstimate`, so cli shadow cost is reconciled too: drift is
   * a heuristic-accuracy signal, not a billing event (A4). The log itself only
   * appends an event when real cost overruns the estimate's upper bound by more
   * than its drift threshold. Fail-open: a write error never breaks the turn.
   */
  private async maybeReconcile(input: {
    conversationId: string;
    estimate: CostRange | undefined;
    cost: ChatCost;
    cancelled: boolean;
  }): Promise<void> {
    const log = this.deps.calibration;
    if (!log || !input.estimate || input.cancelled) return;
    try {
      await log.reconcile({
        conversationId: input.conversationId,
        estimate: input.estimate,
        realUsd: input.cost.totalUsd,
      });
    } catch {
      // Best-effort: a calibration write must never break the turn.
    }
  }

  /**
   * Record the turn's actual spend and return today's budget status. Records a
   * debit only for a real metered cost (`!isEstimate`, `> 0`); CLI shadow cost
   * and unpriced turns read status without debiting. Returns `undefined` when
   * no recorder is injected. Fail-open: a budget error never breaks the turn.
   */
  private async recordSpend(
    cost: ChatCost,
    conversationId: string,
    model: string,
  ): Promise<ChatBudgetStatus | undefined> {
    const recorder = this.deps.budget;
    if (!recorder) return undefined;
    try {
      const status =
        !cost.isEstimate && cost.totalUsd > 0
          ? await recorder.record(cost.totalUsd, { conversationId, model })
          : await recorder.status();
      return toWireBudget(status);
    } catch {
      return undefined;
    }
  }

  /**
   * Persist one priced step row for the turn (ADR-035). No-op unless a recorder
   * is injected AND a pricing book + known model supply the required positive
   * `pricing_book_version` (mirrors the estimate gate — an unpriced/unknown-model
   * turn has no version, so it is simply not tracked). `usd` is the recorded
   * book-rate cost (real for api, shadow for cli). Fail-open: a write error
   * never breaks the turn.
   */
  private async recordStep(input: {
    conversationId: string;
    stepIndex: number;
    mode: LlmMode;
    model: string;
    stopReason: string;
    usage: LlmUsage;
    cost: ChatCost;
    durationMs: number;
  }): Promise<void> {
    const recorder = this.deps.step;
    const pricing = this.deps.pricing;
    if (!recorder || !pricing || !pricing.getModel(input.model)) return;
    try {
      const event = buildStepEvent({
        conversationId: input.conversationId,
        stepIndex: input.stepIndex,
        activity: 'chat',
        mode: input.mode,
        model: input.model,
        stopReason: input.stopReason,
        usage: input.usage,
        usd: input.cost.totalUsd,
        pricingBookVersion: pricing.data.version,
        durationMs: input.durationMs,
      });
      await recorder.writeStep(event);
    } catch {
      // Best-effort: a tracking write must never break the turn.
    }
  }

  private computeCost(model: string, mode: LlmMode, usage: LlmUsage): ChatCost {
    if (!this.deps.pricing || !this.deps.pricing.getModel(model)) {
      return { model, mode, totalUsd: 0, isEstimate: true };
    }
    const breakdown = this.deps.pricing.costFor(model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_write_tokens: usage.cache_creation_input_tokens,
      cache_read_tokens: usage.cache_read_input_tokens,
    });
    // CLI mode is a flat subscription → the metered figure is a shadow estimate.
    return { model, mode, totalUsd: breakdown.total_usd, isEstimate: mode === 'cli' };
  }
}

function toWireEstimate(range: CostRange): ChatEstimate {
  return {
    model: range.model,
    inputTokens: range.inputTokens,
    lowerUsd: range.lowerUsd,
    upperUsd: range.upperUsd,
    typicalUsd: range.typicalUsd,
  };
}

/** Map a core {@link CapEvaluation} (snake_case) onto the wire `CapVerdict`. */
function toWireCap(e: CapEvaluation): CapVerdict {
  return {
    verdict: e.verdict,
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
    projectedUsd: e.projected_usd,
    ...(e.spent_today_usd !== undefined ? { spentTodayUsd: e.spent_today_usd } : {}),
  };
}

function toWireBudget(s: BudgetStatus): ChatBudgetStatus {
  return {
    date: s.date,
    spentUsd: s.spentUsd,
    limitUsd: s.limitUsd,
    remainingUsd: s.remainingUsd,
    ratio: s.ratio,
    overBudget: s.overBudget,
    warning: s.warning,
  };
}

function toWireUsage(u: LlmUsage): ChatUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    ...(u.cache_read_input_tokens !== undefined
      ? { cacheReadTokens: u.cache_read_input_tokens }
      : {}),
    ...(u.cache_creation_input_tokens !== undefined
      ? { cacheWriteTokens: u.cache_creation_input_tokens }
      : {}),
  };
}
