---
adr: 032
title: Approval-Card Risk Badge — Wiring classifyRisk (T-PRD05) Onto the approvalRequested Event (Core Owns Classification, Required Wire Field, Event-Only Presentation Hint, Runtime Drift Guard)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-01 approval-risk-level round — UNANIMOUS A1 ship-the-slice / C1 required-field / D2 keep-focused; SPLIT Fork B resolved to B2 event-only per codex's lossy-projection-not-in-decision-input argument; both flagged the same traps — required-field breaks existing approvalRequested fixtures, protocol enum must not drift from the core one)
related: makes road-to-product-readiness T-PRD05 risk-badge wire contract LIVE (classifyRisk shipped in ADR-014 with ZERO callers); builds on ADR-013 (runToolCallWithApproval, the approval lifecycle this enriches), ADR-004 (permission model — the boundary is the human at the button, the badge is only a hint); the IDE render of the badge remains the last mile
date: 2026-06-01
---

# ADR-032 — Approval-Card Risk Badge (classifyRisk Wiring)

## Status

**Proposed** — awaits sign-off. `classifyRisk(level)` (permissions/gate.ts,
T-PRD05, shipped in ADR-014) is a pure mapping `PermissionLevel → RiskLevel`
(`low | medium | high`) that had **zero production callers**: the
`approvalRequested` event in the tool-call lifecycle carried only the raw gate
`level`, so each IDE client would have to import or re-derive the risk badge
itself — duplicated classification across two clients. This slice computes the
badge in core and puts it on the wire. Pure core, CI-verified; the badge
**render** (the colored chip on the permission card) stays IDE-gated, so **no
checkbox flips** — T-PRD05 stays `[~]`.

## Context

`runToolCallWithApproval` (agent/approval.ts, ADR-013) turns one tool-call into
the ordered `ToolCallEvent` stream an IDE renders as approval / diff / result
cards. On a gate `ask` verdict it emits `approvalRequested` with `level`
(`requires_diff_approval | requires_approval`), an optional `riskReason`, and an
optional `review` (the multi-file diff). It did **not** carry the classified
`riskLevel` badge. `classifyRisk` already encodes the mapping
(`low → low · requires_diff_approval → medium · requires_approval/denied → high`)
and is explicitly a *presentation hint, not a security boundary* (ADR-004: the
human at the confirmation button is the boundary; the badge must never read as an
objective severity score). The wire protocol had no `RiskLevel` enum — it lived
only in core.

## Decision

Wire `classifyRisk` onto the `approvalRequested` event, centralizing the badge
classification in core. AI Council (codex-cli + gemini) decided:

- **Fork A — A1 (UNANIMOUS): ship the slice.** Of the remaining zero-caller
  seams (`planToReview` cosmetic DRY, `phaseRunsInMode` with no live
  iteration-loop consumer, `AgentDriver`/status-rows which are IDE-halt-gate
  scoped), this is the only one that is zero-caller **and** IDE-free **and**
  user-visible rather than cleanup.
- **Fork B — B2 (SPLIT, resolved event-only).** codex B2 vs gemini B1 (also
  expose to the injected `decide` callback). Resolved to **B2**: the decider
  already holds the *authoritative* `level`; injecting the *lossy* `riskLevel`
  projection into the decision input invites semantic drift and makes a
  presentation hint feel authoritative. A future policy-decider branches on
  `level`, not the badge. `ApprovalDecisionRequest` is left unchanged.
- **Fork C — C1 (UNANIMOUS): required wire field.** `riskLevel` is deterministic
  and total over `level`; optionality would just push defensive null-branching
  into the clients.
- **Fork D — D2 (UNANIMOUS): keep focused.** `planToReview` DRY stays a separate
  trivial follow-up — no shared blast radius with a protocol/core change.

Mechanically: `RiskLevelSchema = z.enum(['low','medium','high'])` added to the
protocol; `riskLevel: RiskLevelSchema` added (required) to the `approvalRequested`
variant; the hand-maintained codegen spec (`scripts/codegen.ts`) gains the
matching Kotlin field so `Protocol.kt` regenerates with `val riskLevel: String`;
`agent/approval.ts` computes `classifyRisk(verdict.level)` and emits it on the
event only.

## Consequences

- Core is now the single source of truth for the risk badge; both clients render
  one consistent value off the wire instead of each re-deriving it.
- Protocol-additive within the existing union — no new method, the `Methods`-keys
  pin is untouched. Clients decode with `ignoreUnknownKeys = true` and ignore the
  new field until they render it.
- A **required** field broke the bare `approvalRequested` protocol fixture
  (codex's flagged trap); fixtures + a new invalid-/missing-`riskLevel` rejection
  test were updated in the same slice.
- A runtime **drift guard** (gemini's flagged trap) asserts the protocol
  `RiskLevelSchema.options` equals the core one, so a future core risk band that
  is not mirrored on the wire fails a test rather than silently making the badge
  unrepresentable.

## Alternatives

- **Leave it to the clients (rejected A2 / status quo).** Each IDE re-derives the
  badge — duplicated classification, drift risk across two languages.
- **Expose riskLevel to the decider too (Fork B1, rejected).** Conflates a
  presentation hint with the authoritative decision input.
- **Optional wire field (Fork C2, rejected).** Pushes null-handling into clients
  for a value that is always computable.
- **Bundle the planToReview DRY (Fork D1, rejected).** Mixes cosmetic cleanup
  with a protocol change.

## References

- `packages/core/src/permissions/gate.ts` — `classifyRisk`, `RiskLevelSchema`.
- `packages/core/src/agent/approval.ts` — the emission site.
- `packages/protocol/src/schema.ts` — `RiskLevelSchema` + the `approvalRequested`
  variant.
- `scripts/codegen.ts` — the hand-maintained `ToolCallApprovalRequested` spec.
- ADR-013 (approval lifecycle), ADR-014 (classifyRisk shipped uncalled),
  ADR-004 (permission model — badge is a hint, not a boundary).
