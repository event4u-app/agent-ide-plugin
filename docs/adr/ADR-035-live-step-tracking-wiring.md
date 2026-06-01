---
adr: 035
title: Live Step-Event Tracking + costReport — Wiring The Cost Data Path (TrackingDb Step Recording In Both Turn Handlers + A costReport Read Method Backing The Cost Dashboard, T-707)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini-cli, 2026-06-02 seam-selection + fork round — UNANIMOUS Q0=A full data path, Q1=A narrow StepRecorder, Q2=A skip-without-version, Q3=A errored-never/cancelled-records, Q4=A history-derived step_index, Q5=A focused aggregate, Q6=A caps out of scope, Q7=A optional costReporter dep; both flagged the same traps — real-vs-shadow usd, positive pricing_book_version, exactly-once on cancel, never on error, restart-safe step_index, hand-maintained codegen, calibration out of scope, inclusive window, unknown-model handling, concurrent append, shared pricing book)
related: makes road-to-v1-0 T-707 (Cost Dashboard v0) backend LIVE — the dashboard render stays IDE-gated but now has a real data source (recorded step trail + shadow cost); makes road-to-mvp Phase-5 exit "tracking.db has rows for every step" engine-true; wires the shipped-but-uncalled TrackingDb (MVP T-408), shadow-cost (T-1404), and reuses the BudgetRecorder finalize seam (ADR-022); caps pre-flight (T-411a) + CalibrationLog drift (T-706) deliberately out of scope
date: 2026-06-02
---

# ADR-035 — Live Step-Event Tracking + costReport (Cost Data Path)

## Status

**Proposed** — awaits sign-off. The cost/tracking subsystem shipped fully built
and tested but was **never wired live**: nothing constructed a `TrackingDb` in
the dispatcher, no live chat/agent turn recorded a `step_events.jsonl` row, and
`cost/shadow.ts` `summarizeShadowCost` had zero production callers (no recorded
steps to read). The only writer, `review/observer.ts` `createTrackedReviewObserver`
(T-CR-206), was itself unwired. So the Cost Dashboard (T-707) had no real data
and the road-to-mvp Phase-5 exit "tracking.db has rows for every step" was
unmet at the engine level. This slice wires the **write side** (one priced step
per turn from both turn handlers) and the **read side** (a `costReport` method
that aggregates the trail). Pure core + protocol, CI-verified. The Cost
Dashboard **render** stays IDE-gated, so **no checkbox flips** — T-707 stays `[~]`.

## Context

`TrackingDb` (MVP T-408, append-only JSONL `step_events.jsonl`), `CapsEvaluator`
(T-411a), `summarizeShadowCost` (T-1404), `CalibrationLog` (T-706) and the
multi-provider fixtures (T-507) are all shipped. The live turns price their
usage for the `BudgetRecorder` (ADR-022) at a clean exactly-once finalize point
but never persisted a step row. A seam-hunt confirmed the tracking subsystem as
the single largest self-contained pure-core seam left (the ADR-034 note named it
explicitly as "a LEGIT bigger slice"). It is autonomous: no IDE render, no
native deps (JSONL, no SQLite), no release infra.

## Decision

Record one priced `StepEvent` per turn from both handlers, and add a
`costReport` read method backed by the recorded trail.

1. **Full data path in one slice (Q0=A).** Write side + read side ship together
   so T-707 gets a real backend contract and the write side is verifiable
   end-to-end, not a recorder with no reader.

2. **Narrow `StepRecorder` seam (Q1=A).** `tracking/step-recorder.ts` defines
   `StepRecorder { writeStep(StepEvent) }` (the `TrackingDb` satisfies it
   structurally) + a pure, clock-injectable `buildStepEvent`. Both handlers gain
   an optional `step?` dep and call it at the **same finalize point as
   `recordSpend`** — so step recording inherits the budget recorder's
   exactly-once + never-on-error semantics.

3. **Skip without a version (Q2=A).** A row requires a positive
   `pricing_book_version` (schema hard-gate). Recording is gated on a pricing
   book + known model (the same gate as the pre-send estimate); an unpriced or
   unknown-model turn is simply not tracked rather than recorded with an invalid
   sentinel.

4. **Errored never, cancelled records (Q3=A).** An errored turn throws before
   finalize → never recorded (matches `recordSpend`). A cancelled turn records
   its partial usage at most once — tokens were consumed, so the dashboard
   should reflect real consumption. `usd` is the recorded **book-rate** cost:
   real for `api` steps, the shadow figure for `cli` (a flat subscription).

5. **Restart-safe step_index (Q4=A).** Derived from the count of prior assistant
   turns in the persisted conversation history — deterministic and survives a
   restart, with no process-local counter that would collide.

6. **Focused aggregate response (Q5=A).** `costReport` returns
   `{ totalUsd, stepCount, byActivity, byMode, byModel, shadowApiUsd, cliStepCount }`
   over an optional inclusive `{since,until}` window (matching
   `TrackingDb.totalUsd`). `byMode` cleanly splits real (`api`) from shadow
   (`cli`) spend; `shadowApiUsd` is the explicit CLI-only figure recomputed from
   token counts by `summarizeShadowCost` (independent of the stored `usd`). The
   client renders donuts/bars; it never re-derives accounting rules.

7. **Caps + calibration out of scope (Q6=A).** Wiring `CapsEvaluator` pre-flight
   is a behaviour change (block/confirm) whose dialog is IDE; `CalibrationLog`
   drift (T-706) has its own log. Both stay separate slices.

8. **Optional `costReporter` dispatcher dep (Q7=A).** A new optional 7th ctor
   param + `requireCost()` → `cost_not_configured` when absent, mirroring
   `requireGit`/`requireTerminal`. `buildCoreDispatcher` constructs one
   `TrackingDb` under `<cwd>/<state>/tracking` and uses it for BOTH the handler
   `step` injection and a `DefaultCostReporter` (sharing the same pricing book —
   trap both reviewers flagged).

`scripts/codegen.ts` is hand-maintained: the two new DataClasses
(`CostReportRequest`, `CostReportResponse`, the latter with `Map<String, Double>`
fields — a first for the codegen, emitted verbatim and natively serializable)
were added alongside the Zod schemas; the `Methods` registry + its pin test gain
`costReport`. Codegen regenerated idempotently (48 → 50 DTOs).

## Consequences

- **Positive.** The cost data path is real end-to-end and CI-tested: live turns
  persist priced step rows, and `costReport` aggregates them (incl. CLI shadow
  cost). When the Cost Dashboard webview (T-707) lands it has a real source; the
  road-to-mvp Phase-5 exit is engine-true. Recording is additive + fail-open —
  a tracking write error never breaks a turn, and absent pricing it no-ops.
- **Negative / deferred.** No checkbox flips: the dashboard render (T-707) is
  IDE-gated and stays `[~]`; the Phase-5 demo gate stays `[ ]` (a human/IDE
  demo). Concurrent cross-conversation appends follow the existing audit/budget
  JSONL precedent (single small line per turn); a write queue is out of scope.
  Caps pre-flight + calibration drift remain separate slices.
- **No-change.** `summarizeShadowCost`, `TrackingDb`, the budget path, and the
  fixtures are untouched. The Methods-keys pin test gains one entry.

## Alternatives considered

- **Q0 B/C (write-only or read-only)** — a recorder with no reader can't be
  validated end-to-end; a reader with no writer returns empty in practice.
- **Q1 B/C (inject full TrackingDb / per-iteration observer)** — couples the
  handler to JSONL or to a richer per-call surface; the narrow recorder + a
  single per-turn row (aggregated usage) is the minimal seam.
- **Q3 B (skip cancelled)** — undercounts real token consumption on the
  dashboard.
- **Q4 B (in-memory counter)** — collides after a restart, corrupting the
  append-only ordering.
- **Q5 B/C (minimal fields / raw events)** — minimal loses the donut/bar inputs;
  raw events push accounting into the IDE clients.
- **Q6 B (caps now)** — a behaviour change (blocking) bundled into a data-path
  slice; rejected for minimal-safe-diff.

## Sign-off

On flip to **Accepted**: no PLAN.md section change required (data-path slice).
The next IDE-layer sprint renders the Cost Dashboard (T-707) from `costReport`
and surfaces the CLI shadow cost next to the subscription quota. Re-run the
Explore seam-hunt before assuming the pure-core runway is exhausted — it has
been wrong on every PR so far.

## References

- `packages/core/src/tracking/step-recorder.ts` — `StepRecorder` + `buildStepEvent` (the write seam).
- `packages/core/src/tracking/db.ts` — `TrackingDb` (MVP T-408, the trail).
- `packages/core/src/cost/report.ts` — `summarizeCostReport` + `DefaultCostReporter` + `CostRequestError`.
- `packages/core/src/cost/shadow.ts` — `summarizeShadowCost` (T-1404, the CLI shadow figure).
- `packages/core/src/chat/handler.ts` + `packages/core/src/agent/turn-handler.ts` — `recordStep` at the `recordSpend` finalize point.
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` constructs the shared `TrackingDb` + `DefaultCostReporter`.
- `packages/core/src/server.ts` — the `costReport` route + `requireCost()`.
- `packages/protocol/src/schema.ts` — `CostReport{Request,Response}`, the `Methods` entry.
- ADR-022 — the `BudgetRecorder` finalize seam this mirrors.
- road-to-v1-0.md Phase 7 T-707 (Cost Dashboard backend) + road-to-mvp.md Phase 5 exit gate.
