---
adr: 025
title: Scoped-Context Retrieval in the Chat Turn — Wire ChatSendRequest.scope into Retrieval + System-Prompt Injection (Injected Callback, Coordinator-Owned Scope Resolution, Both Model-Visible and Wire-Surfaced, Turn-Local, Fail-Open-but-Abort-Propagating)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-06-01 scoped-context-wiring design round — UNANIMOUS on all six forks A1/B1/C1/D1/E1/F1; both reviewers independently flagged the estimate-undercount, total-system-block-cap, abort-threading, and roots-filtered-to-empty-must-not-widen traps)
related: road-to-multi-project Phase C T-MR13 (per-turn scoping — resolveContextScope shipped pure ahead of the wire) + Phase A T-MR05 (scoped retrieve consumer); road-to-product-readiness T-PRD09 (per-turn context chips — ContextScope codegen + ChatSendRequest.scope shipped in ADR-014); road-to-v1-0 T-1308 (context-snippet annotations + retrieveContextSnippets shipped in ADR-019); extends the chat-RPC handler (ADR-010) + its cost/budget (ADR-022) + guidelines (ADR-024) wiring; the SnippetBadge + scope-picker render stays the IDE last-mile
date: 2026-06-01
---

# ADR-025 — Scoped-Context Retrieval in the Chat Turn

## Status

**Proposed** — discharges the core retrieve-consumer half of T-MR13 and the
"actually honour `scope` in a turn" half of T-PRD09. Three primitives shipped
ahead of the wire with ZERO production callers:

- `resolveContextScope(scope, enabledRootIds)` (ADR/T-MR13, `context/scope.ts`).
- `ContextEngine.retrieveContextSnippets(query, k, {rootIds}, signal)` +
  `ContextSnippetAnnotation` (ADR-019, T-1308).
- `ChatSendRequest.scope: ContextScope` on the wire (ADR-014, T-PRD09) —
  documented as "ignored by the vertical slice".

This slice connects them: the chat turn resolves `req.scope` against the live
enabled roots, retrieves scoped snippets, folds them into the model's system
prompt, and surfaces exactly those snippets on the response. The scope **picker**
and the **SnippetBadge** render stay IDE-gated, so T-MR13 / T-PRD09 stay `[~]`.

## Context

`ChatHandler.handleSend` built its `LlmRequest` and ignored `req.scope`
entirely — no retrieval, no context injection. The `ContextEngine` that can
retrieve lives PRIVATE inside `WorkspaceCoordinator` (typed as the narrow
`IndexTarget` slice: only `indexFile`/`removeRoot`/`symbolCountForRoot`), and the
handler had no reference to it. `buildCoreDispatcher` constructed the coordinator
and the handler side-by-side but never connected them. The pieces were all
present and tested; this is wiring, not new retrieval logic.

## Decision

Six forks, resolved UNANIMOUSLY by the AI council:

- **A1 — injected callback.** `ChatHandlerDeps` gains an optional
  `retrieveContext?: (query, scope, signal) => Promise<ContextSnippetAnnotation[]>`,
  mirroring the established narrow-callback deps (`loadGuidelines`, `budget`).
  The handler stays independent of workspace/indexing ownership.
- **B1 — coordinator exposes retrieval, engine stays private.** A public
  `WorkspaceCoordinator.retrieveContextSnippets(query, k, scope, signal)`
  delegates to the engine; the injectable `IndexTarget` slice widens by one
  method (the real `ContextEngine` already implements it; the single test fake is
  updated). No raw-engine getter leaks.
- **C1 — coordinator resolves scope.** It is the only holder of the live enabled
  roots, so `resolveContextScope(scope, enabledRootIds)` runs there; the handler
  forwards `req.scope` verbatim and stays scope-agnostic.
- **D1 — both model-visible AND wire-surfaced.** The snippets are folded into a
  bounded `<workspace-context>` block used as the `base` of `resolveSystemPrompt`
  (so the model sees them), AND returned as `ChatSendResponse.annotations` (so
  the IDE renders SnippetBadges). Model-only would hide provenance; wire-only
  would make retrieval pointless.
- **E1 — turn-local, additive response field.** `annotations?:
  ContextSnippetAnnotation[]` is added to `ChatSendResponse` (additive optional);
  it is NOT persisted onto the stored message this slice (mirrors the
  agent-turn ContentPart in-memory-only decision, ADR-023).
- **F1 — gated retrieval, safe default.** Retrieval runs only when the callback
  is injected (the no-retriever test / vertical-slice path is unchanged); an
  omitted `req.scope` defaults to `{kind:'all'}`; `{kind:'none'}` short-circuits
  before any retrieval.

### Correctness traps both reviewers flagged + guarded

- **Estimate must count the system block exactly once.** Retrieval + context
  injection happen BEFORE `maybeEmitEstimate`, so the pre-send `countInputTokens`
  estimate (ADR-022) includes the context block — no undercount.
- **Cap the total injected block independently of the per-snippet bound.** Each
  preview is already ≤8 lines/400 chars (T-1308), but a large `k` could still
  bloat the prompt. `buildContextInjection` caps the rendered body at 8000 chars
  (under the 16 KB guidelines ceiling, so guidelines + context coexist) and
  returns the `used` subset.
- **Wire annotations reflect EXACTLY what the model saw.** The response carries
  `injection.used`, not the raw retrieval result — a snippet dropped by the char
  budget is dropped from both the prompt and the annotations.
- **`roots` filtered to empty must NOT widen to `all`.** `resolveContextScope`
  returns `[]` (not `undefined`) for a roots-set whose ids are all stale, and the
  engine short-circuits `[]` to no retrieval — no code context leaks in.
- **Thread the abort signal.** The turn's `AbortSignal` is passed into retrieval
  so a mid-turn Stop halts the search; retrieval is fail-open EXCEPT an
  `isAbortError` is re-thrown (the T-1305 fail-open-must-not-eat-Stop lesson).

## Consequences

- A `chatSend` turn now retrieves scoped context and the model answers with it;
  the IDE receives `annotations` to render SnippetBadges.
- Backward-compatible: with no `retrieveContext` dep wired (existing tests, the
  vertical slice), the handler behaves exactly as before (no retrieval, no
  annotations, no system prompt from context).
- 14 new core tests (4 context-injection + 5 coordinator scoped-retrieval + 5
  handler), full core suite 931 pass / 1 skip; protocol 40. `Protocol.kt`
  regenerated: `ChatSendResponse` gains `annotations: List<ContextSnippetAnnotation>? = null`
  (JetBrains check green — compile + detekt + ktlint).
- The scope **picker** (T-MR12) and the **SnippetBadge** render (T-1308 render
  half) remain the last-mile; T-MR13 / T-PRD09 stay `[~]`.

## Alternatives considered

- **A2 — pass the coordinator/engine into the handler.** Rejected: couples the
  handler to workspace/indexing ownership; the narrow callback is faker-friendly
  and matches every other dep.
- **B2 — public `engine` getter.** Rejected: leaks the full `ContextEngine`
  surface out of the coordinator for no benefit; the one delegating method keeps
  encapsulation.
- **D2 — response annotations only (no model injection).** Rejected: the model
  never sees the context, so retrieval changes nothing about the answer.
- **D3 — system-prompt injection only (no annotations).** Rejected: the IDE
  cannot render which snippets were used / open them.
- **E2 — persist annotations onto the stored message.** Deferred: a store
  migration this slice does not need; turn-local is enough for the live render.
- **F2 — always retrieve.** Rejected: would change the no-retriever path's
  behaviour and run retrieval even for `none` scope.

## References

- ADR-019 — context-snippet annotations + `retrieveContextSnippets` (the retrieval primitive).
- ADR-014 — `ContextScope` codegen + `ChatSendRequest.scope` (the wire field this honours).
- ADR-010 / ADR-022 / ADR-024 — the chat handler + its cost + guidelines wiring this composes with.
- `packages/core/src/context/scope.ts` — `resolveContextScope` (T-MR13 core, now wired).
- `packages/core/src/context/workspace-coordinator.ts` — the exposed `retrieveContextSnippets`.
- `packages/core/src/chat/context-injection.ts` — the bounded `<workspace-context>` builder.
- road-to-multi-project Phase C T-MR13; road-to-product-readiness T-PRD09.

## Sign-off

On flip to **Accepted**: no PLAN section change required (T-MR13's scope
resolution was recorded with Phase A; T-PRD09's protocol half with ADR-014). This
ADR records the retrieval-wiring decision. The scope picker + SnippetBadge render
remain tracked as the T-MR13 / T-PRD09 render halves.
