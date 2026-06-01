---
adr: 020
title: Code-Suggestion Annotations — Second Message.annotations Member, SweepAI Suggestion State Machine (Standalone from ToolCallEvent, Flat-Enum Wire State, Pure Reducer, Built from WriteFilesPlan, Bounded Diff Preview, No-Op Invalid Transitions)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini-cli, 2026-06-01 code-suggestion design round — UNANIMOUS forks A1/C1/D1/E1/F1/G1; SPLIT fork B resolved to B1 on the flat-codegen + single-writer-invariant precedent)
related: road-to-v1-0 Phase 13 (extends the `Message.annotations` contract shipped by T-1308 / ADR-019); pre-builds the data layer for Phase 10 inline-edit diff-accept (T-1001/T-1002); realizes the SweepAI `CodeMirrorSuggestionEditor` artifact forward-pointed in road-to-mvp-ui-design § "Data + render contract"
date: 2026-06-01
---

# ADR-020 — Code-Suggestion Annotations

## Status

**Proposed** — the second pure-core seam of the `Message.annotations` contract.
The SweepAI `CodeMirrorSuggestionEditor` RENDER (the per-suggestion editor, the
stage/apply affordance, the diff gutter) is an IDE surface and stays deferred;
this ADR covers the wire data model (`code-suggestion` union member), the
core reducer that owns its state-machine invariant, and the builder that maps
the existing edit seam into it — all autonomous and CI-verified.

## Context

ADR-019 established the `Message.annotations` discriminated union (SweepAI-derived,
`road-to-mvp-ui-design.md` § "Data + render contract" is the design authority) with
its first member, `context-snippet`. The union was deliberately built `kind`-tagged
so further artifacts could be added without a breaking reshuffle.

The design doc lists the next artifact explicitly out-of-scope-until-v1.0: SweepAI's
`CodeMirrorSuggestionEditor.tsx` — a per-suggestion code-edit editor with a
`pending | processing | done | error` state machine and per-suggestion stage/apply.
The agent edit-loop already produces the source data: `WriteFilesPlan` carries one
`EditResult` per proposed edit (`resolved | suggestion | not_found | ambiguous |
error`) plus the resolved per-file unified `diff`. What was missing was (1) the wire
member the IDE renders the suggestion editor off, and (2) the core state-machine
logic that drives `pending → processing → done | error` deterministically in the
sidecar so both clients stay thin renderers.

This slice ships exactly that, threading the existing `write-files` seam — the same
"thread-an-existing-seam pure-core slice ahead of the IDE render" pattern as T-1305
and T-1308.

## Decision

Add a second member to the `Annotation` union and a pure-core module that owns it.

1. **A1 — Standalone from `ToolCallEvent`.** The `code-suggestion` annotation is a
   durable record that rides on the message (re-rendered deterministically from the
   message model). It shares no types with the transient `ToolCallEvent` lifecycle
   stream (approval/diff/result cards). They are complementary: `ToolCallEvent` is
   the live event; the annotation is the persisted artifact. Coupling them to a
   shared id would risk broken renders on session reload.

2. **B1 — Flat-enum state on the wire.** The annotation is a single flat object with
   `state: 'pending' | 'processing' | 'done' | 'error'` and a present-but-optional
   `errorMessage`. State is **not** modelled as a nested discriminated sub-union.
   Rationale (resolves the only council split): the codegen sealed-union emitter is
   narrow by design — it emits `kind`-discriminated variants of flat serializable
   subclasses only; a nested `state` sub-union would need a second discriminator and
   a codegen extension. The core reducer is the **single writer** of the state
   invariant, so the wire does not need to enforce it structurally — matching the
   `context-snippet` precedent of keeping render/structure decisions out of the wire.

3. **C1 — Pure reducer over an explicit event union.** `transitionCodeSuggestion(
   current, event)` where `event` is `{type:'start'} | {type:'complete'} | {type:
   'fail', error}`. Valid edges: `pending --start--> processing`,
   `processing --complete--> done`, `pending|processing --fail--> error`. A reducer
   over events (not a target-state setter) is trivially testable and forbids arbitrary
   state jumps.

4. **D1 — Built from `WriteFilesPlan`.** `buildCodeSuggestions(plan)` emits one
   annotation per `EditResult`, in order, with initial state derived from the resolved
   `EditStatus` (`resolved`/`suggestion` → `pending`; `not_found`/`ambiguous`/`error`
   → `error` carrying the locate diagnostic). Building off the resolved plan reflects
   what the agent actually produced and reuses the existing file-matching logic.

5. **E1 — Bounded diff preview on the wire.** Each annotation carries a bounded
   unified-diff slice (≤40 lines / ≤2000 chars, taken from the matching planned
   file) plus a stable `suggestionId` (`edit-<index>`). Mirrors the `context-snippet`
   bounded-preview discipline so an old message re-renders without an RPC round-trip.

6. **F1 — No-op invalid transitions.** A transition out of a terminal state (`done`/
   `error`) or along an invalid edge returns the input unchanged with `changed:false`
   — never throws. A stale or racey apply event can be logged without crashing the
   sidecar; terminal states are immutable.

7. **G1 — `code-suggestion` only this slice.** The third forward-pointed member
   (`status-row`, progress strings) is deferred — it is a transient-progress shape,
   not a durable edit artifact, and ships in its own slice.

## Consequences

- **Positive.** The union grows additively (no change to `context-snippet`, no
  breaking codegen reshuffle). The sidecar owns the suggestion state machine, so VS
  Code and JetBrains never re-implement the transition rules. Phase 10's inline-edit
  diff-accept (T-1001/T-1002) now has its data layer ready ahead of the IDE render.
  The reducer + builder are pure free functions — 12 new unit tests, no I/O.
- **Negative / deferred.** The editor render, the per-suggestion stage/apply
  affordance, and the wiring of `buildCodeSuggestions` / `transitionCodeSuggestion`
  into the live agent turn are IDE surfaces, still deferred. State drift between the
  durable annotation and on-disk state is possible if the IDE applies an edit without
  emitting the matching `complete`/`fail` event (gemini's risk callout) — mitigated
  by making the sidecar the single transition writer; the IDE must route apply results
  back through the reducer.
- **Wire growth.** Durable annotations multiply transcript size; the diff preview is
  aggressively bounded (≤40 lines / ≤2000 chars) to cap it (codex's risk callout).

## Alternatives considered

- **B2 — nested state sub-union.** Each state its own shape (e.g. only `error`
  carries `errorMessage`). Stronger structural integrity, but needs a second
  discriminator + codegen extension and breaks the flat-variant precedent. Rejected:
  the reducer already guarantees the invariant.
- **A2 — embed/reference a `ToolCallEvent` id.** Avoids perceived duplication, but
  couples a durable artifact to a transient stream id that may not survive a reload.
- **D2 — build from raw proposed `FileEdit[]`.** Would re-implement the locate /
  file-matching the plan already did. Rejected.
- **F2 — throw on invalid transition.** A racey duplicate apply event would crash the
  sidecar. Rejected in favour of the no-op-plus-flag.

## References

- `packages/protocol/src/schema.ts` — `CodeSuggestionStateSchema`,
  `CodeSuggestionAnnotationSchema`, extended `AnnotationSchema`.
- `packages/core/src/agent/suggestions.ts` — `buildCodeSuggestions`,
  `transitionCodeSuggestion`, `initialStateForEdit`.
- `scripts/codegen.ts` — `code-suggestion` variant of the `Annotation` sealed union.
- ADR-019 — `context-snippet`, the first member of this contract.
- `road-to-mvp-ui-design.md` § "Data + render contract" — design authority.
- `road-to-v1-0.md` Phase 10 (T-1001/T-1002 inline-edit diff-accept), Phase 13 (annotations contract).
