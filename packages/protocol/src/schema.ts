import { z } from 'zod';
import { LlmModeSchema } from './llm.js';

/**
 * Wire protocol — newline-delimited JSON (NDJSON) envelopes over stdio.
 *
 * Decision: custom NDJSON envelope `{ messageId, messageType, data, done }`
 * over `vscode-jsonrpc`, per ADR-003 and the Spike 0.3b streaming validation.
 * AI Council (gemini + codex/gpt-5, 2026-05-29) converged on this for the
 * MVP: minimal Kotlin-side dependency surface, validated streaming spike,
 * manual messageId correlation is a negligible cost at this scale.
 *
 * Every line on stdin/stdout is exactly one JSON-encoded {@link Envelope}.
 * - Request/response: client and server reuse the same `messageId`.
 * - Streaming: the server emits N envelopes with `done: false` and a final
 *   envelope with `done: true` carrying the same `messageId`.
 */
export const EnvelopeSchema = z.object({
  /** Correlation id. The response reuses the request's id. */
  messageId: z.string().min(1),
  /** Logical method or event name, e.g. `"ping"`, `"echo"`, `"token"`. */
  messageType: z.string().min(1),
  /** Method-specific payload. Validated per `messageType` by the handler. */
  data: z.unknown(),
  /** `true` on the terminal envelope of a request or a stream. */
  done: z.boolean(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

// --- ping ---------------------------------------------------------------

export const PingRequestSchema = z.object({});
export type PingRequest = z.infer<typeof PingRequestSchema>;

export const PingResponseSchema = z.object({
  result: z.literal('pong'),
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

// --- echo ---------------------------------------------------------------

export const EchoRequestSchema = z.object({
  text: z.string(),
});
export type EchoRequest = z.infer<typeof EchoRequestSchema>;

export const EchoResponseSchema = z.object({
  text: z.string(),
});
export type EchoResponse = z.infer<typeof EchoResponseSchema>;

// --- workspace folders (multi-project, road-to-multi-project Phase B) ----

/**
 * A project root the IDE window currently has open. The client enumerates
 * these automatically — VS Code workspace folders, JetBrains module content
 * roots — and reports them to the Core on connect and on every change. The
 * Core dedups and canonicalises them into its {@link WorkspaceRoot} model.
 */
export const WorkspaceFolderSchema = z.object({
  /** Primary identity. `file://…`, `vscode-remote://…`, etc. */
  uri: z.string().min(1),
  /** Client-supplied persistence key, stable across casing / relocation. */
  stableId: z.string().min(1),
  /** User-visible label (folder name, module name). */
  displayName: z.string(),
  /** Origin discriminator, e.g. `"folder"` (VS Code) or `"module"` (JetBrains). */
  kind: z.string(),
});
export type WorkspaceFolder = z.infer<typeof WorkspaceFolderSchema>;

/** Lifecycle state of a single root's index segment. */
export const RootIndexStateSchema = z.enum(['indexing', 'ready', 'error']);
export type RootIndexState = z.infer<typeof RootIndexStateSchema>;

/** Per-root index status the UI polls (T-MR11). */
export const RootIndexStatusSchema = z.object({
  stableId: z.string().min(1),
  state: RootIndexStateSchema,
  /** Files indexed so far. */
  fileCount: z.number().int().nonnegative(),
  /** Total files discovered for this root, when known. */
  totalFiles: z.number().int().nonnegative().nullable(),
  /** Error detail when `state === 'error'`. */
  message: z.string().nullable(),
});
export type RootIndexStatus = z.infer<typeof RootIndexStatusSchema>;

// --- connect handshake --------------------------------------------------

/**
 * Connection handshake. The client reports every root the IDE window has
 * open. An omitted / empty list is the legacy single-root fallback (a client
 * that predates multi-root support).
 */
export const ConnectRequestSchema = z.object({
  workspaceFolders: z.array(WorkspaceFolderSchema).default([]),
});
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>;

export const ConnectResponseSchema = z.object({
  ack: z.literal(true),
  /** The Core's deduplicated, canonicalised view of the roots. */
  roots: z.array(WorkspaceFolderSchema),
  /** Current per-root index status. */
  status: z.array(RootIndexStatusSchema),
});
export type ConnectResponse = z.infer<typeof ConnectResponseSchema>;

// --- workspaceFoldersChanged --------------------------------------------

/**
 * Delta notification, modelled as an ordinary request that returns an ack
 * (AI Council 2026-05-30: keep the protocol uniform request/response rather
 * than add a fire-and-forget notification concept for a solo-dev plugin).
 */
export const WorkspaceFoldersChangedRequestSchema = z.object({
  added: z.array(WorkspaceFolderSchema).default([]),
  /** stableIds of removed roots. */
  removed: z.array(z.string()).default([]),
});
export type WorkspaceFoldersChangedRequest = z.infer<typeof WorkspaceFoldersChangedRequestSchema>;

export const WorkspaceFoldersChangedResponseSchema = z.object({
  ack: z.literal(true),
  status: z.array(RootIndexStatusSchema),
});
export type WorkspaceFoldersChangedResponse = z.infer<typeof WorkspaceFoldersChangedResponseSchema>;

// --- rootStatus query (UI polls per-root index progress) ----------------

export const RootStatusRequestSchema = z.object({});
export type RootStatusRequest = z.infer<typeof RootStatusRequestSchema>;

export const RootStatusResponseSchema = z.object({
  status: z.array(RootIndexStatusSchema),
});
export type RootStatusResponse = z.infer<typeof RootStatusResponseSchema>;

// --- per-turn context scope (consumed in Phase C, T-MR13) ---------------

/**
 * Per-turn retrieval scope. Discriminated union (AI Council 2026-05-30:
 * an explicit `kind` tag avoids the omitted-vs-empty-array ambiguity that
 * a bare `rootIds?: string[]` would carry across TS + Kotlin):
 *  - `all`   — default; every enabled root.
 *  - `roots` — an explicit, non-empty root-ID set.
 *  - `none`  — "no code context".
 *
 * TS-only for now; its Kotlin DTO is codegen'd when the per-turn message
 * lands in Phase C (no Kotlin consumer exists in Phase B).
 */
export const ContextScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('roots'), rootIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('none') }),
]);
export type ContextScope = z.infer<typeof ContextScopeSchema>;

// --- message annotations (T-1308 context-snippet + code-suggestion seams) -

/**
 * Message annotations (SweepAI-derived `Message.annotations` contract;
 * `road-to-mvp-ui-design.md` § "Data + render contract" is the design
 * authority). An annotation is an artifact that rides on the turn that
 * produced it — NOT a separate UI channel. Modelled as a `kind`-tagged
 * discriminated union so the wire surface and the Kotlin sealed hierarchy
 * stay extensible (status rows land later) without a breaking reshuffle.
 *
 * Members shipped so far:
 *   - `context-snippet` (T-1308): data a future "Context Side Bar / SnippetBadge"
 *     renders — badge opacity, colour, hover-preview, search-add, click-to-open
 *     stay IDE-deferred.
 *   - `code-suggestion`: SweepAI `CodeMirrorSuggestionEditor` per-edit state
 *     machine (pending|processing|done|error). The editor render + per-suggestion
 *     stage/apply affordance stay IDE-deferred.
 *   - `status-row`: SweepAI "progress strings are first-class stream items" —
 *     one row per long-operation step (agent phase, or a non-phase op like
 *     indexing) with a pending|active|done|error lifecycle. The progress-bar /
 *     spinner render + live streaming stay IDE-deferred.
 */

/**
 * Coarse source classification driving the badge COLOUR. Derived
 * deterministically in core from the file path (see `classifySnippet` in
 * `@event4u-agent/core`); kept on the wire so VS Code and JetBrains never
 * drift on the rule.
 */
export const SnippetCategorySchema = z.enum(['source', 'test', 'docs', 'dependency']);
export type SnippetCategory = z.infer<typeof SnippetCategorySchema>;

/**
 * One retrieved code snippet in the current turn's context. `relevance` is a
 * core-normalized 0..1 score (min-max over the result set; a single result or
 * an all-equal set normalizes to `1`) — the IDE maps it to badge opacity with
 * its own floor, so the wire never carries a render decision. Line numbers are
 * carried verbatim from the chunk reference the Context Engine produced.
 */
export const ContextSnippetAnnotationSchema = z.object({
  kind: z.literal('context-snippet'),
  rootId: z.string(),
  filePath: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  relevance: z.number().min(0).max(1),
  category: SnippetCategorySchema,
  /** Bounded slice of the snippet (±context, capped) for an instant hover-preview. */
  preview: z.string(),
});
export type ContextSnippetAnnotation = z.infer<typeof ContextSnippetAnnotationSchema>;

/**
 * Lifecycle of one proposed code edit (SweepAI `CodeMirrorSuggestionEditor`
 * state machine, ported to the durable message model). `pending` = located,
 * not yet applied; `processing` = apply in flight; `done` = applied; `error` =
 * could not locate or apply. Core owns every transition (see
 * `transitionCodeSuggestion` in `@event4u-agent/core`); the wire carries only
 * the current value as a flat enum so VS Code and JetBrains stay thin renderers
 * (AI council 2026-06-01, B1 over a nested sub-union — the codegen emits flat
 * `kind`-discriminated variants only, and the reducer is the single writer of
 * the invariant).
 */
export const CodeSuggestionStateSchema = z.enum(['pending', 'processing', 'done', 'error']);
export type CodeSuggestionState = z.infer<typeof CodeSuggestionStateSchema>;

/**
 * One proposed code edit riding on the assistant turn that produced it. Durable
 * (re-rendered deterministically from the message), distinct from the transient
 * {@link ToolCallEventSchema} lifecycle stream (AI council A1: complementary, no
 * shared types). `diffPreview` is a bounded unified-diff slice (mirrors the
 * `context-snippet` bounded-preview discipline) so an old message renders without
 * an RPC round-trip; `errorMessage` is set only in the `error` state.
 */
export const CodeSuggestionAnnotationSchema = z.object({
  kind: z.literal('code-suggestion'),
  /** Stable per-turn id the IDE keys its stage/apply affordance off. */
  suggestionId: z.string().min(1),
  filePath: z.string(),
  state: CodeSuggestionStateSchema,
  /** Bounded unified-diff slice; empty when the edit never resolved to a diff. */
  diffPreview: z.string(),
  /** Populated only in the `error` state — why the edit could not be located/applied. */
  errorMessage: z.string().optional(),
});
export type CodeSuggestionAnnotation = z.infer<typeof CodeSuggestionAnnotationSchema>;

/**
 * Lifecycle of one status row (the SweepAI "progress strings are first-class
 * stream items" surface, ported to the durable message model). `pending` = not
 * started; `active` = the in-flight step; `done` = finished; `error` = failed.
 * Core owns every transition (see `transitionStatusRow` in `@event4u-agent/core`);
 * the wire carries only the current value as a flat enum so VS Code and JetBrains
 * stay thin renderers (AI council 2026-06-01, C1 `active` over reusing
 * code-suggestion's edit-specific `processing`).
 */
export const StatusRowStateSchema = z.enum(['pending', 'active', 'done', 'error']);
export type StatusRowState = z.infer<typeof StatusRowStateSchema>;

/**
 * Optional agent-pipeline phase a status row tracks, when it tracks one — the
 * five runnable phases (`done` is the driver-complete sentinel, never a row).
 * Carried on the wire so the IDE picks a phase icon deterministically (mirrors
 * `category` → colour on context-snippet). Omitted for non-phase long operations
 * such as background indexing (AI council 2026-06-01: optional `phase` resolves
 * the codex B1 / gemini B2 split — a generic builder, phase-keyed icons when known).
 */
export const StatusRowPhaseSchema = z.enum(['refine', 'plan', 'implement', 'verify', 'report']);
export type StatusRowPhase = z.infer<typeof StatusRowPhaseSchema>;

/**
 * One progress row riding on the assistant turn that produced it. Durable
 * (re-rendered deterministically from the message), distinct from the transient
 * {@link ToolCallEventSchema}/{@link TerminalEventSchema} streams (AI council A1:
 * the row state lives on the message; live streaming + the spinner render are the
 * IDE last-mile). `detail` carries the optional progress string ("Indexing
 * 4,238 / 21,500 files…") or, in the `error` state, the failure reason.
 */
export const StatusRowAnnotationSchema = z.object({
  kind: z.literal('status-row'),
  /** Stable per-turn id the reducer reconciles transient updates against. */
  statusId: z.string().min(1),
  /** Human-readable row text (e.g. "Implement"). */
  label: z.string(),
  state: StatusRowStateSchema,
  /** The pipeline phase this row tracks, when it tracks one. */
  phase: StatusRowPhaseSchema.optional(),
  /** Optional progress string, or the failure reason in the `error` state. */
  detail: z.string().optional(),
});
export type StatusRowAnnotation = z.infer<typeof StatusRowAnnotationSchema>;

export const AnnotationSchema = z.discriminatedUnion('kind', [
  ContextSnippetAnnotationSchema,
  CodeSuggestionAnnotationSchema,
  StatusRowAnnotationSchema,
]);
export type Annotation = z.infer<typeof AnnotationSchema>;

// --- live terminal (Phase 9, T-903) -------------------------------------

/**
 * Live PTY terminal wire schemas. Server→client push is modelled as a
 * long-lived `terminalSubscribe` STREAMING request (AI council 2026-05-31,
 * UNANIMOUS): the client subscribes with a `messageId`, the Core streams
 * {@link TerminalEventSchema} payloads with `done:false` on that id until the
 * session exits/disposes (`done:true`). No new fire-and-forget notification
 * concept — ADR-003's request/response uniformity stays intact. The Core maps
 * many subscribe `messageId`s to one session, so a reconnecting surface just
 * re-subscribes with `replayFromSeq`.
 */
export const TerminalStatusSchema = z.enum(['pending', 'running', 'waiting-input', 'done']);
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;

/** One chunk of raw (ANSI-intact) PTY output; `seq` is monotonic per session. */
export const OutputChunkSchema = z.object({
  seq: z.number().int().nonnegative(),
  data: z.string(),
  at: z.string(),
});
export type OutputChunk = z.infer<typeof OutputChunkSchema>;

/** A discrete input request the session is blocked on (first-write-wins scope). */
export const PendingInputSchema = z.object({
  inputRequestId: z.string().min(1),
  prompt: z.string(),
  at: z.string(),
});
export type PendingInput = z.infer<typeof PendingInputSchema>;

/** Replay window returned on subscribe / reconnect. */
export const ReplaySliceSchema = z.object({
  chunks: z.array(OutputChunkSchema),
  droppedChunks: z.number().int().nonnegative(),
  droppedBytes: z.number().int().nonnegative(),
  firstSeqAvailable: z.number().int().nonnegative(),
  nextSeq: z.number().int().nonnegative(),
  /** Requested seq fell behind the buffer window → renderer cold-boots. */
  restartRequired: z.boolean(),
});
export type ReplaySlice = z.infer<typeof ReplaySliceSchema>;

/** The typed event union streamed on the subscribe channel. */
export const TerminalEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('output'), commandId: z.string().min(1), chunk: OutputChunkSchema }),
  z.object({
    kind: z.literal('status'),
    commandId: z.string().min(1),
    status: TerminalStatusSchema,
  }),
  z.object({
    kind: z.literal('inputRequested'),
    commandId: z.string().min(1),
    pending: PendingInputSchema,
  }),
  z.object({
    kind: z.literal('inputConflict'),
    commandId: z.string().min(1),
    inputRequestId: z.string().min(1),
    winningSurfaceId: z.string().min(1),
    losingSurfaceId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('exit'),
    commandId: z.string().min(1),
    exitCode: z.number().int(),
    signal: z.number().int().optional(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('error'), commandId: z.string().min(1), message: z.string() }),
]);
export type TerminalEvent = z.infer<typeof TerminalEventSchema>;

// terminalSubscribe — long-lived streaming request.
export const TerminalSubscribeRequestSchema = z.object({
  commandId: z.string().min(1),
  surfaceId: z.string().min(1),
  /** Replay from this seq; default 0 = full snapshot. */
  replayFromSeq: z.number().int().nonnegative().default(0),
});
export type TerminalSubscribeRequest = z.infer<typeof TerminalSubscribeRequestSchema>;

/** First envelope of the subscribe stream — the replay + current state. */
export const TerminalSubscribeResponseSchema = z.object({
  subscriptionId: z.string().min(1),
  status: TerminalStatusSchema,
  pendingInput: PendingInputSchema.nullable(),
  replay: ReplaySliceSchema,
});
export type TerminalSubscribeResponse = z.infer<typeof TerminalSubscribeResponseSchema>;

// terminalInput — write to stdin (raw, or answer a pending request).
export const TerminalInputRequestSchema = z.object({
  commandId: z.string().min(1),
  surfaceId: z.string().min(1),
  data: z.string(),
  /** The pending request being answered; omit for a raw write. */
  inputRequestId: z.string().min(1).optional(),
});
export type TerminalInputRequest = z.infer<typeof TerminalInputRequestSchema>;

export const TerminalInputResponseSchema = z.object({
  accepted: z.boolean(),
  /** Set when rejected by first-write-wins arbitration. */
  reason: z.enum(['no-session', 'session-done', 'already-submitted', 'stale-request']).optional(),
  winningSurfaceId: z.string().min(1).optional(),
});
export type TerminalInputResponse = z.infer<typeof TerminalInputResponseSchema>;

// terminalResize — resize the PTY.
export const TerminalResizeRequestSchema = z.object({
  commandId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalResizeRequest = z.infer<typeof TerminalResizeRequestSchema>;

export const TerminalResizeResponseSchema = z.object({
  ack: z.boolean(),
});
export type TerminalResizeResponse = z.infer<typeof TerminalResizeResponseSchema>;

// --- chat send / cancel (vertical slice, T-VS01 / T-VS02) ---------------

/**
 * Chat-RPC streaming method. `chatSend` drives an LLM backend and streams the
 * assistant's answer back over the NDJSON envelope, modelled on the
 * `terminalSubscribe` precedent (one `messageId`, N `done:false` chunks, a
 * terminal `done:true`). Each `done:false` envelope carries a
 * {@link ChatTokenEvent}; the terminal `done:true` carries a
 * {@link ChatSendResponse} with the full text, token usage, and turn cost.
 *
 * Wire payloads are camelCase and decoupled from the Core-internal snake_case
 * `LlmUsage` — the handler maps between them — so the Kotlin DTO codegen needs
 * no `@SerialName` and stays consistent with the rest of the protocol.
 *
 * Design ratified by AI council (codex-cli 0.134.0 + gemini 0.41.2,
 * 2026-05-31, UNANIMOUS): additive `emit`-callback streaming on the dispatcher
 * (request/response contract preserved), cancellation keyed by
 * `conversationId`, provider-direct turn for the slice (the multi-step
 * `AgentDriver` folds in later), and partial text kept + persisted on a
 * mid-stream cancel.
 */

/**
 * Per-turn token usage on the wire. camelCase; the Core maps its internal
 * snake_case `LlmUsage` to this shape.
 */
export const ChatUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});
export type ChatUsage = z.infer<typeof ChatUsageSchema>;

/**
 * The single turn-cost shape both clients only FORMAT — no per-client cost
 * math (Phase 4 / T-VS12 pins this as the source of truth).
 */
export const ChatCostSchema = z.object({
  model: z.string(),
  /** `api` = real metered cost · `cli` = shadow (would-have-cost-on-API). */
  mode: LlmModeSchema,
  totalUsd: z.number().nonnegative(),
  /** `true` when the figure is an estimate: CLI shadow cost, or no pricing book. */
  isEstimate: z.boolean(),
});
export type ChatCost = z.infer<typeof ChatCostSchema>;

export const ChatSendRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string(),
  /** Provider/backend selector; omitted = the Core's default. */
  providerId: z.string().min(1).optional(),
  /**
   * Per-turn retrieval scope; omitted = default (`all`). Honoured by the chat
   * turn (T-MR13): the resolved scope drives which indexed roots the Context
   * Engine retrieves from, and the retrieved snippets are folded into the
   * turn's system prompt + surfaced on {@link ChatSendResponseSchema}.
   */
  scope: ContextScopeSchema.optional(),
});
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;

/** Data of each `done:false` envelope: one streamed assistant token. */
export const ChatTokenEventSchema = z.object({
  token: z.string(),
});
export type ChatTokenEvent = z.infer<typeof ChatTokenEventSchema>;

/**
 * Pre-send cost estimate for a turn (T-PRD06). A range — not a false-precise
 * single number — since output length and cache state are unknown before the
 * turn runs. The Core computes it from `countInputTokens` + the pricing book.
 */
export const ChatEstimateSchema = z.object({
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  lowerUsd: z.number().nonnegative(),
  upperUsd: z.number().nonnegative(),
  typicalUsd: z.number().nonnegative(),
});
export type ChatEstimate = z.infer<typeof ChatEstimateSchema>;

/**
 * Data of an early `done:false` envelope carrying the pre-send estimate
 * (AI council 2026-06-01 fork B1: emit before the first token so the composer
 * can show the estimate while the turn runs, not as post-hoc metadata). The
 * Core emits at most one of these, before the first {@link ChatTokenEvent}.
 * Clients tell the two `done:false` shapes apart by key presence
 * (`estimate` vs `token`).
 */
export const ChatEstimateEventSchema = z.object({
  estimate: ChatEstimateSchema,
});
export type ChatEstimateEvent = z.infer<typeof ChatEstimateEventSchema>;

/**
 * Daily-budget status the composer footer renders (T-PRD06). Mirrors the Core
 * `BudgetStatus`. `limitUsd`/`remainingUsd`/`ratio` are `null` when no daily
 * budget is configured. `overBudget` is informational — the hard-cap confirm
 * dialog is an IDE concern (AI council fork B-warn: the Core flags, never blocks).
 */
export const ChatBudgetStatusSchema = z.object({
  /** `YYYY-MM-DD` the figures are for. */
  date: z.string(),
  spentUsd: z.number().nonnegative(),
  limitUsd: z.number().nullable(),
  remainingUsd: z.number().nullable(),
  ratio: z.number().nullable(),
  overBudget: z.boolean(),
  /** `ratio >= warning threshold` — the soft "approaching budget" signal. */
  warning: z.boolean(),
});
export type ChatBudgetStatus = z.infer<typeof ChatBudgetStatusSchema>;

/** Data of the terminal `done:true` envelope: the full turn result. */
export const ChatSendResponseSchema = z.object({
  /** Stable id of the persisted assistant message. */
  messageId: z.string().min(1),
  /** The full assistant text (partial if `cancelled`). */
  text: z.string(),
  usage: ChatUsageSchema,
  cost: ChatCostSchema,
  /** `true` when the turn was aborted mid-stream by `chatCancel`. */
  cancelled: z.boolean(),
  /** LLM stop reason, or `cancelled` on abort. */
  stopReason: z.string(),
  /**
   * Daily-budget status after this turn's spend, when a budget recorder is
   * configured. Absent when none is wired (backward-compatible additive field).
   */
  budget: ChatBudgetStatusSchema.optional(),
  /**
   * Context-snippet annotations for the snippets the Context Engine retrieved
   * for this turn and folded into the model's system prompt (T-MR13). These are
   * EXACTLY the snippets the model saw — the IDE renders them as SnippetBadges.
   * Absent / empty when no retriever is wired, the scope is `none`, or the
   * index yielded nothing. Turn-local: not persisted onto the stored message
   * this slice (additive optional field).
   */
  annotations: z.array(ContextSnippetAnnotationSchema).optional(),
});
export type ChatSendResponse = z.infer<typeof ChatSendResponseSchema>;

export const ChatCancelRequestSchema = z.object({
  conversationId: z.string().min(1),
});
export type ChatCancelRequest = z.infer<typeof ChatCancelRequestSchema>;

export const ChatCancelResponseSchema = z.object({
  /** `true` if an in-flight turn was found and aborted; `false` if nothing was running. */
  cancelled: z.boolean(),
});
export type ChatCancelResponse = z.infer<typeof ChatCancelResponseSchema>;

// --- tool-call lifecycle + approval (product-readiness Phase 1) ----------

/**
 * The streamed tool-call lifecycle, surfaced to the IDE as approval / diff /
 * result cards (T-PRD01 / T-PRD02 / T-PRD04). One discriminated union — not a
 * separate diff-review channel — so a card's whole story stays keyed to one
 * tool-call `id` (AI council 2026-05-31, codex-cli 0.134.0 + gemini 0.41.2,
 * UNANIMOUS): multi-file diffs ride inside `approvalRequested.review` rather
 * than a parallel `DiffReviewEvent` that the client would have to correlate.
 *
 * camelCase wire shape, modelled on {@link TerminalEventSchema}. The Core
 * orchestrates the lifecycle in `agent/approval.ts`; the transport that
 * streams these to the client is intentionally NOT wired in this slice (the
 * multi-step agent turn that emits them folds into the dispatcher later) —
 * the union + core + Kotlin codegen ship first, exactly like the terminal and
 * chat seams did.
 */

/** One file in a multi-file diff the user reviews before it is written. */
export const ReviewFileSchema = z.object({
  /** Workspace-relative, forward-slash path. */
  path: z.string().min(1),
  /** Unified diff for this file. */
  diff: z.string(),
  isNewFile: z.boolean(),
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

/**
 * Optional structured review payload carried by `approvalRequested`. `diff` is
 * the only kind today (a multi-file `write_files` plan); future kinds (e.g. a
 * shell-command preview) extend this union without widening the event itself.
 */
export const ToolReviewSchema = z.object({
  kind: z.literal('diff'),
  files: z.array(ReviewFileSchema),
});
export type ToolReview = z.infer<typeof ToolReviewSchema>;

/** Wire mirror of the gate's two "ask" levels (core `PermissionLevel`). */
export const ApprovalLevelSchema = z.enum(['requires_diff_approval', 'requires_approval']);
export type ApprovalLevel = z.infer<typeof ApprovalLevelSchema>;

/** Wire mirror of the core `PermissionDecision`. */
export const ApprovalDecisionSchema = z.enum(['allow_once', 'always', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** The typed tool-call lifecycle union, discriminated on `kind`. */
export const ToolCallEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('started'),
    id: z.string().min(1),
    name: z.string().min(1),
    /** Truncated, human-readable preview of the call arguments. */
    argsPreview: z.string(),
  }),
  z.object({
    kind: z.literal('approvalRequested'),
    id: z.string().min(1),
    level: ApprovalLevelSchema,
    /** Why the gate is asking, when it can say. */
    riskReason: z.string().optional(),
    /** Present for diff-approval tools; the per-file diff the user reviews. */
    review: ToolReviewSchema.optional(),
  }),
  z.object({
    kind: z.literal('approvalResolved'),
    id: z.string().min(1),
    decision: ApprovalDecisionSchema,
  }),
  z.object({
    kind: z.literal('result'),
    id: z.string().min(1),
    ok: z.boolean(),
    /** Truncated, human-readable preview of the tool output. */
    outputPreview: z.string(),
  }),
  z.object({ kind: z.literal('error'), id: z.string().min(1), message: z.string() }),
]);
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

// --- agent turn: chat that edits files (product-readiness) ---------------

/**
 * The agentic chat turn (`agentTurn`) — the seam that lets chat actually run
 * tools and edit files, as opposed to the provider-direct single turn of
 * `chatSend`. The Core runs a bounded LLM↔tool loop: stream the model, surface
 * each tool-call through the {@link ToolCallEventSchema} lifecycle (approval /
 * diff / result cards), execute approved calls, feed the result back, and loop
 * until the model stops or `maxIterations` is hit.
 *
 * Streaming mirrors `chatSend`: N `done:false` envelopes (each an
 * {@link AgentToolEvent} or a {@link ChatTokenEvent}) then one terminal
 * `done:true` carrying an {@link AgentTurnResponse}. The dispatcher owns the
 * single terminal envelope. Cancellation reuses `chatCancel` keyed by
 * `conversationId` (one cancel surface per conversation).
 *
 * Design ratified by AI council (codex-cli 0.134.0 + gemini 0.41.2,
 * 2026-06-01, UNANIMOUS forks 1A/2A/3A/4A/5A/6A/7A/8A): a dedicated method +
 * standalone handler, an injectable tool registry (read + write tools), a
 * bounded sequential loop, string-only persistence (no store migration), and
 * denied/blocked tool calls fed back as `is_error` tool results so the model
 * can recover or explain. The IDE approval round-trip that drives `decide`
 * stays an IDE-runtime follow-up, exactly like the chat + tool-card seams.
 */
export const AgentTurnRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string(),
  /** Provider/backend selector; omitted = the Core's default. */
  providerId: z.string().min(1).optional(),
  /** Upper bound on LLM↔tool iterations; omitted = the Core default (10). */
  maxIterations: z.number().int().positive().optional(),
  /**
   * Per-turn retrieval scope; omitted = default (`all`). Honoured by the agent
   * turn (T-MR13) exactly like {@link ChatSendRequestSchema}: the resolved scope
   * drives which indexed roots the Context Engine retrieves from, and the
   * snippets are folded ONCE into the turn's system prompt (ahead of the loop)
   * + surfaced on {@link AgentTurnResponseSchema}. `none` short-circuits.
   */
  scope: ContextScopeSchema.optional(),
});
export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;

/**
 * Data of a `done:false` envelope carrying one tool-call lifecycle event.
 * Clients tell the three `done:false` shapes apart by key presence
 * (`token` vs `estimate` vs `toolEvent`).
 */
export const AgentToolEventSchema = z.object({
  toolEvent: ToolCallEventSchema,
});
export type AgentToolEvent = z.infer<typeof AgentToolEventSchema>;

/** Data of the terminal `done:true` envelope: the full agent-turn result. */
export const AgentTurnResponseSchema = z.object({
  /** Stable id of the persisted assistant message. */
  messageId: z.string().min(1),
  /** The model's final assistant text, after all tool calls. */
  text: z.string(),
  usage: ChatUsageSchema,
  cost: ChatCostSchema,
  /** Workspace-relative paths edited across all iterations, first-seen order. */
  changedFiles: z.array(z.string()),
  /** Number of LLM iterations the loop ran. */
  iterations: z.number().int().nonnegative(),
  /** `true` when the turn was aborted mid-loop by `chatCancel`. */
  cancelled: z.boolean(),
  /** `end_turn` · `max_iterations` · `cancelled` · or the model's stop reason. */
  stopReason: z.string(),
  /** Daily-budget status after this turn's spend, when a recorder is configured. */
  budget: ChatBudgetStatusSchema.optional(),
  /**
   * Context-snippet annotations for the snippets the Context Engine retrieved
   * for this turn and folded ONCE into the model's system prompt (T-MR13),
   * mirroring {@link ChatSendResponseSchema}. EXACTLY the snippets the model
   * saw at the start of the loop — the IDE renders them as SnippetBadges. NOTE:
   * these reflect PRE-edit file state; the loop's `tool_result` history carries
   * the authoritative post-edit state. Absent / empty when no retriever is
   * wired, the scope is `none`, or the index yielded nothing. Turn-local.
   */
  annotations: z.array(ContextSnippetAnnotationSchema).optional(),
});
export type AgentTurnResponse = z.infer<typeof AgentTurnResponseSchema>;

// --- git loop (product-readiness Phase 4 transport) ---------------------

/**
 * The git-loop RPC surface (T-PRD14/15/16 transport). Exposes the shipped
 * pure-core builders (`git/commit-message.ts`, `pr-description.ts`,
 * `review-summary.ts`) as full-turn methods: the Core reads the diff, runs the
 * provider, and returns the PARSED / SANITISED result — never a raw model reply
 * (AI council 2026-05-31, codex-cli 0.134.0 + gemini 0.41.2, UNANIMOUS forks
 * A1/B1/C1/D1/E1/F1). The Core NEVER commits or opens a PR — it returns
 * editable text the IDE card surfaces. The card render itself stays IDE-runtime.
 */

/** Which diff a git method reasons over. `range` requires `base`. */
export const GitDiffSourceSchema = z.enum(['staged', 'unstaged', 'range']);
export type GitDiffSource = z.infer<typeof GitDiffSourceSchema>;

/** Wire mirror of the core `ParsedCommitMessage` (`git/commit-message.ts`). */
export const GitCommitMessageSchema = z.object({
  type: z.string(),
  scope: z.string().optional(),
  breaking: z.boolean(),
  subject: z.string(),
  body: z.string().optional(),
});
export type GitCommitMessage = z.infer<typeof GitCommitMessageSchema>;

export const GitCommitMessageRequestSchema = z.object({
  /** Workspace root the diff is read from (F1 — cwd on the wire, multi-root ready). */
  cwd: z.string().min(1),
  /** Default `staged`. */
  source: GitDiffSourceSchema.optional(),
  /** Required when `source === 'range'`. */
  base: z.string().min(1).optional(),
  /** Defaults to `HEAD` for a range. */
  head: z.string().min(1).optional(),
  /** Current branch — surfaced as context only. */
  branch: z.string().optional(),
  /** Provider/backend selector; omitted = the Core's default. */
  providerId: z.string().min(1).optional(),
  /** Free-text steer appended to the turn. */
  extraInstruction: z.string().optional(),
});
export type GitCommitMessageRequest = z.infer<typeof GitCommitMessageRequestSchema>;

/**
 * Single terminal result (C1): the parsed message + its assembled text on
 * success, or the structured parse errors after the bounded re-prompt (D1).
 */
export const GitCommitMessageResponseSchema = z.object({
  ok: z.boolean(),
  /** The parsed message when `ok`, else `null`. */
  message: GitCommitMessageSchema.nullable(),
  /** The assembled commit-message text (header + body) for the editor; `''` when not ok. */
  text: z.string(),
  /** Parse/validation errors when `!ok`; empty when ok. */
  errors: z.array(z.string()),
  /** How many model attempts were made (≥ 1). */
  attempts: z.number().int().nonnegative(),
});
export type GitCommitMessageResponse = z.infer<typeof GitCommitMessageResponseSchema>;

export const GitPrDescriptionRequestSchema = z.object({
  cwd: z.string().min(1),
  /** The target / merge-base ref (e.g. `main`) — the PR is `base..head`. */
  base: z.string().min(1),
  /** Defaults to `HEAD`. */
  head: z.string().min(1).optional(),
  branch: z.string().optional(),
  providerId: z.string().min(1).optional(),
  extraInstruction: z.string().optional(),
});
export type GitPrDescriptionRequest = z.infer<typeof GitPrDescriptionRequestSchema>;

/** Sanitised PR draft — house rules already enforced in core (C1). */
export const GitPrDescriptionResponseSchema = z.object({
  /** Editable title candidate, sanitised (emoji-free, attribution stripped). */
  title: z.string(),
  /** Sanitised PR body (GitHub-flavoured Markdown). */
  body: z.string(),
  /** Human-readable notes on what the sanitiser stripped (empty → nothing). */
  warnings: z.array(z.string()),
  /** Total commits in `base..head` (before the readCommitLog cap). */
  commitCount: z.number().int().nonnegative(),
  /** `true` when older commits were dropped to bound the prompt. */
  truncated: z.boolean(),
});
export type GitPrDescriptionResponse = z.infer<typeof GitPrDescriptionResponseSchema>;

/** Exhaustive per-severity finding count (every severity present, 0 when none). */
export const GitSeverityCountSchema = z.object({
  severity: z.string(),
  count: z.number().int().nonnegative(),
});
export type GitSeverityCount = z.infer<typeof GitSeverityCountSchema>;

/**
 * Minimal wire view of one review finding (E1 — the full internal `ReviewIssue`
 * carries votes/confidence/proposedFix that stay out of the protocol).
 */
export const GitReviewFindingSchema = z.object({
  file: z.string(),
  /** 1-based line, or `null` when the finding is file-level. */
  line: z.number().int().nullable(),
  severity: z.string(),
  category: z.string(),
  description: z.string(),
});
export type GitReviewFinding = z.infer<typeof GitReviewFindingSchema>;

export const GitReviewSummaryRequestSchema = z.object({
  cwd: z.string().min(1),
  /** Default `unstaged` (matches `runReview`). */
  source: GitDiffSourceSchema.optional(),
  base: z.string().min(1).optional(),
  head: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
});
export type GitReviewSummaryRequest = z.infer<typeof GitReviewSummaryRequestSchema>;

/** Wire mirror of the core `ChangeSummary` (`git/review-summary.ts`). */
export const GitReviewSummaryResponseSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  findingsBySeverity: z.array(GitSeverityCountSchema),
  totalFindings: z.number().int().nonnegative(),
  potentialFindings: z.number().int().nonnegative(),
  topFindings: z.array(GitReviewFindingSchema),
});
export type GitReviewSummaryResponse = z.infer<typeof GitReviewSummaryResponseSchema>;

// --- method registry ----------------------------------------------------

/**
 * Canonical list of request/response methods exposed by the Agent Core.
 * Each entry pairs the request and response payload schemas so a generic
 * dispatcher can validate both ends from one source of truth.
 */
export const Methods = {
  ping: { request: PingRequestSchema, response: PingResponseSchema },
  echo: { request: EchoRequestSchema, response: EchoResponseSchema },
  connect: { request: ConnectRequestSchema, response: ConnectResponseSchema },
  workspaceFoldersChanged: {
    request: WorkspaceFoldersChangedRequestSchema,
    response: WorkspaceFoldersChangedResponseSchema,
  },
  rootStatus: { request: RootStatusRequestSchema, response: RootStatusResponseSchema },
  terminalSubscribe: {
    request: TerminalSubscribeRequestSchema,
    response: TerminalSubscribeResponseSchema,
  },
  terminalInput: { request: TerminalInputRequestSchema, response: TerminalInputResponseSchema },
  terminalResize: { request: TerminalResizeRequestSchema, response: TerminalResizeResponseSchema },
  chatSend: { request: ChatSendRequestSchema, response: ChatSendResponseSchema },
  chatCancel: { request: ChatCancelRequestSchema, response: ChatCancelResponseSchema },
  agentTurn: { request: AgentTurnRequestSchema, response: AgentTurnResponseSchema },
  gitCommitMessage: {
    request: GitCommitMessageRequestSchema,
    response: GitCommitMessageResponseSchema,
  },
  gitPrDescription: {
    request: GitPrDescriptionRequestSchema,
    response: GitPrDescriptionResponseSchema,
  },
  gitReviewSummary: {
    request: GitReviewSummaryRequestSchema,
    response: GitReviewSummaryResponseSchema,
  },
} as const;

export type MethodName = keyof typeof Methods;

export const MethodNameSchema = z.enum(Object.keys(Methods) as [MethodName, ...MethodName[]]);

/** An error envelope payload, used when a handler throws. */
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
