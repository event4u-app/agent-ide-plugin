---
adr: 022
title: Chat Cost & Budget Wiring — Pre-Send Estimate Envelope + Injected Budget Recorder in the Chat Handler (Early done:false Estimate, Recorder Injection, Flag-Not-Block, Real-Cost-Only Debit)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini-cli, 2026-06-01 cost-wiring design round — UNANIMOUS forks B (seam choice) / B1 (early estimate envelope) / B-inj (recorder injected into ChatHandlerDeps) / B-warn (flag overBudget, never block); both reviewers independently flagged the cancel "ghost-spend" double-count trap)
related: road-to-product-readiness T-PRD06 (cost UX, full); threads the shipped cost modules `cost/estimate.ts` (ADR-007), `cost/budget.ts` (ADR-014), `cost/shadow.ts`; extends the chat-RPC handler shipped by the vertical slice (ADR-010); the composer-footer render stays deferred to the IDE-runtime sprint
date: 2026-06-01
---

# ADR-022 — Chat Cost & Budget Wiring

## Status

**Proposed** — the next pure-core seam for road-to-product-readiness. The three
cost modules (`estimate.ts`, `budget.ts`, `shadow.ts`) shipped standalone and
unit-tested but were never wired into the live `chatSend` path; the council that
landed `budget.ts` (ADR-014) explicitly deferred the handler wiring "until a
protocol/UI consumer exists for the warning." This ADR is that wiring. The
composer-footer RENDER (pre-send / live / final cost + the daily-budget bar) is
the IDE last-mile and stays deferred — so T-PRD06 stays `[~]`.

## Context

`chat/handler.ts` drives a provider-direct turn: it streams tokens, persists the
turn, and returns a `ChatCost` on the terminal envelope. Three product-readiness
acceptance points (T-PRD06) were unmet on the live path: *see a pre-send
estimate · watch live cost · hit a daily-budget warning*. The cost vocabulary to
satisfy them already existed but sat unconnected:

- `cost/estimate.ts` — `estimateCost(book, input) → CostRange` (a `lower / typical
  / upper` range, since output length + cache state are unknown pre-turn).
- `cost/budget.ts` — `DailyBudgetTracker.record(usd) → BudgetStatus` (date-rotated
  JSONL spend log, injectable clock + dir, soft warning at `ratio ≥ 0.8`).
- `LlmBackend.countInputTokens?(request)` — an optional best-effort local token
  count (some backends cannot count → `undefined`).

The remaining roadmap `[ ]` task items across all roadmaps are IDE-render /
human / infra gated; this is the cleanest bounded pure-core seam that advances a
real acceptance criterion without over-reaching into the full agent/tool loop
(Seam A) — the council's fork-B choice.

## Decision

1. **Seam B — cost & budget wiring (fork B).** Thread the three shipped cost
   modules into the live `chatSend` path rather than expose the AgentDriver
   (Seam A, deferred again — large, touches the protocol method set) or add
   per-argument permission scoping (Seam C, narrower, no acceptance criterion).

2. **Pre-send estimate as an early `done:false` envelope (fork B1).** Before the
   first token, the handler emits one `done:false` envelope carrying a
   `ChatEstimate` (`{ model, inputTokens, lowerUsd, upperUsd, typicalUsd }`), so
   the composer can show the estimate *while* the turn runs — not as post-hoc
   metadata on the terminal response. It is best-effort: skipped silently unless
   a pricing book, a known model, AND a local `countInputTokens` are all present,
   and any failure inside it is swallowed so the turn still runs. Clients tell the
   two `done:false` shapes apart by key presence (`estimate` vs `token`); existing
   `ChatTokenEvent` is untouched.

3. **Budget recorder injected into `ChatHandlerDeps` (fork B-inj).** An optional
   `budget?: BudgetRecorder` (a narrow `{ record, status }` surface that
   `DailyBudgetTracker` satisfies structurally) mirrors the optional
   `AuditRecorder` injection in `agent/approval.ts`. The handler owns the turn
   lifecycle (success / error / cancel / actual usage), so it is the right place
   to record spend — not the dispatcher. Absent recorder → no behaviour change
   (the `budget` response field is omitted; older clients parse unchanged).

4. **Flag `overBudget`, never block (fork B-warn).** The handler records spend and
   returns the resulting `ChatBudgetStatus` on the terminal response; an
   already-over-budget state is surfaced, not refused. The hard-cap confirm dialog
   is an IDE policy surface — the core only ever flags.

5. **Debit only real metered cost; record exactly once (the shared trap).** Spend
   is recorded only when `!cost.isEstimate && totalUsd > 0`: a CLI-mode shadow
   cost and an unpriced turn read `status()` without debiting a real-dollar
   budget. The single `record`/`status` call sits on the normal + cancel paths but
   **after** the error throw, so an errored turn never debits, a cancelled turn
   debits at most once (with whatever partial usage the provider reported — `$0`
   when none arrived, never a phantom double-count), and a recorder failure is
   fail-open (the turn completes, `budget` is simply omitted).

6. **Composition-root injection point.** `buildCoreDispatcher` gains an optional
   `cost?: { dailyBudgetUsd?, warningThresholdRatio? }` that builds a
   `DailyBudgetTracker` under `<cwd>/<state>/cost`, plus a `budget?` test override.
   Production wiring from `.agent-settings.yml`'s `cost` key is an IDE-runtime
   follow-up, exactly like the still-unwired pricing book.

## Consequences

- `ChatSendResponse` gains an optional `budget?: ChatBudgetStatus`; the wire adds
  `ChatEstimate`, `ChatEstimateEvent`, `ChatBudgetStatus` schemas + Kotlin DTOs via
  the existing flat codegen emitter. All additive — no method added, the
  `Methods`-keys pin test is unaffected.
- T-PRD06's live-path acceptance (pre-send estimate + live/final cost + daily
  warning) now has a core implementation; only the composer-footer render remains,
  so T-PRD06 stays `[~]`.
- No behaviour change for any existing caller: estimate is skipped without
  `countInputTokens` (every current scripted backend), and `budget` is omitted
  without an injected recorder.

## Alternatives considered

- **Seam A — expose the AgentDriver / tool loop to chat.** Deferred again: the
  single most valuable capability but large and protocol-touching; over-reaches a
  bounded slice. The approval/tool pieces it needs (ADR-013) have shipped, so it is
  the natural *next* seam after this one.
- **B2 — estimate only on the terminal response.** Rejected: a "pre-send" estimate
  the user sees only after the turn finishes is post-hoc metadata, not informed
  consent (council B1).
- **B-disp — record spend in the dispatcher after the handler returns.** Rejected:
  the dispatcher lacks the cancel / partial-usage / error context the exactly-once
  debit needs; recording belongs where the turn lifecycle lives (council B-inj).
- **B-block — refuse a turn when already over budget.** Rejected for the core: a
  hard block needs a one-time-exception UI the IDE owns; the core flags and lets
  the client mediate (council B-warn).
- **Record the pre-send estimate into the spend log.** Rejected: `DailyBudgetTracker.
  spentOn` sums every row, so logging both an estimate and an actual would
  double-count. Only reconciled actuals are recorded; `SpendRecord.isEstimate`
  stays reserved for a future estimate-aware view.

## References

- `packages/core/src/chat/handler.ts` — `maybeEmitEstimate`, `recordSpend`, the
  injected `budget?: BudgetRecorder` dep.
- `packages/core/src/cost/estimate.ts` · `cost/budget.ts` (`BudgetRecorder`) ·
  `cost/shadow.ts` — the threaded cost modules.
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` `cost` / `budget` options.
- `packages/protocol/src/schema.ts` — `ChatEstimateSchema`, `ChatEstimateEventSchema`,
  `ChatBudgetStatusSchema`, the extended `ChatSendResponseSchema`.
- `scripts/codegen.ts` — `ChatEstimate` / `ChatEstimateEvent` / `ChatBudgetStatus`
  Kotlin DTOs.
- ADR-007 (estimate) · ADR-010 (chat-RPC handler) · ADR-013 (approval) · ADR-014
  (budget tracker) — the prior slices this threads.
- road-to-product-readiness T-PRD06.
