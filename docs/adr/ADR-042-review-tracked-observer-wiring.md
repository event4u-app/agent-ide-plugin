---
adr: 042
title: Code Review — Wiring The Tracked ReviewObserver Onto The Live gitReviewSummary Path (T-CR-206)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 fork round — Q0=A (wire the dead T-CR-206 observer into the live path), Q2=A (gate caps on the live review — block a cap-blowing diff), Q3=A (map CapsBlockedError → coded cost_cap_blocked), Q4=A (optional GitHandlerDeps, build the observer inline when pricing+tracking present), Q5=A (mode 'api'), Q6=none (no double-count / correctness risk). SPLIT Q1 (conversation_id) resolved A — stable `review:<cwd>`: gemini's B premised a per-run id service that does NOT exist in core, and nothing keys on (conversation_id, step_index) uniqueness in the append-only JSONL trail; minimal-safe-diff wins, `ts` disambiguates runs)
related: completes the LIVE data path behind road-to-code-review T-CR-206 (Phase 2 — Cost + audit integration), which was marked `[x]` on its unit tests but whose observer (`review/observer.ts :: createTrackedReviewObserver`) had ZERO live callers. The cost-footer render + the pre-run 5× group-vote estimate dialog remain the Phase-4 IDE last-mile, so T-CR-206 stays `[x]` (engine-tested) with no checkbox change.
date: 2026-06-02
---

# ADR-042 — Code Review (wiring the tracked ReviewObserver, T-CR-206)

## Status

**Proposed** — awaits sign-off. One branch / one PR, two commit chunks
(core → docs), preserving minimal-safe-diff.

CI-verified locally: lint clean, `prettier --check` clean, build + typecheck
clean; core 1058 pass / 1 skip (+3); `jetbrains:check` BUILD SUCCESSFUL;
codegen idempotent at 53 DTOs (NO protocol change, `Protocol.kt` untouched).
**No checkbox flip** — T-CR-206 was already `[x]` (engine-tested); this slice
makes that `[x]` true on the live dispatch path.

## Context

The Explore seam-hunt re-ranked `EditLoop` (`agent/edit-loop.ts`) #1, but that
candidate was VERIFIED ARTIFICIAL again (ADR-039 precedent): it needs three
collaborators that do not exist (a `ModelEditStep.next()` adapter over the
backend, a sub-task decomposer, and an `onEscalate` model-tier swap), so wiring
it standalone into the iteration-based `AgentTurnHandler` is the artificial
wiring the project rejects.

The genuinely-clean seam is the **tracked `ReviewObserver`**
(`review/observer.ts :: createTrackedReviewObserver`, T-CR-206), shipped tested
but DEAD. The review pipeline is ALREADY live: the protocol method
`gitReviewSummary` → `GitHandler.reviewSummary()` → `runReview(backend, {
pipeline: { config } })`. `ReviewPipelineOptions` carries an optional
`observer?: ReviewObserver` and the pipeline USES it — `obs.checkCaps()` (throws
`CapsBlockedError(stage)` on a `block` verdict, PRE-stage so no spend),
`obs.onStage()` (writes a priced `activity:"review"` step event to
`tracking.db`), `obs.readFile()` (span validation against the working tree) —
but the live `reviewSummary()` passed NO observer, so review LLM stages were
neither cost-tracked nor cap-gated. The roadmap marked T-CR-206 `[x]` on the
strength of the observer's unit tests, but the live wiring was never done.

All collaborators were already constructed in `buildCoreDispatcher`: `TrackingDb`
(ADR-035), the injected `PricingBook`, and the `CapsEvaluator` (ADR-041, built
when caps settings + pricing are present, else inert). `GitHandler` was built
there too, but its `GitHandlerDeps` held none of `{tracking, pricing, caps}`.
`StepEventSchema.activity` already reserves the `'review'` value — the schema was
designed for exactly this. Only the wiring was missing.

## Decision

Add three optional fields to `GitHandlerDeps` — `tracking?: TrackingDb`,
`pricing?: PricingBook`, `caps?: CapsEvaluator` (Q4=A) — and in `reviewSummary()`
build a `createTrackedReviewObserver` ONLY when `pricing && tracking` are present
(mirroring the recording-no-ops-without-pricing gate the chat/agent step recorder
uses), passing it as `pipeline.observer`. `buildCoreDispatcher` shares the live
cost stack into `GitHandler`.

- **`conversation_id` = stable `review:<cwd>` (Q1=A).** A review action has no
  conversation; events group under one stable id per workspace. The cost report
  splits by `activity`/`mode`, not conversation, and the JSONL trail is
  append-only with no (conversation_id, step_index) uniqueness constraint, so a
  stable id is correct for every live consumer and the minimal-diff choice
  (resolving the council split against the code — no per-run id service exists,
  `ts` already disambiguates runs).
- **Caps gate the live review (Q2=A).** When a `CapsEvaluator` is present, each
  stage is checked PRE-call; a `block` verdict throws `CapsBlockedError` before
  the LLM call (no spend) — the same budget contract as the chat/agent pre-send
  gate (ADR-041). A large diff that would blow the daily / single-step cap is
  stopped, per stage, so a multi-group group-vote review cannot silently overshoot.
- **Block surfaces as a coded error (Q3=A).** `reviewSummary()` catches
  `CapsBlockedError` and rethrows `GitRequestError('cost_cap_blocked', msg)`, so
  the dispatcher returns a coded response mirroring the chat/agent
  `stopReason: 'cost_cap_blocked'`; the IDE can show a budget-exceeded notice
  rather than a generic `handler_error`.
- **`mode: 'api'` (Q5=A).** The sidecar is the IDE backend path; `'cli'` stays
  reserved for the subscription-CLI shadow path.

**Traps guarded (council Q6 = none, confirmed):** one observer is reused across
all stages of a run with a monotonically incrementing `step_index` from 0; if a
later stage errors after earlier stages already wrote rows, those rows stay —
real cost was incurred, append-only is correct; the per-stage block check gates
a multi-group review per stage, never overshooting after a cap is reached.

## Consequences

**Positive.** The review cost + cap subsystem (T-CR-206) has its first live
wiring: a "Review changes" action now records priced `activity:"review"` step
events into the same trail `costReport` reads (so the cost dashboard's `byMode`
view splits review spend), and respects hard caps — pure-core enforcement that
holds even without the IDE. No protocol/codegen change (the `gitReviewSummary`
contract is unchanged; the observer is internal), no native deps, additive/optional
deps throughout — an untracked review (no pricing book) behaves exactly as before.

**Negative / limits.** The cost-footer render and the pre-run 5× group-vote
estimate dialog remain the Phase-4 IDE layer (road-to-code-review acceptance
criteria already scope them to the UI). `conversation_id` is a stable workspace
id, so two reviews of the same workspace share it — distinguished only by `ts`
today; a per-run suffix is a trivial follow-up if a review-correlation feature
ever lands.

**Checkbox.** road-to-code-review T-CR-206 stays `[x]` (engine-tested); its note
is extended to record that the live wiring landed here. Overall done count
UNCHANGED (141 / 290) — no checkbox flips.

## Alternatives considered

- **`EditLoop` wiring (seam-hunt #1).** Rejected — verified artificial (missing
  ModelEditStep / decomposer / onEscalate model-tier), the third cycle this
  candidate was over-ranked (ADR-039).
- **Fresh per-run `conversation_id` (Q1=B).** Rejected — premised on a per-run
  id service that does not exist in core (only local bm25/mcp counters);
  `Date.now()`/`crypto.randomUUID` would add non-determinism to the handler and
  buy nothing today, since no consumer keys on conversation uniqueness.
- **An optional `conversationId` on `GitReviewSummaryRequest` (Q1=C).** Rejected —
  a protocol/codegen change for a field with no live consumer; violates
  no-protocol-change-unless-required.
- **Tracking-only, no caps on review (Q2=B).** Rejected — the council judged
  budget protection should be consistent across all agent actions, and a
  group-vote review (5× per group) is exactly where an unbounded cost can hide;
  the pre-stage gate is the right place to stop it.
- **A bare `throw` for the cap block (Q3=B).** Rejected — without a `.code` the
  dispatcher surfaces it as `handler_error`; the coded `cost_cap_blocked` gives
  the IDE a specific render path.

## References

- `packages/core/src/git/handler.ts` — `GitHandlerDeps` (+`tracking`/`pricing`/
  `caps`); `reviewSummary()` observer construction + `CapsBlockedError` →
  `GitRequestError('cost_cap_blocked')` mapping.
- `packages/core/src/review/observer.ts` — `createTrackedReviewObserver` (the
  reused, previously dead factory).
- `packages/core/src/review/pipeline.ts` — `ReviewObserver` hooks +
  `CapsBlockedError`.
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` shares `tracking` /
  `pricing` / `capsEvaluator` into `GitHandler`.
- `packages/core/src/git/handler.test.ts` — 3 new tests (priced `review` step
  event under `review:<cwd>`; cap-block → coded `cost_cap_blocked`; untracked
  no-throw without pricing).
- `packages/core/src/tracking/db.ts` — `StepEventSchema` (the reserved `'review'`
  activity).
- road-to-code-review T-CR-206 (Phase 2 — Cost + audit integration, shipped
  engine-tested 2026-05-29).
- ADR-035 (live step tracking — the trail this writes to), ADR-041 (caps pre-send
  gate — the budget contract this extends to the review path).
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2) — fork round.

## Sign-off

On flip to **Accepted**: carry the Phase-4 IDE render (the review cost footer
reusing the MVP cost footer, and the pre-run 5× group-vote estimate dialog) into
the IDE slice; optionally add a per-run `conversation_id` suffix if a
review-correlation view is built.
