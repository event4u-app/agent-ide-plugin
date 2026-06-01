---
adr: 021
title: Status-Row Annotations — Third Message.annotations Member, SweepAI Progress-Strings Surface (Durable over Transient, `active` State, Optional Phase on the Wire, Generic Descriptor Builder + Mode-Aware Wrapper, Detail-Only Progress Event, No-Op Invalid Transitions)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini-cli, 2026-06-01 status-row design round — UNANIMOUS forks A1/C1/D1/E1/F1; SPLIT fork B (codex B1 phase-bound vs gemini B2 generic) resolved to a synthesis — generic descriptor builder B2 with a mode-aware convenience wrapper B1, plus an optional `phase` field that addresses the shared correctness trap both reviewers flagged)
related: road-to-v1-0 Phase 13 (extends the `Message.annotations` contract shipped by T-1308 / ADR-019 and the `code-suggestion` member / ADR-020); realizes the SweepAI "progress strings are first-class stream items" artifact forward-pointed in road-to-mvp-ui-design § "Data + render contract"; pre-builds the data layer for the C-9 status surface and T-1304 index-statusbar progress
date: 2026-06-01
---

# ADR-021 — Status-Row Annotations

## Status

**Proposed** — the third pure-core seam of the `Message.annotations` contract.
The progress-bar / spinner RENDER and the live AgentDriver→status-row streaming
at phase boundaries are IDE/transport surfaces and stay deferred; this ADR covers
the wire data model (`status-row` union member), the pure builder that turns an
ordered step list into rows, the mode-aware convenience over `DirectiveSet.phases`,
and the reducer that owns the row lifecycle invariant — all autonomous and
CI-verified.

## Context

ADR-019 established the `Message.annotations` discriminated union (SweepAI-derived,
`road-to-mvp-ui-design.md` § "Data + render contract" is the design authority) with
`context-snippet`; ADR-020 added the `code-suggestion` member. The union was built
`kind`-tagged precisely so the third forward-pointed artifact could land without a
breaking reshuffle.

That third artifact is the progress surface. The design doc names it twice — status
rows are listed among the `annotations`, AND "**Progress strings are first-class
stream items** for long operations (drives the C-9 status surface)." The canonical
example (T-1304) is "Indexing 4,238 / 21,500 files…", and an agent run naturally
shows per-phase progress ("Refine ✓ · Plan ✓ · Implement …"). The agent run model
already exists: `agent/loop.ts` defines the fixed `AgentPhase` pipeline
(`refine → plan → implement → verify → report → done`); `agent/modes.ts` maps each
mode to a `DirectiveSet.phases` — an ordered SUBSET of that pipeline (an `ask` turn
runs two phases, an `edit` turn five). What was missing was (1) the wire member the
IDE renders progress off, and (2) the core lifecycle logic that drives
`pending → active → done | error` deterministically so both clients stay thin
renderers.

This slice ships exactly that — the same "thread-an-existing-seam pure-core slice
ahead of the IDE render" pattern as ADR-019 / ADR-020.

## Decision

1. **Durable annotation, not a transient stream (fork A1).** The current/final row
   state rides on the message and re-renders deterministically from it — consistent
   with the other two members. Live progress streaming and the spinner render are the
   IDE/transport last-mile and stay deferred. (The design doc's "first-class stream
   items" framing is the render-time delivery of this durable state, not a competing
   model.)

2. **Generic descriptor builder + mode-aware wrapper (fork B synthesis).** The
   council split: codex picked B1 (build from `DirectiveSet.phases`, phase-bound);
   gemini picked B2 (a generic descriptor source so non-phase long-ops like indexing
   also produce rows). Both flagged the SAME trap: a *required* `phase` field would
   make generic progress (indexing) unrepresentable. Resolution synthesises both:
   `buildStatusRows(descriptors, { activeIndex? })` is fully generic (each descriptor
   is `{ statusId, label, phase? }`); `statusRowsForMode(directive, currentPhase?)` is
   a thin convenience that derives phase descriptors from `DirectiveSet.phases`. An
   out-of-range `activeIndex` means "no active row" (every row stays `pending`).

3. **`active` state (fork C1).** The lifecycle enum is `pending | active | done |
   error`. `active` reads correctly for "the in-flight step" and avoids overloading
   code-suggestion's edit-specific `processing`.

4. **Optional `phase` on the wire (fork D1, weakened to optional).** `phase` is an
   optional enum of the five runnable phases (`done` is the driver-complete sentinel,
   never a row) so the IDE picks a phase icon deterministically — mirroring
   `category → colour` on context-snippet — while non-phase rows omit it. This is the
   field that resolves the reviewers' shared trap.

5. **Detail-only `progress` event + no-op invalid transitions (fork E1).** The reducer
   `transitionStatusRow` has events `activate` (pending→active), `complete`
   (active→done), `fail` (→error, reason rides in `detail`), and `progress` (updates
   `detail` only, state unchanged). Terminal states (`done`/`error`) are immutable;
   any invalid/terminal edge is a no-op returning `{ next, changed: false }` and never
   throws — so a replayed or racey stream update cannot corrupt the row. `statusId`
   is always caller-supplied and deterministic (`phase-<name>` or a fixed constant),
   never a UUID, so transient updates reconcile against the durable row
   (gemini's reconciliation trap).

6. **Pure-core only (fork F1).** Ship the member + builder + wrapper + reducer +
   tests. The live AgentDriver phase-boundary wiring and the IDE progress render stay
   deferred — consistent with ADR-019 / ADR-020, so no roadmap checkbox flips.

## Consequences

- The `Message.annotations` union now carries all three forward-pointed members; the
  Kotlin sealed hierarchy gains a `StatusRowAnnotation` variant via the existing
  flat-kind codegen emitter (`scripts/codegen.ts`).
- The C-9 status surface and the T-1304 index statusbar now have a wire contract +
  core lifecycle to render off; the render itself is the only remaining work.
- A non-phase long operation (indexing, dependency sync) and an agent run share one
  row model — the IDE renders both identically, keying icons off the optional `phase`.
- No behaviour change for existing callers: the union is additive, the builder is a
  new standalone module, and no live producer is wired this slice.

## Alternatives considered

- **A2 — transient stream member (model like `ToolCallEvent`, nothing durable).**
  Rejected: a reloaded conversation or re-opened message could not reconstruct the
  progress surface, breaking the SweepAI "one message model, deterministic re-render"
  contract the union exists to uphold.
- **B1 strict — phase-bound builder only.** Rejected as the sole model: it cannot
  represent the canonical T-1304 indexing example (not an `AgentPhase`). Kept as the
  `statusRowsForMode` convenience layered over the generic builder.
- **B3 — derive directly from `AgentDriver`/`WorkState`.** Rejected: couples the
  builder to the driver's internals; the driver carries no phase-progress metadata and
  the standalone-then-fold-in precedent (ADR-014 modes, ADR-013 approval) says keep the
  vocabulary pure first.
- **C2 — reuse `pending|processing|done|error` verbatim.** Rejected: `processing` is
  edit-specific on code-suggestion; `active` is the right word for a phase row.
- **D2 — no `phase` on the wire.** Rejected: the IDE would have to string-match the
  label to pick an icon; an optional typed enum is both deterministic and generic.

## References

- `road-to-mvp-ui-design.md` § "Data + render contract" — design authority (status
  rows + "progress strings are first-class stream items").
- ADR-019 (context-snippet member) · ADR-020 (code-suggestion member) — the prior two
  members of the same union.
- `packages/protocol/src/schema.ts` — `StatusRowAnnotationSchema`, `StatusRowStateSchema`,
  `StatusRowPhaseSchema`, the extended `AnnotationSchema` union.
- `packages/core/src/agent/status-rows.ts` — `buildStatusRows`, `statusRowsForMode`,
  `transitionStatusRow`.
- `scripts/codegen.ts` — the `status-row` Kotlin sealed-union variant.
- road-to-v1-0 Phase 13 annotations-contract note · C-9 status surface · T-1304.
