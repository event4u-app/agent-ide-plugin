---
adr: 034
title: Review Apply-Fix On The Wire — Wiring buildFixEdit (T-CR-404) As The gitReviewApplyFix Dispatcher Method (Stateless Echo, ToolReview Diff Return, Functional Fix Anchors On The Summary, Server-Side Fresh-Read Span Revalidation, applicable:false Over Error)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini-cli, 2026-06-01 seam-selection + fork round — UNANIMOUS Q0=A Slice 1, A1 stateless echo, B1 ToolReview diff, C1 functional fix anchors on the wire finding, D1 applicable:false over coded error, E1 top-N MVP scope; both flagged the same span-drift + never-write + untrusted-echo traps)
related: makes road-to-code-review T-CR-404 apply-fix path LIVE over the protocol (buildFixEdit shipped 2026-05-29 with ZERO callers); reuses the permission-gated single-file write/diff machinery (MVP T-303 WriteFileTool / unifiedDiff) so the diff-approval + audit contract is unchanged; rides the same ToolReview DTO as ADR-013 approval cards; the "Preview fix" button render stays the IDE last mile (needs the finding card T-CR-403, itself skipped on the unbuilt Phase-7 action-card infra)
date: 2026-06-01
---

# ADR-034 — Review Apply-Fix On The Wire (gitReviewApplyFix)

## Status

**Proposed** — awaits sign-off. `buildFixEdit(issue, fileContent)`
(`review/apply-fix.ts`, T-CR-404, shipped 2026-05-29) is a pure function that
turns a review finding's `proposedFix` into a `WriteFileArgs` by replacing the
finding's `quotedSpan` in the current file (returns `null` on no fix, span
drift, or a no-op). It had **zero production callers**: a packaged plugin had no
way to ask the running sidecar to turn a surfaced finding into an
approval-ready edit. This slice puts that on the wire as a new
`gitReviewApplyFix` dispatcher method on the existing `GitHandler`. Pure core +
protocol, CI-verified. The **"Preview fix" button render** (the finding card
T-CR-403, gated on the unbuilt Phase-7 action-card infra) stays IDE-gated, so
**no checkbox flips** — T-CR-404 stays `[~]`.

## Context

The code-review engine (road-to-code-review Phases 1-3) is complete and
`gitReviewSummary` (ADR-016, T-PRD16 transport) already runs `runReview`
internally and returns a minimal wire view of the top findings. When the model
proposed a fix, `buildFixEdit` builds the edit for the **existing
permission-gated** `WriteFileTool` (MVP T-303) — the review itself NEVER writes;
it hands a proposed edit to the apply pipeline so the diff-approval and
audit-log paths are unchanged. But `buildFixEdit` had no caller and the wire
finding carried no fix data, so a client could surface a finding but never act
on its proposed fix.

A seam-hunt ranked the remaining clean pure-core seams. The alternative
(Slice 2, shadow-cost telemetry `cost/shadow.ts`) is no longer pure-core: a
meaningful shadow-cost figure needs live `TrackingDb` step recording, which is
**not** wired into the dispatcher (only `review/observer.ts` writes steps, itself
unwired), and overlaps the ADR-022 `BudgetRecorder` cost path. The AI council
chose Slice 1 unanimously as the self-contained, minimal-safe-diff seam.

## Decision

Add a new `gitReviewApplyFix` method on the protocol + `GitHandler`, and surface
the functional fix anchors on the existing review-summary finding.

1. **Stateless echo (fork A1).** The apply request carries
   `{ cwd, file, quotedSpan, proposedFix }` — the client echoes what it received
   on a `gitReviewSummary` finding. No server-side finding cache (handlers in
   this codebase are stateless except per-turn state); no re-running the
   non-deterministic 5-run review to apply one fix.

2. **Functional fix anchors on the wire finding (fork C1).** `GitReviewFinding`
   gains `quotedSpan?`, `proposedFix?`, and a required `fixable` boolean
   (precomputed `proposedFix && quotedSpan`). These are **functional edit
   inputs**, not the votes/confidence trust signals that E1 deliberately keeps
   off the wire — so surfacing them does not reopen the "no trust-signal leak"
   decision.

3. **ToolReview diff return (fork B1).** On success the method returns the same
   `ToolReview { kind:'diff', files:[{path,diff,isNewFile}] }` DTO that ADR-013
   approval cards already carry, so the fix renders identically to every other
   write proposal and rides the same approval UX.

4. **Server-side fresh-read span revalidation (trap, both reviewers).** The
   handler resolves the path against `cwd` (rejecting a workspace escape),
   reads the **current** file fresh, and calls `buildFixEdit` — so the echoed
   `quotedSpan`/`proposedFix` are **untrusted transport inputs**, revalidated
   against live content. A span edited away since the review yields
   `span_drift`; `buildFixEdit`'s existing "refuse to guess" contract holds.

5. **`applicable:false` over a coded error (fork D1).** A no-op fix, a drifted
   span, a missing file, or a workspace-escaping path are **expected** outcomes,
   not errors — the response is `{ applicable:false, reason }` so the client
   greys out the affordance rather than surfacing an error envelope.

6. **Top-N MVP scope (fork E1).** Apply-fix is offered on the surfaced top
   findings only; findings outside the summary's top-N are not separately
   enumerated. Documented as the MVP bound.

`buildFixEdit`'s parameter type is relaxed from the full `ReviewIssue` to
`Pick<ReviewIssue, 'file'|'quotedSpan'|'proposedFix'>` (the only fields it
reads) — a type-only widening; the existing caller (the test) still satisfies
it. No Kotlin method enum exists (codegen emits DTOs only); the protocol
`Methods` registry + its pin test gain `gitReviewApplyFix`.

## Consequences

- **Positive.** The apply-fix path is real end-to-end at the protocol/handler
  level and CI-tested; when the finding card (T-CR-403) lands, the transport is
  ready. The review still never writes — the contract is preserved by reuse of
  the permission-gated write path. The diff renders through the established
  ToolReview card.
- **Negative / deferred.** No checkbox flips: the "Preview fix" button and the
  finding card are IDE-render, gated on the unbuilt Phase-7 action-card infra
  (T-CR-403 is `[-]` skipped). Apply-fix is top-N-bounded for the MVP. Multi-file
  fixes remain a Phase-7 concern; this slice is single-file (MVP T-303).
- **No-change.** `summarizeReview` is untouched (`ChangeSummary.topFindings` is
  already `ReviewIssue[]`, carrying the fix anchors); only the handler mapping
  surfaces them. Codegen is idempotent.

## Alternatives considered

- **A2 stateful finding cache** — keyed by finding id, looked up on apply.
  Rejected: adds session-state lifecycle (eviction, multi-client) to a
  stateless handler for no gain over the echo.
- **A3 re-run review on apply** — wasteful and non-deterministic (votes vary
  run-to-run); could surface a different finding set than the user saw.
- **B2 raw `WriteFileArgs` return** — loses the unified diff + the shared
  approval-card render; the client would re-derive the diff.
- **C2 minimal summary + stateful apply** — keeps the wire finding minimal but
  forces A2's server state. Rejected with A2.
- **Slice 2 (shadow-cost telemetry)** — entangled with unwired `TrackingDb`
  step recording; not a clean pure-core seam this round.

## Sign-off

On flip to **Accepted**: no PLAN.md section change required (transport-only
slice). The next IDE-layer sprint wires the "Preview fix" button (T-CR-403 card)
to call `gitReviewApplyFix` and render the returned ToolReview through the
diff-approval surface. Re-run the Explore seam-hunt before assuming the
pure-core runway is exhausted — it has been wrong on every PR so far.

## References

- `packages/core/src/review/apply-fix.ts` — `buildFixEdit` (the wired seam).
- `packages/core/src/git/handler.ts` — `GitHandler.reviewApplyFix` + the
  summary fix-anchor mapping.
- `packages/core/src/tools/write-file.ts` — `WriteFileTool` / `unifiedDiff`
  (the permission-gated single-file write + diff the fix rides).
- `packages/protocol/src/schema.ts` — `GitReviewApplyFix{Request,Response}`,
  the extended `GitReviewFinding`, the `Methods` registry entry.
- ADR-016 — `gitReviewSummary` transport this extends.
- ADR-013 — the `ToolReview` approval-card DTO reused here.
- road-to-code-review.md Phase 4 T-CR-404 — the roadmap task.
