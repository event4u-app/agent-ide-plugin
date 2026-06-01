---
adr: 027
title: Code-Suggestion Annotations on the Agent Turn — Wire buildCodeSuggestions + transitionCodeSuggestion into AgentTurnHandler (Build at Prepare Time, Per-Call-Namespaced Ids, Drive Applied→Done / Denied|Failed→Error, Broaden annotations to the Annotation Union, Turn-Local)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-01 agent-turn-code-suggestions design round — codex A1/B1/C1/D3/E1, gemini A2/B1/C1/D2/E1; UNANIMOUS on B1 (build at prepare time), C1 (applied→done), E1 (per-call-namespaced ids); both converged denied→error; Fork A (specific vs union type) SPLIT and resolved to A2 by a rebase-forced field collision — see Decision)
related: completes the wiring of ADR-020 (code-suggestion annotation builders, shipped with zero callers) into the live agent turn; builds on ADR-023 (agent-turn tool loop) and ADR-026 (scoped-context retrieval in the agent turn, which first added `AgentTurnResponse.annotations` as a context-snippet array); road-to-v1-0 Phase 13 (Message.annotations) + road-to-mvp-ui-design § "Data + render contract"; the per-edit diff-sidebar render stays the IDE last-mile
date: 2026-06-01
---

# ADR-027 — Code-Suggestion Annotations on the Agent Turn

## Status

**Proposed** — awaits sign-off. The `agentTurn` is the chat turn that EDITS
files (ADR-023). Until now its only durable record of an edit on the terminal
`AgentTurnResponse` was `changedFiles: string[]` (paths only) plus the
**transient** `ToolCallEvent` approval stream, which vanishes when the turn
ends. The two pure builders that turn a resolved `WriteFilesPlan` into the
durable `code-suggestion` member of the `Message.annotations` contract —
`buildCodeSuggestions` + the `transitionCodeSuggestion` reducer (ADR-020) —
shipped with **zero production callers**. This slice wires them in: every file
edit the agent proposes now rides the turn response as a durable, per-edit
`code-suggestion` annotation with a faithful terminal state. The IDE's per-edit
diff-sidebar **render** stays IDE-gated — no roadmap checkbox flips, dashboard
counts unchanged.

## Context

`buildCodeSuggestions(plan)` emits one `code-suggestion` annotation per edit
(`resolved`/`suggestion` → `pending` with a bounded diff preview; unresolved →
terminal `error`). `transitionCodeSuggestion` is the pure SweepAI state-machine
reducer (`pending --start--> processing --complete--> done`;
`pending|processing --fail--> error`; terminal states immutable; invalid edges
no-op, never throw). Both were built ahead of their wiring in ADR-020.

The `WriteFilesPlan` is encapsulated in the tool registry's `prepare()` closure;
the handler only ever sees `PreparedTool { review?, execute() }`. So the builder
must run where the plan lives — at prepare time — and the handler drives the
lifecycle from the execution outcome it already observes.

One structural fact dominated the final design: **ADR-026 had already added
`AgentTurnResponse.annotations` as a `ContextSnippetAnnotation[]`** (the scoped
context the model saw at loop start). This slice was drafted against a stale
pre-ADR-026 base; on rebase onto current `main` the field collided.

## Decision

Additive, pure-core + handler wiring. No new protocol method (the `Methods`-keys
pin is untouched); the IDE render is untouched.

1. **Fork B1 — build at prepare time.** `writeFilesEntry.prepare()` calls
   `buildCodeSuggestions(plan)` and exposes the result on a new optional
   `PreparedTool.suggestions`. The handler stays plan-agnostic; read-only tools
   leave it unset. (UNANIMOUS.)

2. **Fork C1 + D (converged) — faithful terminal lifecycle.** The agent turn
   AUTO-applies on approval (the write has happened server-side by turn end), so
   the terminal response must reflect reality: a successfully applied edit is
   driven `pending → processing → done`; a denied call → `error` ("Denied by
   user"); an atomic-apply failure → `error` ("write failed"); an edit the
   locator never resolved is already terminal `error` (its transitions no-op,
   preserving the locate diagnostic); a turn cancelled mid-tool leaves its
   suggestions as-built (honest — nothing was written). codex (D3) and gemini
   (D2) both converged on denied→error; C1 was UNANIMOUS.

3. **Fork E1 — per-call-namespaced ids.** `buildCodeSuggestions` emits
   `edit-<index>`, which collides across multiple `write_files` calls in one
   turn (each call restarts the index at 0). The handler namespaces by a
   per-tool-call ordinal → `call<seq>-edit-<index>`, leaving the builder and its
   tests untouched. (UNANIMOUS.)

4. **Fork A2 — broaden `annotations` to the `Annotation` union (rebase-forced
   resolution).** Fork A was SPLIT: codex picked A1 (a specific
   `CodeSuggestionAnnotation[]`, mirroring the chat turn) and gemini picked A2
   (the broad `kind`-tagged union, for forward-compat). The field collision with
   ADR-026 settled it decisively: `AgentTurnResponse.annotations` already carries
   `ContextSnippetAnnotation[]`, and there cannot be two `annotations` fields, so
   the field is broadened to `z.array(AnnotationSchema)` and BOTH producers fold
   into one array — context snippets (what the model saw) first, then the
   per-edit code suggestions, in execution order. The chat turn keeps the
   narrower `ContextSnippetAnnotation[]` (it never edits files). Gemini's A2 was
   the correct forward call; the rebase merely proved it. The Kotlin DTO becomes
   `List<Annotation>?` (the `Annotation` sealed type already exists from ADR-019).

Turn-local: the union is surfaced on the wire only, never persisted into the
string-only `ConversationStore` (the transcript keeps the ADR-023 text + compact
edit summary).

## Consequences

- The agent turn now produces a durable, model-and-IDE-legible per-edit record
  with a correct terminal state — the data layer the per-edit diff sidebar
  renders. The render (stage/apply/skip affordances, diff viewer) is the IDE
  last-mile; no checkbox flips, dashboard counts unchanged (148/308).
- The `AgentTurnResponse.annotations` union is the single forward-compatible
  surface for every annotation kind the agent turn produces; adding `status-row`
  later is purely additive.
- **Correctness traps guarded** (both reviewers): accumulate across iterations
  (never overwrite per iteration); run every suggestion to a terminal state by
  turn end so the IDE never hangs on `processing`; namespace ids BEFORE the
  transitions so they stay stable through the lifecycle; cost/usage untouched
  (annotations are derived side-data from already-built plans and observed
  outcomes).
- Scope honesty: this is the next autonomous pure-core seam; the remaining open
  `[ ]` items across the roadmaps are IDE-render work needing a human GUI session.

## Alternatives

- **A1 — keep a specific `CodeSuggestionAnnotation[]` in a separate field.**
  Rejected: would mean two annotation fields on one response, fragmenting the
  `Message.annotations` contract; the union is the design's intent.
- **C2 — leave applied edits `pending` for the IDE to drive.** Rejected: the
  agent turn has no separate manual-apply step (the write already happened), so
  `pending` on the terminal response would misrepresent reality.
- **B2 — expose the raw `WriteFilesPlan` and build in the handler.** Rejected:
  leaks the plan out of the tool encapsulation for no benefit; the handler only
  needs the built suggestions plus the outcome it already observes.

## References

- ADR-020 — code-suggestion annotation builders (the zero-caller primitives this wires)
- ADR-023 — agent-turn tool loop (the handler this extends)
- ADR-026 — scoped-context retrieval in the agent turn (added `AgentTurnResponse.annotations`)
- road-to-v1-0 Phase 13 (Message.annotations) · road-to-mvp-ui-design § "Data + render contract"
