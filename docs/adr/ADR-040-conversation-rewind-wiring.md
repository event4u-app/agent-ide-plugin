---
adr: 040
title: Conversation Rewind — Wiring planRewind As The conversationRewind Protocol Method (T-1303)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 fork round — Q0=A UNANIMOUS (wire the read/plan half now), Q1=A UNANIMOUS (omit opaque workState from the wire), Q2=A UNANIMOUS (slim payload — targetTurnIndex only, no message-body DTO), Q3 SPLIT resolved by case (unknown conversationId → coded error `conversation_not_found` per gemini A; unknown checkpointId on an existing conversation → `found:false` per codex B), Q4 UNANIMOUS (surface warnings), Q5 traps — echo the ids, half-open `[0, targetTurnIndex)` parity, stale changedFiles are the IDE's VCS concern, no StoredMessage/opaque DTO)
related: discharges the read/plan transport half of T-1303 (road-to-v1-0 Phase 13, Checkpoints). The core `planRewind` + `recordCheckpoint` shipped engine-complete in ADR-008/2026-05-31 with ZERO production callers. This slice exposes `planRewind` over the wire; the auto-checkpoint WRITE side (AgentDriver phase boundary) and the rewind BUTTON remain the IDE last-mile, so T-1303 stays `[~]`.
date: 2026-06-02
---

# ADR-040 — Conversation Rewind (wiring planRewind as the conversationRewind protocol method, T-1303)

## Status

**Proposed** — awaits sign-off. One branch / one PR, three commit chunks
(protocol + codegen → core → docs), preserving minimal-safe-diff.

CI-verified locally: lint clean, typecheck clean, `prettier --check` clean (the
sole local warn is the untracked `.agent-settings.yml`, never committed → remote
green); protocol 46 pass, core 1042 pass / 1 skip (+6), shared 5, vscode 40;
`jetbrains:check` BUILD SUCCESSFUL; codegen idempotent at 52 DTOs (+2). **No
checkbox flip** — T-1303 stays `[~]`.

## Context

The Explore seam-hunt for the next pure-core seam surfaced four zero-caller
candidates. Verified against the code, three were unsuitable:

- **`planToReview`** (`tools/review.ts`) — the `approvalRequested.review` payload
  it builds is ALREADY produced inline at `agent/tool-registry.ts:233`
  (`review: { kind: 'diff', files: plan.files.map(toReviewFile) }`). Wiring
  `planToReview` would be a cosmetic DRY extraction, not a capability advance.
- **`buildStatusRows` / `statusRowsForMode`** (`agent/status-rows.ts`) — derive
  rows from `DirectiveSet.phases`, but the live `AgentTurnHandler` loop is
  ITERATION-based, not phase-based. It could only emit static all-`pending` rows
  with no lifecycle transitions (the `transitionStatusRow` activate/complete edges
  need phase boundaries the loop does not have) — an artificial wiring.
- **`phaseRunsInMode`** (`agent/modes.ts`) — a 2-line predicate whose only
  consumer is the unwired AgentDriver.

**`planRewind`** (`chat/rewind.ts`, T-1303) is the substantive, genuinely-clean
seam. It is pure and non-mutating: given a `Conversation` + `checkpointId` it
returns a `RewindPlan` (`targetTurnIndex`, `messagesToKeep/Drop`, `changedFiles`,
opaque `workState`, `warnings`) describing what a rewind WOULD do — the IDE
restores the conversation view and, via its own VCS/undo authority, the files.
The live `ConversationStore` is already wired into the dispatcher (`sidecar.ts`)
and held by `ChatHandler`, so the data is available; only the transport is
missing. This mirrors the established "core returns a plan, the IDE applies it"
pattern (`onboardingDetect` — ADR-033; `gitReviewApplyFix` — ADR-034).

**Verified limitation, surfaced honestly:** `recordCheckpoint` (the store's
checkpoint WRITER) has ZERO live callers today — its intended writers are the
AgentDriver auto-checkpoint hook (IDE-gated) and an explicit IDE/user checkpoint
action, both unbuilt. So `conversationRewind` wired alone returns "no checkpoints"
for real conversations until the write side lands. The council weighed this
explicitly (Q0) and chose to wire the read/plan half now anyway — the same
"wire one half first" shape every prior seam PR took.

## Decision

Add a non-streaming `conversationRewind` protocol method
(`ConversationRewindRequest {conversationId, checkpointId}` →
`ConversationRewindResponse`) backed by a new `ChatHandler.rewind` that loads the
conversation from the store, runs `planRewind`, and projects the plan onto the
wire. Registered in the dispatcher `handlers` map behind a `requireChat()` guard
(returns `chat_not_configured` when no chat handler is wired, mirroring
`requireGit`/`requireCost`).

**Wire shape (AI council 2026-06-02):**

- **Omit `workState` (Q1=A, UNANIMOUS).** The opaque `unknown` snapshot is
  codegen-hostile and the IDE does not need core's loop internals to restore the
  view or files. Dropped from the response DTO entirely.
- **Slim payload — `targetTurnIndex` only, no message bodies (Q2=A, UNANIMOUS).**
  The IDE already holds the conversation and slices the half-open range
  `[0, targetTurnIndex)` itself. This avoids introducing a `StoredMessage` DTO on
  the wire for a single consumer.
- **Surface `warnings` (Q4, UNANIMOUS).** So the IDE can tell the user a rewind
  will be partial (e.g. no file manifest).
- **Error semantics split by case (Q3, council split resolved by nature):**
  - Unknown **conversationId** → throw `conversation_not_found` (a true fault; the
    store has never seen this id). Mirrors the `requireX` coded-error pattern.
    (gemini A.)
  - Unknown **checkpointId** on an existing conversation → `found:false` response,
    NOT an error. This is EXPECTED state today (checkpoints are not yet
    auto-recorded), so the IDE's "Preview Rewind" must not hit an error boundary
    for the common case. (codex B.)

**Traps guarded (council Q5):**

- **Ids echoed** — `conversationId` + `checkpointId` ride the response so the IDE
  can guard against a stale round-trip (codex).
- **Half-open `[0, targetTurnIndex)` parity** — the schema comment states the
  exclusive upper bound; a test asserts `targetTurnIndex` equals the kept count
  (gemini).
- **Stale `changedFiles`** — files renamed/deleted since the checkpoint are the
  IDE's VCS-authority concern (core has no file-restore authority); `planRewind`
  already warns on an empty manifest. Documented, not over-engineered (gemini).

## Consequences

**Positive.** The conversation-rewind capability has its first wire transport,
following the proven plan-return pattern. No native deps, no new IDE surface to
wire it, no protocol method that needs a UI to function at the transport level.
The slim, council-shaped DTO keeps the wire minimal and codegen clean.

**Negative / limits.** Until the checkpoint WRITE side lands (AgentDriver
auto-checkpoint + explicit IDE checkpoint action), `conversationRewind` returns
`found:false` for real conversations — the transport is live but unexercised
end-to-end. The opaque `workState` is intentionally not on the wire, so a future
"resume mid-phase" feature that needs it will require a follow-up wire addition.
A conversation-revision/version guard (codex Q5 suggestion) was deferred as scope
creep — there is no revision field on `Conversation` today and the IDE re-fetches
on rewind.

**No checkbox flip.** T-1303 stays `[~]` — the rewind button + the auto-checkpoint
AgentDriver wiring are the IDE last-mile. Dashboard counts unchanged.

## Alternatives considered

- **`planToReview` DRY extraction.** Rejected — the review payload is already
  built inline and live; no capability advance.
- **`statusRowsForMode` wiring.** Rejected — only static all-`pending` rows are
  possible in the iteration-based loop; the lifecycle needs phase boundaries that
  do not exist → artificial.
- **Wire the checkpoint WRITE side first (Q0=B).** Rejected by the council — the
  intended writer is the IDE-gated AgentDriver; the read/plan transport is the
  clean pure-core half.
- **`conversationRewind` + a `conversationCheckpoint` write method in one PR
  (Q0=C).** Considered; rejected for minimal-safe-diff — an explicit-checkpoint
  method is its own slice, and the council picked A.
- **Coded error for a missing checkpoint (Q3 all-A).** Rejected for the checkpoint
  case — missing checkpoints are expected state pre-write-side; an error boundary
  on the normal path is wrong UX.
- **Full message bodies on the wire (Q2=B).** Rejected — introduces a
  `StoredMessage` DTO for one consumer that already holds the conversation.

## References

- `packages/core/src/chat/rewind.ts` — `planRewind` (the reused pure planner).
- `packages/core/src/chat/handler.ts` — `ChatHandler.rewind` + `ChatRequestError`.
- `packages/core/src/server.ts` — `conversationRewind` handler + `requireChat()`.
- `packages/protocol/src/schema.ts` — `ConversationRewindRequest/Response` +
  `Methods.conversationRewind`.
- `scripts/codegen.ts` — the two new Kotlin DTO descriptors.
- `packages/core/src/chat/handler-rewind.test.ts` (5 tests),
  `packages/core/src/sidecar.test.ts` (2 dispatcher tests),
  `packages/protocol/src/schema.test.ts` (round-trip + registry).
- ADR-008 — persisted history, forking, checkpoints + the non-mutating rewind plan.
- ADR-033 / ADR-034 — the "core returns a plan, the IDE applies it" precedent.
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2) — fork round.

## Sign-off

On flip to **Accepted**: carry the checkpoint WRITE-side wiring (AgentDriver
auto-checkpoint + an explicit `conversationCheckpoint` method) and the optional
`workState`/conversation-revision wire additions into the future AgentDriver/IDE
integration slice that also lands the rewind button.
