import type {
  ChatBudgetStatus,
  ChatCost,
  ChatEstimate,
  ChatSendRequest,
  ChatSendResponse,
  ChatUsage,
  ChatMessage,
  Envelope,
  LlmMode,
  LlmRequest,
  LlmUsage,
} from '@event4u-agent/protocol';
import type { BudgetRecorder, BudgetStatus } from '../cost/budget.js';
import { estimateCost, type CostRange } from '../cost/estimate.js';
import type { LlmBackend } from '../llm/backend.js';
import { LlmStreamError } from '../llm/backend.js';
import { CancellationToken } from '../llm/cancellation.js';
import type { PricingBook } from '../pricing/loader.js';
import type { ConversationStore } from './store.js';

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
  /** Output cap for the turn. Default 2048 (matches the `LlmRequest` default). */
  maxTokens?: number;
}

export class ChatHandler {
  /** In-flight cancellation tokens, keyed by `conversationId`. */
  private readonly active = new Map<string, CancellationToken>();

  constructor(private readonly deps: ChatHandlerDeps) {}

  /** Whether a turn is currently in flight for the conversation. */
  isActive(conversationId: string): boolean {
    return this.active.has(conversationId);
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
      const backend = this.deps.resolveBackend(req.providerId);
      const model = this.deps.resolveModel(req.providerId);
      const request: LlmRequest = {
        model,
        messages,
        max_tokens: this.deps.maxTokens ?? 2048,
      };

      // Pre-send estimate (B1): emit BEFORE the first token so the composer can
      // show it while the turn runs. Best-effort — skipped if pricing or a
      // local token count is unavailable, and never allowed to break the turn.
      await this.maybeEmitEstimate(messageId, request, backend, model, emit);

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

      const response: ChatSendResponse = {
        messageId: stored?.id ?? messageId,
        text,
        usage: toWireUsage(usage),
        cost,
        cancelled,
        stopReason,
        ...(budget ? { budget } : {}),
      };
      return { messageId, messageType: 'chatSend', data: response, done: true };
    } finally {
      this.active.delete(req.conversationId);
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
   * Emit the pre-send estimate as an early `done:false` envelope. No-op unless
   * a pricing book, a known model, and a local `countInputTokens` are all
   * present. Fail-open: any error here is swallowed so the turn still runs.
   */
  private async maybeEmitEstimate(
    messageId: string,
    request: LlmRequest,
    backend: LlmBackend,
    model: string,
    emit: EnvelopeSink,
  ): Promise<void> {
    const pricing = this.deps.pricing;
    if (!pricing || !pricing.getModel(model) || !backend.countInputTokens) return;
    try {
      const inputTokens = await backend.countInputTokens(request);
      if (inputTokens === undefined) return;
      const range = estimateCost(pricing, {
        model,
        inputTokens,
        maxOutputTokens: request.max_tokens ?? 2048,
      });
      const estimate: ChatEstimate = toWireEstimate(range);
      emit({ messageId, messageType: 'chatSend', data: { estimate }, done: false });
    } catch {
      // Best-effort: a failed estimate must never break the turn.
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
