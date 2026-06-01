import type {
  AgentTurnRequest,
  AgentTurnResponse,
  ChatBudgetStatus,
  ChatCost,
  ChatMessage,
  ChatUsage,
  ContentPart,
  Envelope,
  LlmMode,
  LlmRequest,
  LlmUsage,
  ToolCallEvent,
} from '@event4u-agent/protocol';
import type { EnvelopeSink } from '../chat/handler.js';
import type { ConversationStore } from '../chat/store.js';
import { resolveSystemPrompt, type LoadGuidelines } from '../chat/system-prompt.js';
import type { BudgetRecorder, BudgetStatus } from '../cost/budget.js';
import type { LlmBackend } from '../llm/backend.js';
import { LlmStreamError } from '../llm/backend.js';
import { CancellationToken } from '../llm/cancellation.js';
import type { AuditRecorder } from '../permissions/audit.js';
import type { PermissionDecision, PermissionGate } from '../permissions/gate.js';
import type { PricingBook } from '../pricing/loader.js';
import {
  previewArgs,
  runToolCallWithApproval,
  type ApprovalDecisionRequest,
  type ToolExecResult,
} from './approval.js';
import type { PreparedTool, ToolExecution, ToolRegistry } from './tool-registry.js';
import { toToolResultPart, type NormalizedToolCall } from '../tools/normalizer.js';

/**
 * `agentTurn` — the agentic chat turn (AI council 2026-06-01, UNANIMOUS forks
 * 1A/2A/3A/4A/5A/6A/7A/8A; ADR-023).
 *
 * Where {@link ChatHandler} runs ONE provider-direct turn and ignores tool
 * calls, this handler runs a bounded LLM↔tool loop so chat can actually edit
 * files: stream the model with the {@link ToolRegistry}'s tool definitions,
 * surface each tool-call through the {@link ToolCallEvent} lifecycle (approval
 * /diff/result), execute approved calls, feed every result back (including a
 * denied/blocked call as an `is_error` tool_result — fork 8A so the model can
 * recover), and loop until the model stops or `maxIterations` is reached.
 *
 * Contract mirrors {@link ChatHandler} (fork 5A): the handler emits only
 * `done:false` envelopes (a {@link ChatTokenEvent} `{token}` per text delta, an
 * {@link AgentToolEvent} `{toolEvent}` per lifecycle event) and RETURNS the
 * terminal `done:true` envelope — the dispatcher owns exactly-once terminal
 * emission. Cancellation reuses `chatCancel` keyed by `conversationId` (fork
 * 7A). The human approval `decide` is injected; the IDE round-trip that drives
 * it (approvalRequested out → approvalResolved in) is an IDE-runtime follow-up.
 *
 * Correctness guards (council traps): usage is aggregated once per iteration
 * and cost computed once at the end; a `maxIterations` cap stops a runaway loop
 * with `stopReason: 'max_iterations'`; a mid-tool cancel never feeds a
 * "successful" tool_result back; ContentPart tool turns live in memory only —
 * the string-only {@link ConversationStore} persists the final text + a compact
 * edit summary, no schema migration (fork 4A); an errored backend turn throws
 * before any spend is recorded so it never debits the budget.
 */

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_TOKENS = 2048;

/** Thrown when a second turn arrives while one is already in flight. */
export class AgentBusyError extends Error {
  readonly code = 'agent_busy';
  constructor(conversationId: string) {
    super(`An agent turn is already in flight for conversation "${conversationId}".`);
    this.name = 'AgentBusyError';
  }
}

export interface AgentTurnHandlerDeps {
  /** Resolve the backend for a turn. `providerId` is the per-request selector. */
  resolveBackend: (providerId?: string) => LlmBackend;
  /** Model id used for the request + cost. May depend on the resolved provider. */
  resolveModel: (providerId?: string) => string;
  /** Persistence for the conversation transcript (string-only). */
  store: ConversationStore;
  /** Permission gate evaluated per tool-call. */
  gate: PermissionGate;
  /** Tools advertised to the model + executed on approval. */
  registry: ToolRegistry;
  /** Resolve the human (or policy) decision when the gate says `ask`. */
  decide: (request: ApprovalDecisionRequest) => Promise<PermissionDecision>;
  /** Pricing book for turn cost. Absent / unknown model → a $0 estimate. */
  pricing?: PricingBook;
  /** Optional daily-budget recorder (records real-cost turns, surfaces status). */
  budget?: BudgetRecorder;
  /** Optional audit trail for hard-floor blocks + approval decisions. */
  audit?: AuditRecorder;
  /** Default iteration cap when the request omits `maxIterations`. Default 10. */
  maxIterations?: number;
  /** Per-iteration output cap. Default 2048. */
  maxTokens?: number;
  /** Optional system prompt prepended to every iteration (the base; workspace
   * guidelines from {@link loadGuidelines} are folded ahead of it per turn). */
  system?: string;
  /**
   * Optional workspace-guidelines loader (T-1307, AI council 2026-06-01,
   * UNANIMOUS A2/B1/C2/D1/E1/F1). When set, the guidelines are folded ahead of
   * {@link system} into the per-iteration prompt. Loaded ONCE per agent turn
   * (not per loop iteration — keeps instructions stable across the loop) and
   * fail-open (a loader error degrades to the base `system`).
   */
  loadGuidelines?: LoadGuidelines;
}

/** One LLM iteration's collected output. */
interface IterationResult {
  text: string;
  toolCalls: NormalizedToolCall[];
  usage: LlmUsage;
  reason?: string;
  streamError?: { code: string; message: string };
}

export class AgentTurnHandler {
  /** In-flight cancellation tokens, keyed by `conversationId`. */
  private readonly active = new Map<string, CancellationToken>();

  constructor(private readonly deps: AgentTurnHandlerDeps) {}

  /** Whether a turn is currently in flight for the conversation. */
  isActive(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  /** Abort the in-flight turn for `conversationId`; `true` if one was found. */
  cancel(conversationId: string): boolean {
    const token = this.active.get(conversationId);
    if (!token) return false;
    void token.requestCancel();
    return true;
  }

  /**
   * Run one agentic turn. Emits `done:false` token + tool envelopes via `emit`
   * and RETURNS the terminal `done:true` envelope (never emits it itself).
   */
  async handleTurn(
    messageId: string,
    req: AgentTurnRequest,
    emit: EnvelopeSink,
  ): Promise<Envelope> {
    if (this.active.has(req.conversationId)) {
      throw new AgentBusyError(req.conversationId);
    }
    const token = new CancellationToken();
    this.active.set(req.conversationId, token);
    try {
      const existing = await this.deps.store.load(req.conversationId);
      if (!existing) await this.deps.store.create({ id: req.conversationId });
      await this.deps.store.appendMessage(req.conversationId, {
        role: 'user',
        content: req.message,
      });

      // Working messages are ContentPart-aware (tool_use / tool_result) and live
      // only in memory; seed them from the persisted string transcript.
      const convo = await this.deps.store.load(req.conversationId);
      const messages: ChatMessage[] = (convo?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const backend = this.deps.resolveBackend(req.providerId);
      const model = this.deps.resolveModel(req.providerId);
      const toolDefs = this.deps.registry.definitions();
      const maxIterations = req.maxIterations ?? this.deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const maxTokens = this.deps.maxTokens ?? DEFAULT_MAX_TOKENS;
      // Compose the system prompt ONCE per turn (council trap: loading per
      // iteration could shift instructions mid-loop). Folds workspace
      // guidelines ahead of the static base `system`; fail-open to the base.
      const system = this.deps.loadGuidelines
        ? await resolveSystemPrompt(this.deps.system, this.deps.loadGuidelines)
        : this.deps.system;

      const aggUsage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
      const changedFiles: string[] = [];
      let finalText = '';
      let iterations = 0;
      let stopReason = 'end_turn';
      let completed = false;

      while (iterations < maxIterations) {
        iterations++;
        if (token.isCancelled) {
          stopReason = 'cancelled';
          completed = true;
          break;
        }

        const request: LlmRequest = {
          model,
          messages,
          max_tokens: maxTokens,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
          ...(system ? { system } : {}),
        };

        const iter = await this.streamIteration(request, backend, token, messageId, emit);
        addUsage(aggUsage, iter.usage);
        finalText = iter.text;

        // A genuine backend error (not a user cancel) ends the turn as error —
        // thrown before any spend is recorded (the budget never sees it).
        if (iter.streamError && !token.isCancelled) {
          throw new LlmStreamError(iter.streamError.code, iter.streamError.message);
        }
        if (token.isCancelled) {
          stopReason = 'cancelled';
          completed = true;
          break;
        }

        // Record the assistant turn (text + its tool_use parts) in memory.
        messages.push(assistantMessage(iter.text, iter.toolCalls));

        if (iter.toolCalls.length === 0) {
          stopReason = iter.reason ?? 'end_turn';
          completed = true;
          break;
        }

        // Execute every requested tool-call sequentially (council trap: ordered,
        // especially for write_files), feeding each result back to the model.
        const toolResults: ContentPart[] = [];
        for (const call of iter.toolCalls) {
          if (token.isCancelled) break;
          toolResults.push(await this.runOneTool(call, token, messageId, emit, changedFiles));
        }
        if (token.isCancelled) {
          stopReason = 'cancelled';
          completed = true;
          break;
        }
        messages.push({ role: 'user', content: toolResults });
      }

      if (!completed) stopReason = 'max_iterations';

      // Persist ONE assistant message: the final text + a compact edit summary.
      const transcript = composeTranscript(finalText, changedFiles);
      const stored = await this.deps.store.appendMessage(req.conversationId, {
        role: 'assistant',
        content: transcript,
      });

      const cost = this.computeCost(model, backend.mode, aggUsage);
      const budget = await this.recordSpend(cost, req.conversationId, model);

      const response: AgentTurnResponse = {
        messageId: stored?.id ?? messageId,
        text: finalText,
        usage: toWireUsage(aggUsage),
        cost,
        changedFiles,
        iterations,
        cancelled: token.isCancelled,
        stopReason,
        ...(budget ? { budget } : {}),
      };
      return { messageId, messageType: 'agentTurn', data: response, done: true };
    } finally {
      this.active.delete(req.conversationId);
    }
  }

  /** Stream one LLM iteration: emit text tokens, assemble tool calls. */
  private async streamIteration(
    request: LlmRequest,
    backend: LlmBackend,
    token: CancellationToken,
    messageId: string,
    emit: EnvelopeSink,
  ): Promise<IterationResult> {
    let text = '';
    let usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
    let reason: string | undefined;
    let streamError: { code: string; message: string } | undefined;
    const pending = new Map<string, { name: string; chunks: string[] }>();
    const toolCalls: NormalizedToolCall[] = [];

    try {
      for await (const event of backend.stream(request, token.signal)) {
        if (token.isCancelled) break;
        switch (event.kind) {
          case 'text_delta':
            text += event.text;
            emit({ messageId, messageType: 'agentTurn', data: { token: event.text }, done: false });
            break;
          case 'tool_use_start':
            pending.set(event.id, { name: event.name, chunks: [] });
            break;
          case 'tool_use_input_delta': {
            pending.get(event.id)?.chunks.push(event.json_delta);
            break;
          }
          case 'tool_use_end':
            toolCalls.push(finalizeCall(event, pending));
            break;
          case 'stop':
            usage = event.usage;
            reason = event.reason;
            break;
          case 'error':
            streamError = { code: event.code, message: event.message };
            break;
          default:
            // thinking_delta — ignored.
            break;
        }
        if (streamError) break;
      }
    } catch (err) {
      // A backend that throws on abort is a cancel, not an error.
      if (!token.isCancelled) throw err;
    }

    return { text, toolCalls, usage, reason, streamError };
  }

  /**
   * Drive one tool-call through gate + approval + exec, emit each lifecycle
   * event, aggregate changed files, and return the `tool_result` part fed back
   * to the model next iteration.
   */
  private async runOneTool(
    call: NormalizedToolCall,
    token: CancellationToken,
    messageId: string,
    emit: EnvelopeSink,
    changedFiles: string[],
  ): Promise<ContentPart> {
    const emitTool = (ev: ToolCallEvent): void =>
      emit({ messageId, messageType: 'agentTurn', data: { toolEvent: ev }, done: false });

    const tool = this.deps.registry.get(call.name);
    if (!tool) {
      const message = `unknown tool: ${call.name}`;
      emitTool({
        kind: 'started',
        id: call.id,
        name: call.name,
        argsPreview: previewArgs(call.input),
      });
      emitTool({ kind: 'error', id: call.id, message });
      return toToolResultPart(call, message, true);
    }

    let prepared: PreparedTool;
    try {
      prepared = await tool.prepare(call.input);
    } catch (err) {
      const message = `invalid tool input: ${errorMessage(err)}`;
      emitTool({
        kind: 'started',
        id: call.id,
        name: call.name,
        argsPreview: previewArgs(call.input),
      });
      emitTool({ kind: 'error', id: call.id, message });
      return toToolResultPart(call, message, true);
    }

    let execution: ToolExecution | undefined;
    let denied = false;
    let errorMsg: string | undefined;
    const exec = async (): Promise<ToolExecResult> => {
      execution = await prepared.execute(token.signal);
      return { ok: execution.ok, outputPreview: execution.outputPreview };
    };

    for await (const ev of runToolCallWithApproval(call, {
      gate: this.deps.gate,
      decide: this.deps.decide,
      exec,
      ...(prepared.review ? { review: prepared.review } : {}),
      signal: token.signal,
      ...(this.deps.audit ? { audit: this.deps.audit } : {}),
    })) {
      emitTool(ev);
      if (ev.kind === 'approvalResolved' && ev.decision === 'deny') denied = true;
      if (ev.kind === 'error') errorMsg = ev.message;
    }

    // Cancel-mid-tool trap: never feed a "successful" result back on cancel.
    if (token.isCancelled) return toToolResultPart(call, 'cancelled', true);
    if (execution) {
      if (execution.ok && execution.changedFiles) {
        for (const file of execution.changedFiles) {
          if (!changedFiles.includes(file)) changedFiles.push(file);
        }
      }
      return toToolResultPart(call, execution.output, !execution.ok);
    }
    if (denied) return toToolResultPart(call, 'permission denied by user', true);
    if (errorMsg) return toToolResultPart(call, errorMsg, true);
    return toToolResultPart(call, 'tool did not execute', true);
  }

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
    return { model, mode, totalUsd: breakdown.total_usd, isEstimate: mode === 'cli' };
  }
}

/** Build the assistant ChatMessage for the working history. */
function assistantMessage(text: string, toolCalls: NormalizedToolCall[]): ChatMessage {
  if (toolCalls.length === 0) return { role: 'assistant', content: text };
  const parts: ContentPart[] = [];
  if (text.length > 0) parts.push({ type: 'text', text });
  for (const call of toolCalls) {
    parts.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
  return { role: 'assistant', content: parts };
}

/** Assemble a `tool_use_end` event + its buffered deltas into a normalized call. */
function finalizeCall(
  event: { id: string; name: string; input?: unknown },
  pending: Map<string, { name: string; chunks: string[] }>,
): NormalizedToolCall {
  const slot = pending.get(event.id);
  if (!slot) return { id: event.id, name: event.name, input: event.input ?? {} };
  pending.delete(event.id);
  const merged = slot.chunks.join('');
  if (merged.trim().length === 0) return { id: event.id, name: event.name, input: {} };
  try {
    return { id: event.id, name: event.name, input: JSON.parse(merged) };
  } catch {
    return { id: event.id, name: event.name, input: { __parse_error__: true, raw: merged } };
  }
}

/** Final persisted transcript: the model's text + a compact edit summary. */
function composeTranscript(text: string, changedFiles: string[]): string {
  if (changedFiles.length === 0) return text;
  const summary = `\n\n[edited ${changedFiles.length} file(s): ${changedFiles.join(', ')}]`;
  return text.length > 0 ? `${text}${summary}` : summary.trimStart();
}

function addUsage(agg: LlmUsage, usage: LlmUsage): void {
  agg.input_tokens += usage.input_tokens;
  agg.output_tokens += usage.output_tokens;
  if (usage.cache_creation_input_tokens !== undefined) {
    agg.cache_creation_input_tokens =
      (agg.cache_creation_input_tokens ?? 0) + usage.cache_creation_input_tokens;
  }
  if (usage.cache_read_input_tokens !== undefined) {
    agg.cache_read_input_tokens =
      (agg.cache_read_input_tokens ?? 0) + usage.cache_read_input_tokens;
  }
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
