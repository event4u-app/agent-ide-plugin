---
adr: 026
title: Scoped-Context Retrieval in the Agent Turn — Mirror ChatHandler scope→retrieve→inject into AgentTurnHandler (Retrieve-Once Before the Loop, Three-Layer System Prompt G→S→C, Model-Visible and Wire-Surfaced, Turn-Local, Fail-Open-but-Abort-Propagating)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-02 agent-turn-scoped-context design round — UNANIMOUS on all five forks A1/B1/C1/D1/E1; both reviewers independently flagged the SAME stale-context trap (once-retrieved snippets show PRE-edit file state across iterations) and converged on the mitigation (iteration cap + tool_result history is later in the message list and therefore authoritative))
related: extends ADR-025 (scoped-context retrieval in the chat turn — this is its agent-turn twin) + ADR-023 (agent-turn tool loop) + ADR-024 (workspace-guidelines system prompt); road-to-multi-project Phase C T-MR13 + road-to-product-readiness T-PRD09 (per-turn scoping — the AgentTurnHandler was the remaining handler ignoring scope/context); the SnippetBadge + scope-picker render stays the IDE last-mile
date: 2026-06-02
---

# ADR-026 — Scoped-Context Retrieval in the Agent Turn

## Status

**Proposed** — the agent-turn twin of ADR-025. PR #37 (ADR-025) wired
`scope → retrieve → inject` into the simple `ChatHandler` (one provider-direct
turn). The `AgentTurnHandler` — the agentic LLM↔tool loop that actually EDITS
files (ADR-023) — still ignored `scope`/context entirely (grep for
`scope`/`retrieveContext` in `agent/turn-handler.ts` returned nothing). This
slice closes that gap: the agent turn now resolves `req.scope`, retrieves scoped
snippets once before the loop, folds them into the per-iteration system prompt,
and surfaces exactly those snippets on the response. The scope **picker** and the
**SnippetBadge** render stay IDE-gated, so T-MR13 / T-PRD09 stay `[~]` (no
checkbox flip; dashboard counts unchanged).

## Context

The agent turn benefits MORE from scoped context than the chat turn — it writes
code, so grounding it in the relevant indexed files directly improves edit
quality. The retrieval, scope-resolution, injection, and annotation primitives
all shipped already (ADR-019 `retrieveContextSnippets`, ADR-025
`buildContextInjection` + `resolveSystemPrompt` + the `WorkspaceCoordinator`
scope-resolving callback). The only new work is threading them through the loop
handler — the same shape of seam ADR-025 solved for chat, with one structural
difference: the agent turn ALSO carries a static base system prompt
(`deps.system`, the agent's role instruction), so the system prompt now composes
THREE layers, not two.

## Decision

Mirror ADR-025's contract. Five forks, AI council UNANIMOUS:

- **A1 — three-layer ordering `G → S → C`.** Workspace guidelines (the leading
  constraint) ahead of the static agent instruction `S` ahead of the retrieved
  `<workspace-context>` block `C`. Implemented as `base = composeAgentBase(S, C)`
  (static instruction first, context block last) then
  `resolveSystemPrompt(base, loadGuidelines)` prepends `G`. Guidelines are the
  policy, the role is the actor, retrieved code is reference data — standard
  grounding hierarchy.
- **B1 — retrieve ONCE per turn, before the loop.** Query = the user message;
  reused across every iteration. Re-retrieving per iteration would shift the
  grounding mid-loop and burn latency without a fresh query signal. The system
  prompt is composed ONCE and reused every iteration (the existing guidelines
  contract).
- **C1 — surface `annotations` on `AgentTurnResponse`.** Additive optional
  `ContextSnippetAnnotation[]`, EXACTLY the snippets folded into `system`
  (not a budget-dropped superset), omitted when empty. Parity with
  `ChatSendResponse` drives the IDE SnippetBadge + answers "why did the agent
  edit that?".
- **D1 — fail-open, abort-propagating.** A retrieval error degrades to no
  context so a flaky index never breaks the turn; an `AbortError` is RE-THROWN
  (the T-1305 lesson — Stop must not be swallowed), and the `finally` releases
  the in-flight slot.
- **E1 — `scope: 'none'` short-circuits.** No retrieval, no annotations, system
  is `G + S` only. An omitted scope defaults to `all`.

The retriever is an optional injected callback (`AgentTurnHandlerDeps.retrieveContext`,
the same signature as `ChatHandlerDeps`). `buildCoreDispatcher` injects the same
shared-`WorkspaceCoordinator` callback both handlers use. Absent callback → no
retrieval (backward-compatible; existing agent-turn tests untouched).

### Stale-context trap (both reviewers, converged mitigation)

Because context is retrieved ONCE and lives in the system prompt, the snippets
reflect PRE-edit file state for the whole turn. If the agent edits a file that
appears in those snippets, later iterations still see the old text in `system`.
Mitigation (no extra mechanism needed): the loop feeds each `tool_result` back
into the **message history**, which sits LATER than the system prompt and
therefore carries the authoritative post-edit state; the iteration cap (default
10) bounds how far the stale snippet can mislead. Documented inline + on the
wire (`AgentTurnResponse.annotations` doc notes the PRE-edit caveat).

## Consequences

- **Positive.** The file-editing agent is now grounded in scoped workspace
  context with zero new infrastructure — pure handler wiring over shipped
  primitives. Chat and agent turns now have identical context semantics. Fully
  unit-tested (6 new tests), CI-verifiable, no native deps.
- **Neutral.** Protocol additive only (`AgentTurnRequest.scope`,
  `AgentTurnResponse.annotations` — both optional); no new method, the
  `Methods`-keys pin is untouched. Kotlin DTOs regenerated.
- **Deferred / IDE last-mile.** The scope picker (composer chips) and the
  SnippetBadge render remain IDE-runtime work — unchanged from ADR-025.
  T-MR13 / T-PRD09 stay `[~]`.

## Alternatives considered

- **A2 (`G → C → S`) / A3 (drop `S`, treat `C` as base like chat).** Rejected:
  A3 would lose the agent's role contract; A2 buries the role instruction behind
  retrieved data. Council UNANIMOUS A1.
- **B2 (retrieve per iteration).** Rejected: context drift + latency, no fresh
  query. Council UNANIMOUS B1.
- **C2 (no annotations on the agent response).** Rejected: breaks parity and the
  "why did it edit that?" traceability the SnippetBadge provides.

## References

- ADR-025 — scoped-context retrieval in the chat turn (this ADR's twin).
- ADR-023 — agent-turn tool loop. ADR-024 — workspace-guidelines system prompt.
- ADR-019 — context-snippet annotations + `retrieveContextSnippets`.
- `packages/core/src/agent/turn-handler.ts` — the wired handler.
- `packages/core/src/chat/context-injection.ts` — `buildContextInjection`.
- `packages/core/src/chat/system-prompt.ts` — `resolveSystemPrompt`.
