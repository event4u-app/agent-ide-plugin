---
adr: 014
title: Trust & Control Core — Separate Audit Log, Derived Risk Badge, Daily Budget Tracker, Standalone Agent Modes, ContextScope Codegen
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 Phase-2 trust-&-control design round — UNANIMOUS on forks A–C, converged on fork D)
related: road-to-product-readiness Phase 2 (T-PRD05 permission cards, T-PRD06 cost UX, T-PRD08 agent modes, T-PRD09 context chips); builds on ADR-004 (permission model), ADR-013 (tool-call events), the cost/ engine, and agent/loop.ts
date: 2026-05-31
---

# ADR-014 — Trust & Control Core

## Status

**Proposed** — drafted alongside the road-to-product-readiness Phase 2 core
slice (`permissions/audit.ts` + `classifyRisk` in `permissions/gate.ts`,
`cost/budget.ts` + the `cost` settings key, `agent/modes.ts`, the `ContextScope`
sealed-class codegen in `scripts/codegen.ts`). The IDE render halves (permission
cards, cost composer footer, mode selector, context chips, index statusbar) stay
deferred; their in-IDE smoke signs the verification log
(`docs/MANUAL_VERIFICATION.md § Product readiness Phase 2`).

## Context

Phase 2 surfaces "what it costs, what is indexed, what mode the agent is in, and
what context a turn uses — and lets the user change each". The engine substrate
exists (the permission gate, the `cost/` estimators, `agent/loop.ts` phases, the
`rootStatus` protocol method, the `ContextScope` union). The gap is the
**control-plane primitives**: a permission audit trail + risk hint, a daily
budget tracker, a user-facing mode→directive vocabulary, and Kotlin parity for
`ContextScope`. Shipped pure-core and unit-tested, protocol/engine-first, ahead
of the IDE widgets — the same pattern as every prior PR.

## Decision

Four forks, ratified by the AI council (codex-cli 0.134.0 + gemini 0.41.2,
2026-05-31 — UNANIMOUS on A–C, converged on D):

1. **A — audit + risk (UNANIMOUS).** A **separate** append-only, date-rotated
   JSONL audit log (`permissions/audit.ts`, `AuditEntry` kinds
   `grant_once` / `grant_always` / `deny_user` / `deny_hard_floor`, fail-open),
   matching the chat-event / telemetry / calibration precedent — **not** a
   `denials[]` array bloating `permissions.json`. Only user-facing decisions and
   hard-floor blocks are recorded; auto-allowed low-risk tools are not (they are
   not decisions). The `runToolCallWithApproval` orchestrator (ADR-013) gained an
   optional injected `audit` recorder so the trail is populated where the
   decision is known. The risk badge is a pure `classifyRisk(level)` →
   `low | medium | high`, **derived, never persisted**, explicitly a UI hint and
   not a security severity (ADR-004: the boundary is the human at the button).
   Risk: a badge read as objective severity — mitigated by the derived-only,
   never-stored mapping.

2. **B — daily budget (UNANIMOUS).** A dedicated pure `DailyBudgetTracker`
   under `cost/` (injected clock + storage dir, date-rotated JSONL spend log,
   `record(usd) → BudgetStatus { spent, remaining, ratio, overBudget, warning }`,
   warn at `spent/limit ≥ warning_threshold_ratio`, default 0.8), plus a `cost`
   settings key (`daily_budget_usd?`, `warning_threshold_ratio`). No budget
   configured → tracks spend but never breaches. The pre-send estimate → budget
   check is **not** wired into `chat/handler.ts` this slice (deferred until a
   protocol/UI consumer exists for the warning). Risk: estimate-vs-actual drift —
   bounded by a clearly-typed `SpendRecord` (`isEstimate` flag) before wiring.

3. **C — agent modes (UNANIMOUS).** A **standalone** `agent/modes.ts`:
   `AgentMode` (`ask | edit | plan | review | commit | explain`) → `DirectiveSet`
   (which `AgentPhase`s run, `mutates`, a composer label). The tested
   `AgentDriver` is **not** refactored; it consumes a `DirectiveSet` later
   (mirrors the provider-direct precedent, honours `minimal-safe-diff`).
   Exhaustive tests assert every mode's phases are valid `AgentPhase`s in
   pipeline order. Risk: `DirectiveSet` rotting against real phase behaviour —
   bounded by the exhaustive cross-check against `AgentPhaseSchema`.

4. **D — bundle scope (converged).** This one PR ships T-PRD05 + T-PRD06 +
   T-PRD08 + T-PRD09 (ContextScope Kotlin codegen — mechanical, follows the
   ADR-013 sealed-union emitter, now with `object` variants for the payload-less
   `all` / `none` kinds + a nullable `scope` on `ChatSendRequest`). T-PRD07
   (index statusbar) is **zero core change** — `rootStatus` + `RootIndexStatus`
   already exist — so it stays `[ ]` (pure IDE widget). The council flagged
   T-PRD08 as the most speculative (no selector consumes a mode yet) but kept it:
   a typed map + tests is cheap and fixes the vocabulary. Risk: modes refactored
   once the UI lands — accepted; the map is the cheapest thing to change.

## Consequences

- **Positive.** The trust-&-control contracts are stable and unit-tested with no
  IDE dependency: a real audit trail (populated by the orchestrator), a budget
  tracker that survives restart, a typed mode vocabulary, and Kotlin parity for
  per-turn scope. 28 new tests; core 765 pass / 1 skip; `jetbrains:check` green.
- **Negative / deferred.** No client renders these yet; the budget warning is
  not wired into a turn, the mode is not selectable end-to-end, and `ContextScope`
  is carried-but-ignored until context injection lands (Phase C). T-PRD07 has no
  core work at all.
- **Neutral.** Codegen now emits 29 flat DTOs + 17 sealed types (ContextScope
  added). The `AgentDriver` is untouched — modes fold in when the UI exists.

## Alternatives considered

- **Denials in `permissions.json`** — rejected (A): state-bloat; a separate
  append-only log matches the repo's other audit trails.
- **A persisted risk-severity enum** — rejected (A): over-built; a derived hint
  cannot be mistaken for a security score.
- **Fold budget into `cost/reconcile.ts`** — rejected (B): a dedicated tracker
  with its own spend log is clearer and independently testable.
- **Refactor `AgentDriver` to accept a directive map now** — rejected (C):
  invasive against a tested state machine before any UI selects a mode.

## References

- AI council design round: codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31
  (Phase-2 trust & control, UNANIMOUS on A–C, converged on D).
- ADR-004 (permission model) · ADR-013 (tool-call events; the orchestrator this
  audit recorder hooks into) · the `cost/` engine · `agent/loop.ts` phases.
- road-to-product-readiness Phase 2 — T-PRD05, T-PRD06, T-PRD08, T-PRD09.

## Sign-off

On flip to **Accepted**: the deferred render halves build against these frozen
shapes; the budget→handler wiring and the mode→driver wiring are specified in a
follow-up when the composer surfaces the warning and the mode selector.
