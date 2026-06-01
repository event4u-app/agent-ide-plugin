---
adr: 036
title: Calibration-Drift Reconciliation — Wiring CalibrationLog Into The Live Chat Finalize Path (Real-vs-Estimate Drift Recording, T-706)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 seam-selection + fork round — UNANIMOUS A0 CalibrationLog over EditLoop/status-rows, A1 chat-handler only, A2 return-the-CostRange, A3 optional injected dep under shared tracking dir, A4 reconcile api real cost AND cli shadow cost, A5 skip cancelled, A6 estimate-gated + fail-open; both flagged the same traps — no double token-count, exactly-once at finalize, skip cancelled/errored, same conversationId, strict > threshold, shared tracking dir; gemini additionally flagged stale-estimate-leakage across reused handler instances)
related: makes road-to-v1-0 T-706 (Reconciliation logging) LIVE — the CalibrationLog logic shipped 2026-05-30 with zero callers; this slice wires it so real-vs-estimate drift is recorded. Builds directly on ADR-035 (live step tracking), which named T-706 "deliberately out of scope". Backs the Cost Dashboard "Calibration drift" KPI (T-707, render stays IDE-gated). Reuses the BudgetRecorder/StepRecorder finalize seam (ADR-022/ADR-035).
date: 2026-06-02
---

# ADR-036 — Calibration-Drift Reconciliation (Wiring T-706)

## Status

**Proposed** — awaits sign-off. `cost/reconcile.ts` `CalibrationLog` (T-706)
shipped fully built and tested on 2026-05-30 but with **zero production
callers**: the live chat turn built a pre-flight `CostRange` estimate, emitted
it to the wire, then **discarded** it, and never compared it against the turn's
real cost. So calibration drift — the heuristic-accuracy signal the Cost
Dashboard surfaces (T-707) — was never recorded. This slice wires
`CalibrationLog.reconcile` into the chat handler's finalize point, the same
exactly-once seam as `recordSpend` (ADR-022) and the step recorder (ADR-035).
Pure core, no protocol/codegen change, CI-verified. The Cost Dashboard
**render** stays IDE-gated, and T-706 was already `[x]` for the engine, so
**no checkbox flips** — this completes the data path behind an existing box.

## Context

After ADR-035 the cost data path is live end-to-end: both turn handlers price
their usage at a clean exactly-once finalize point, persist a `StepEvent`, and a
`costReport` method aggregates the trail. The ONE shipped-but-unwired cost
primitive left was `CalibrationLog`. A fresh Explore seam-hunt confirmed it the
cleanest remaining pure-core seam — the two alternatives both carry
IDE/behavioral risk: `EditLoop` (agent/edit-loop.ts) would restructure how
`AgentTurnHandler` applies edits and needs a model-escalation hook that is
likely IDE-shaped (an M-sized behavior change); the status-row builder's own
header records that "the live AgentDriver phase-boundary wiring stays
IDE-deferred". `CalibrationLog` is additive, self-contained, and — critically —
the chat handler ALREADY computes the `CostRange` it needs for the comparison.

The pre-flight estimate exists only in the chat turn (`maybeEmitEstimate`); the
agent turn builds no estimate, so reconciling it would first require adding a
pre-flight estimate there — a separate, larger slice. Scope here is the chat
turn; the agent turn is a documented follow-up.

## Decision

Wire `CalibrationLog.reconcile` into `ChatHandler` at the finalize point, per
the AI-council fork resolutions (all UNANIMOUS):

- **A0 — CalibrationLog over EditLoop / status-rows.** Clean, additive, lowest
  CI risk; the estimate range already exists in the chat handler.
- **A1 — chat handler only.** The agent turn has no pre-flight estimate; adding
  one is a separate slice (follow-up).
- **A2 — return the `CostRange`.** `maybeEmitEstimate` now RETURNS the range it
  built (captured in a turn-local), so the finalize point reconciles against it
  with **no second `countInputTokens` call**.
- **A3 — optional injected dep.** `ChatHandler` gains `calibration?:
  CalibrationLog`; `buildCoreDispatcher` constructs one under the SAME
  `<state>/tracking` dir as the step trail (both are the Cost Dashboard
  backend). Absent → no-op (backward-compatible). Mirrors `BudgetRecorder` /
  `StepRecorder`.
- **A4 — reconcile api real cost AND cli shadow cost.** Drift is a
  heuristic-accuracy signal, not a billing event, so `cost.totalUsd` is used
  regardless of `isEstimate`. (Contrast `recordSpend`, which debits only real
  metered cost.)
- **A5 — skip cancelled.** A cancelled turn reaches finalize with partial spend;
  that is not a fair test of the estimate, so it is not reconciled. (An errored
  turn throws before finalize and never reaches the call.)
- **A6 — estimate-gated + fail-open.** Reconcile runs only when a pre-flight
  estimate was actually produced (pricing + known model + `countInputTokens`);
  any reconcile/append error is swallowed and never breaks the turn.

### Traps guarded (council)

- **Stale-estimate leakage** (gemini). The captured `CostRange` lives in a
  per-request method-local in `handleSend`, never a handler field — so turn B
  can never reconcile against turn A's estimate on a reused handler instance.
- **No double token-count** — the range is captured from the single
  `maybeEmitEstimate` call, never recomputed at finalize.
- **Exactly-once at finalize** — the call sits with `recordSpend`/`recordStep`,
  after the assistant turn is persisted; an errored turn (thrown earlier) never
  reaches it.
- **Strict `>` threshold** — owned by `CalibrationLog` (real must exceed
  `upper × 1.5`); an exactly-threshold turn does not log.
- **Same `conversationId`** as the estimate/step row; **shared tracking dir** so
  the dashboard reads one backend.

## Consequences

- The Cost Dashboard's "Calibration drift" KPI (T-707) now has a real data
  source: an over-threshold turn appends a row to
  `calibration-event-<YYYY-MM-DD>.jsonl` under `<state>/tracking`.
- No protocol/codegen change (`Protocol.kt` untouched); no native deps.
- No checkbox flips — T-706 was already `[x]` for the engine; T-707 render stays
  `[~]`. Dashboard counts UNCHANGED.
- Backward-compatible: with no `CalibrationLog` injected the handler behaves
  exactly as before.

## Alternatives considered

- **EditLoop (A0 rejected alt).** Higher value (multi-file edit cost lever) but
  a behavior change to the agent turn plus an escalation hook that is likely
  IDE-shaped — too much risk for an autonomous one-PR slice.
- **status-rows builder (A0 rejected alt).** Its own header defers the live
  AgentDriver phase-boundary wiring to the IDE; not a clean pure seam.
- **Recompute the estimate at finalize (A2/B2).** A second `countInputTokens`
  call — wasteful and risks a different value than the user saw.
- **Reconcile only real metered cost (A4/B4).** Would drop cli-shadow turns from
  the accuracy signal even though their book-rate math is identical.
- **Add a pre-flight estimate to the agent turn now (A1/B1).** A larger,
  separable slice; deferred as a follow-up.

## Sign-off

On flip to **Accepted**: no further action — the wiring is the whole change.
Follow-up (separate slice): add a pre-flight estimate to `AgentTurnHandler` and
reconcile it there too, so agentic turns also feed the calibration KPI.

## References

- `packages/core/src/cost/reconcile.ts` — `CalibrationLog` (T-706, shipped 2026-05-30).
- `packages/core/src/chat/handler.ts` — `maybeEmitEstimate` (now returns the range) + `maybeReconcile`.
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` constructs + injects the log.
- `packages/core/src/chat/handler-calibration.test.ts` — 7 wiring tests.
- ADR-035 — live step tracking + costReport (named T-706 out of scope).
- ADR-022 — BudgetRecorder finalize seam this reuses.
- road-to-v1-0 T-706 / T-707.
