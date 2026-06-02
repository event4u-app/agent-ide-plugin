---
adr: 037
title: Agent-Turn Cost Estimate + Calibration-Drift Reconciliation — Wiring The Pre-Flight Estimate And CalibrationLog Into The Agentic Loop (T-705/T-706, The ADR-036 A1 Follow-Up)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 fork round — UNANIMOUS Q0=A reconcile-only-single-iteration, Q1 mirror maybeEmitEstimate from the iteration-1 request incl. tools+system, Q2 method-local CostRange + inject calibration dep, Q3 errored throws before finalize; both independently flagged the same traps — count tool-definition tokens or under-predict drift, evaluate iterations at loop end not maxIterations, keep maybeEmitEstimate fail-open against token-counters that reject tool schemas, method-local never a handler field)
related: completes the documented ADR-036 follow-up ("add a pre-flight estimate to AgentTurnHandler and reconcile it there too"). Makes road-to-v1-0 T-705 (pre-flight estimate) + T-706 (reconciliation) LIVE for the agentic turn — the chat turn got both in ADR-036; this slice gives the agent turn the same treatment. Backs the Cost Dashboard "Calibration drift" KPI (T-707, render stays IDE-gated). Reuses the recordSpend/recordStep finalize seam (ADR-022/ADR-035).
date: 2026-06-02
---

# ADR-037 — Agent-Turn Estimate + Calibration-Drift Reconciliation (Wiring T-705/T-706)

## Status

**Proposed** — awaits sign-off. ADR-036 wired the pre-flight estimate +
`CalibrationLog.reconcile` into `ChatHandler` and explicitly named the agent
turn a follow-up: *"the agent turn has no pre-flight estimate; adding one is a
separate slice"*. This slice is that follow-up. `AgentTurnHandler` now emits a
pre-flight `CostRange` estimate before the loop (mirroring `ChatHandler`) and
reconciles its aggregated real cost against that estimate at the same
exactly-once finalize point as `recordSpend`/`recordStep` — but **only for a
single-iteration turn** (the council's decisive Q0=A). Pure core, no
protocol/codegen change (`Protocol.kt` untouched), CI-verified. The Cost
Dashboard **render** stays IDE-gated and T-705/T-706 were already `[x]` for the
engine, so **no checkbox flips** — this completes the agent-turn half of an
existing data path.

## Context

After ADR-036 the chat turn estimates its cost pre-flight, emits the range to
the wire, and reconciles real-vs-estimate drift at finalize — feeding the Cost
Dashboard's calibration KPI (T-707). The agent turn (`AgentTurnHandler`, the
LLM↔tool loop that edits files) did neither: it built no estimate and held no
`calibration` dep, so an agentic turn never contributed to the accuracy signal,
and the composer had no cost preview while an agent turn ran.

A fresh Explore seam-hunt ranked this the cleanest, highest-value remaining
pure-core seam — exactly the slice the ADR-036 follow-up named. The two
alternatives both carry IDE/behavioral risk: `EditLoop` (agent/edit-loop.ts) is
an M-sized behavior change to how the agent applies edits plus a likely
IDE-shaped escalation hook; the status-row builders defer their live wiring to
the IDE-gated AgentDriver. Adding the estimate/reconcile mirror is additive,
self-contained, and reuses primitives already proven in the chat handler.

**The decisive tension — a loop is not a single turn.** A pre-flight estimate
can only be computed from the FIRST iteration's request (seed messages + system
+ tool defs + a single iteration's `max_tokens`). But the agent turn's REAL cost
aggregates across N iterations: each iteration appends the prior assistant
message + tool results, so input tokens GROW per iteration and output is billed
per iteration. Reconciling a multi-iteration loop's aggregated cost against a
single-iteration estimate's `upper × 1.5` would trip the drift threshold on
nearly every multi-tool turn — drowning the genuine "the estimator is
miscalibrated" signal in structural loop noise. The council resolved this.

## Decision

Wire a pre-flight estimate + `CalibrationLog.reconcile` into `AgentTurnHandler`,
per the AI-council fork resolutions (all UNANIMOUS):

- **Q0 — reconcile ONLY a single-iteration turn (`iterations === 1`).** The
  decisive fork. A single-iteration pre-flight estimate is a fair accuracy test
  ONLY of a turn that ran exactly one streamed LLM request; a multi-iteration
  loop is a structurally different cost object and is skipped — exactly the same
  "not a fair test" principle that skips a cancelled turn (ADR-036 A5). The
  estimate is STILL emitted for every turn (composer preview value); only the
  reconcile is gated. Rejected: always-reconcile (B, structural drift noise),
  estimate-but-never-reconcile (C, drops single-iteration turns from the signal
  for no benefit), scale-by-maxIterations (D — most turns stop early and input
  growth is nonlinear, so the scaled bound is wrong both ways).
- **Q1 — mirror `maybeEmitEstimate` exactly.** Same gate (pricing + known model
  + `backend.countInputTokens`); emit `data:{estimate}` as the third `done:false`
  shape on the `agentTurn` stream. The protocol comment ALREADY reserves the
  `estimate` key (`token` / `estimate` / `toolEvent`, distinguished by key
  presence, reusing the `ChatEstimate` wire shape) → **no protocol/codegen
  change**. The estimate is built from the iteration-1 request AFTER mode-tool
  filtering + system composition, so it counts the tool definitions and system
  block the model is billed for (council trap: estimating before that
  under-counts).
- **Q2 — method-local `CostRange` + injected dep.** `maybeEmitEstimate` returns
  the range (captured in a per-request method-local in `handleTurn`, never a
  handler field — the stale-estimate-leakage trap), so finalize reconciles with
  no second `countInputTokens` call. `AgentTurnHandlerDeps` gains `calibration?:
  CalibrationLog`; `buildCoreDispatcher` injects the SAME log instance the chat
  handler uses (one `<state>/tracking` backend for the dashboard).
- **Q3 — errored throws before finalize.** A backend error ends the turn before
  the finalize block, so it never reconciles — exactly like recordSpend/
  recordStep. An already-emitted estimate envelope is a preview, not a
  commitment that a terminal comparison will follow.

### Traps guarded (council)

- **Single-iteration test = one streamed request** (codex). `iterations === 1`
  is evaluated at loop end against the real loop counter, NOT `maxIterations`. A
  first iteration that emits tool calls and then stops at `maxIterations: 1` is
  still one billed request and is fairly reconciled; any second LLM request
  after tool results pushes `iterations` to 2 and skips reconcile.
- **Count tool-definition tokens** (both). The estimate request carries `tools`
  + `system`, so `countInputTokens` prices what the provider bills; estimating
  the bare messages would under-predict and manufacture single-iteration drift.
- **Stale-estimate leakage** (gemini, carried from ADR-036). The `CostRange`
  lives in a method-local in `handleTurn`, never a handler field.
- **Fail-open estimate** (codex). A provider token-counter may reject tool
  schemas even when streaming accepts them; `maybeEmitEstimate` swallows any
  error → `undefined`, and the turn still runs.
- **Exactly-once at finalize** — the reconcile call sits with recordSpend/
  recordStep, after the assistant turn is persisted.

## Consequences

- The Cost Dashboard's "Calibration drift" KPI (T-707) now also has an
  agent-turn data source: an over-threshold SINGLE-iteration agent turn appends
  a row to `calibration-event-<YYYY-MM-DD>.jsonl` under `<state>/tracking` (the
  same file the chat turn writes — one backend).
- The composer can show a cost preview while an agent turn runs (the estimate
  envelope), parity with the chat turn.
- No protocol/codegen change (`Protocol.kt` untouched); no native deps.
- No checkbox flips — T-705/T-706 were already `[x]` for the engine; T-707
  render stays `[~]`. Dashboard counts UNCHANGED.
- Backward-compatible: with no `CalibrationLog` injected the handler reconciles
  nothing; with no pricing/token-counter it emits no estimate — exactly as before.

## Alternatives considered

- **Always reconcile, any iteration count (Q0/B).** Multi-iteration turns would
  trip drift structurally — true ("agent loops cost more than one request") but
  useless as calibration data; it would bury the real miscalibration signal.
- **Emit the estimate but never reconcile the agent turn (Q0/C).** Drops even
  the fair single-iteration turns from the accuracy signal for no benefit.
- **Scale the estimate bounds by `maxIterations` (Q0/D).** Most turns stop well
  before the cap and per-iteration input growth is nonlinear, so the scaled
  envelope is wrong in both directions; not a meaningful accuracy test.
- **EditLoop / status-rows seam.** Both carry IDE/behavioral risk (see Context);
  not clean pure seams for an autonomous one-PR slice.

## Sign-off

On flip to **Accepted**: no further action — the wiring is the whole change.
Possible later refinement (separate slice, only if the signal warrants it): a
loop-aware estimate that re-projects per iteration so multi-iteration turns can
also be reconciled against a meaningful bound — explicitly out of scope here.

## References

- `packages/core/src/agent/turn-handler.ts` — `maybeEmitEstimate` (returns the range) + `maybeReconcile` (single-iteration gate).
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` injects the shared `CalibrationLog`.
- `packages/core/src/agent/turn-handler-calibration.test.ts` — 8 wiring tests (incl. the multi-iteration-skip Q0=A case).
- `packages/core/src/cost/reconcile.ts` — `CalibrationLog` (T-706, shipped 2026-05-30).
- `packages/core/src/cost/estimate.ts` — `estimateCost` / `CostRange` (T-705).
- ADR-036 — chat-turn estimate + reconcile; named this agent-turn slice the follow-up.
- ADR-035 — live step tracking + costReport; ADR-022 — BudgetRecorder finalize seam.
- road-to-v1-0 T-705 / T-706 / T-707.
