---
adr: 041
title: Cost Caps — Wiring CapsEvaluator As A Pre-Send Gate On The Chat + Agent Turn (T-411a host integration)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 fork round — UNANIMOUS on all seven questions: Q0=A (caps over the status-rows seam), Q1=A (reuse the pre-send estimate event for warn/confirm + a terminal `cap` field for block, one `CapVerdict` DTO), Q2=B (a `block` is a controlled policy refusal — `stopReason: 'cost_cap_blocked'`, not an error), Q3=A (a `confirm` PROCEEDS + surfaces pre-IDE — the confirm modal round-trip does not exist yet; blocking now would deadlock turns), Q4=A (wire both the chat AND agent turn), Q5=A (both single_step + daily families), Q6=A (reuse the one input-token count — no second countInputTokens))
related: discharges the BACKEND half of T-411a / T-411b host integration (road-to-mvp-ui-finish Phase 4). The `CapsEvaluator` shipped engine-complete (road-to-mvp T-411a, 2026-05-29) with ZERO live callers on the send path — its only consumer (`review/observer.ts`) was itself never constructed. This slice constructs one in `buildCoreDispatcher` and gates the live chat + agent send path; the chat-input footer / yellow banner / disabled-button render + the soft-confirm modal round-trip remain the IDE last-mile, so the host-integration task stays `[~]`.
date: 2026-06-02
---

# ADR-041 — Cost Caps (wiring CapsEvaluator as a pre-send gate, T-411a host integration)

## Status

**Proposed** — awaits sign-off. One branch / one PR, three commit chunks
(protocol + codegen → core → docs), preserving minimal-safe-diff.

CI-verified locally: lint clean, `prettier --check` clean, typecheck clean;
protocol 51 pass (+5), core 1055 pass / 1 skip (+13); `jetbrains:check` BUILD
SUCCESSFUL; codegen idempotent at 53 DTOs (+1, `CapVerdict`). **No checkbox
flip to `[x]`** — the host-integration task moves `[ ]`→`[~]` (backend gate
landed; IDE render is the last mile).

## Context

The Explore seam-hunt for the next pure-core seam re-ranked `statusRowsForMode`
(`agent/status-rows.ts`) #1, but that candidate was VERIFIED ARTIFICIAL again:
the live `AgentTurnHandler` loop is ITERATION-based, not phase-based, so it could
only emit static all-`pending` rows with no lifecycle transitions
(`transitionStatusRow` needs phase boundaries the loop never emits). The council
confirmed the rejection (Q0=A).

The genuinely-clean seam is the **`CapsEvaluator`** (`tracking/caps.ts`, T-411a),
which shipped tested but DEAD: its `evaluate()` projects an upper-bound cost from
the counted input tokens + the model's output ceiling and returns a verdict
(`allow | warn | confirm | block`) against `tracking.caps.{single_step,daily}`
thresholds — and its doc says it should fire "on every send", but no composition
root ever built one for the chat/agent send path. Its only reference
(`review/observer.ts :: createTrackedReviewObserver`) is itself never constructed
in `buildCoreDispatcher`, so the whole cap subsystem was dead.

All collaborators were already live from prior PRs: `PricingBook` (injected),
`TrackingDb` (constructed in `buildCoreDispatcher`, exposes `totalUsd({since})`
for the daily window), and `backend.countInputTokens` + the `max_tokens` output
cap (already used by the pre-send estimate path). Only the wiring was missing —
the established "wire a tested-but-dead seam into the live dispatch path" shape.

## Decision

Construct ONE `CapsEvaluator` in `buildCoreDispatcher` (when `tracking.caps`
settings AND a pricing book are present; reads the same `tracking` trail for the
daily total) and inject it into BOTH the chat and agent turn handlers (Q4=A).
Each handler folds the cap evaluation into its existing pre-send `preflight`
(renamed from `maybeEmitEstimate`): it counts input tokens ONCE, builds the
estimate range, AND evaluates caps from the same projection (Q6=A — no second
`countInputTokens`; the output cap passed to `evaluate()` is the exact
`max_tokens` sent to the provider, so the projection cannot drift).

**Verdict handling (AI council 2026-06-02, UNANIMOUS):**

- **`block` refuses the turn pre-send (Q2=B).** Before the provider stream
  (chat) / before the loop (agent), with no spend recorded, no step row, no
  assistant message persisted. The terminal response carries `stopReason:
  'cost_cap_blocked'`, empty text, $0 cost, and the verdict on a new optional
  `cap` field. A controlled policy refusal — NOT a coded error — so the IDE
  renders the disabled-button message from `cap` rather than hitting an error
  boundary. The agent turn additionally reports `iterations: 0`.
- **`warn` / `confirm` PROCEED and ride the pre-send estimate event (Q1=A,
  Q3=A).** The verdict is added to the existing `ChatEstimateEvent` (`{estimate,
  cap?}`) — the same `done:false` envelope the composer already renders. The
  turn runs normally. The soft-confirm MODAL is an IDE round-trip that does not
  exist yet (no confirm-resolve protocol method); blocking on `confirm` now
  would silently turn a configurable threshold into an unusable hard stop with
  no escape (the council's "deadlock" trap), so `confirm` surfaces and proceeds,
  forward-compatible with a future IDE interception.
- **`allow` is never surfaced.** No caps configured → the evaluator returns
  `allow` (default `{}` settings) → the gate is inert; absent evaluator → no gate
  at all (backward-compatible).
- **Both `single_step` + `daily` (Q5=A).** The daily window reads
  `TrackingDb.totalUsd` (already live); the evaluator owns the threshold logic.

**Traps guarded (council Q6 + both reviewers):**

- **Caps fail open INDEPENDENTLY of the estimate.** An evaluator error (e.g. a
  torn daily-spend read) is swallowed to `undefined` — it neither blocks the
  turn NOR suppresses the estimate event. A cap NEVER blocks on infrastructure
  failure, only on an explicit `block` verdict.
- **Gate fires ONCE on the intent to start the turn**, not per tool-call (a
  per-call gate would be a UX nightmare) — the agent turn evaluates the
  iteration-1 projection before the loop.
- **Output-cap parity** — `evaluate()`'s `output_cap_tokens` is the exact
  `max_tokens` the provider receives, so the cap is authoritative, not leaky.
- **Inert by default** — `CapsSettings` defaults to `{}` (all thresholds
  undefined → `allow`), so an absent `tracking.caps` config changes nothing.

## Consequences

**Positive.** The cost-cap subsystem (T-411a) has its first live wiring on the
send path: a configured `hard_block_above_usd` now prevents a runaway turn from
spending — pure-core enforcement that holds even without the IDE. `warn`/`confirm`
ride the existing pre-send estimate envelope, so the composer footer can render
the banner with no new event shape. No native deps, no new IDE surface needed for
the `block` capability to function, additive/optional wire fields throughout.

**Negative / limits.** The soft-`confirm` gate is advisory until the IDE adds a
confirm-resolve round-trip — a `confirm` verdict surfaces but does not pause the
turn. Subscription caps (Claude Pro message/5h quotas) remain out of scope (CLI's
responsibility, per the T-411a design). The block refusal persists the user
message but no assistant turn, so the conversation shows the prompt with no reply
plus the `cap` verdict — the IDE renders the refusal from that.

**Checkbox.** `road-to-mvp-ui-finish` T-411a/T-411b host integration moves
`[ ]`→`[~]` — the backend gate + wire contract landed; the chat-input footer,
yellow banner, disabled-button render, and the soft-confirm modal round-trip are
the IDE last-mile. Overall done count unchanged (a `[~]` is deferred, not done).

## Alternatives considered

- **`statusRowsForMode` wiring (Q0=B).** Rejected — only static all-`pending`
  rows are possible in the iteration-based loop; the lifecycle needs phase
  boundaries that do not exist → artificial (verified against the code, the
  second cycle this candidate was over-ranked).
- **A coded error for `block` (Q2=A).** Rejected — a cap block is a policy
  refusal, not an exceptional fault; a `done:true` response with a dedicated
  `stopReason` + `cap` gives the IDE a clean render path without polluting the
  error channel.
- **Block on `confirm` until an explicit confirm arrives (Q3=B).** Rejected —
  there is NO confirm round-trip protocol yet, so this would hard-block every
  turn above the confirm threshold with no way to proceed (a deadlock).
- **A separate dedicated `ChatCapEvent` (Q1=B).** Rejected — the pre-send
  estimate event is THE pre-send envelope; caps share its trigger and projection,
  so an additive `cap?` field is cleaner than a second event shape.
- **Chat handler only (Q4=B).** Rejected — the agent turn is the bigger spender
  (recursive tool loop); gating only chat would miss the most critical surface.

## References

- `packages/core/src/tracking/caps.ts` — `CapsEvaluator` (the reused, previously
  dead evaluator) + `CapsSettings` / `CapEvaluation`.
- `packages/core/src/chat/handler.ts` — `preflight` (was `maybeEmitEstimate`) +
  `evaluateCaps` + `blockedResponse` + `toWireCap`.
- `packages/core/src/agent/turn-handler.ts` — the mirrored `preflight` +
  `evaluateCaps` + pre-loop block return + `toWireCap`.
- `packages/core/src/sidecar.ts` — `CapsEvaluator` construction + `caps` /
  `capsEvaluator` `BuildCoreOptions`, injected into both handlers.
- `packages/protocol/src/schema.ts` — `CapVerdictSchema`, the `cap?` field on
  `ChatEstimateEvent` / `ChatSendResponse` / `AgentTurnResponse`.
- `scripts/codegen.ts` — the new `CapVerdict` Kotlin DTO descriptor + `cap` fields.
- `packages/core/src/chat/handler-caps.test.ts` (6 tests),
  `packages/core/src/agent/turn-handler-caps.test.ts` (5 tests),
  `packages/core/src/sidecar.test.ts` (2 wiring tests),
  `packages/protocol/src/schema.test.ts` (5 schema tests).
- road-to-mvp T-411a / T-411b (the engine + estimate that shipped 2026-05-29).
- ADR-035 (live step tracking), ADR-036 / ADR-037 (calibration reconcile — the
  same finalize-point + reuse-the-token-count precedent this gate follows).
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2) — fork round.

## Sign-off

On flip to **Accepted**: carry the IDE host integration (chat-input footer with
`Context · $ · Output cap · Daily remaining`, the yellow warn banner, the
disabled block button) and a `confirm`-resolve protocol round-trip (so a
`confirm` verdict pauses the turn for an explicit user OK) into the IDE slice
that closes the T-411a/T-411b host-integration checkbox.
