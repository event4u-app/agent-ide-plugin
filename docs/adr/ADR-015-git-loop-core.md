---
adr: 015
title: Git-Loop Core — Diff-Driven Commit-Message Builder (Fail-Hard Parse), PR-Description Builder (Deterministic Strip Sanitiser), Review-Mode Change Summary (Pure Derivation), Transport Deferred
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 Phase-4 git-loop design round — UNANIMOUS on all five forks A–E)
related: road-to-product-readiness Phase 4 (T-PRD14 commit-message suggestion, T-PRD15 PR-description draft, T-PRD16 review mode + change summary); builds on the review/ engine (ADR-nil code-review work), the commands/commit.ts GitRunner, agent/modes.ts (ADR-014), and the no-attribution-footers / no-decorative-emojis house rules
date: 2026-05-31
---

# ADR-015 — Git-Loop Core

## Status

**Proposed** — drafted alongside the road-to-product-readiness Phase 4 core
slice (`packages/core/src/git/`: `commit-message.ts`, `pr-description.ts`,
`review-summary.ts`, `text-rules.ts`). The IDE render halves (commit-message
card, PR-description card, review change-summary card) stay deferred; their
in-IDE smoke signs the verification log
(`docs/MANUAL_VERIFICATION.md § Product readiness Phase 4`).

## Context

Phase 4 closes the loop: from a working branch the agent helps draft a commit
message, a PR description, and a review change-summary — **never** executing a
git mutation (`commit-policy`, `scope-control`). The engine substrate already
exists: `review/diff-source.ts` parses `git diff` into `FileChange[]`,
`review/prompts.ts` renders line-numbered hunks, `review/run.ts` `runReview`
produces findings, `commands/commit.ts` has an injectable `GitRunner`, and
`agent/modes.ts` already declares the `commit` / `review` modes. The gap is the
**git-surface drafting primitives**: diff→commit-message, diff+log→PR-body, and
review-result→change-summary — plus deterministic enforcement of the two house
rules that govern git surfaces (no AI-attribution footer, no decorative emoji).
Shipped pure-core and unit-tested, ahead of the IDE cards — the same pattern as
every prior PR.

## Decision

Five forks, ratified by the AI council (codex-cli 0.134.0 + gemini 0.41.2,
2026-05-31 — UNANIMOUS on all five):

1. **A — module placement (UNANIMOUS).** A new `packages/core/src/git/` module
   owns the three builders + the shared `text-rules.ts` hygiene helpers, reusing
   `review/` and `commands/` as lower-level substrate. Centralising the git
   data-flow avoids a `commands/ ↔ review/` dependency tangle and keeps the unit
   tests in one place.

2. **B — commit-message: fail hard (UNANIMOUS).** `buildCommitMessagePrompt`
   renders the staged diff with `renderNumberedHunks`; `parseCommitMessage`
   validates the model's reply against the Conventional-Commit shape
   (`type(scope)!: subject`, allowed-type set, ≤ 72-char header, emoji-free
   subject, `!` / `BREAKING CHANGE:` footer → `breaking`) and returns
   `{ ok: false, errors }` on any violation — **no** heuristic synthesis from
   file paths / add-del ratios (both councils: heuristics mislabel refactors as
   feat/fix). The caller re-prompts. Risk: a stubborn model loops on re-prompts
   — bounded by the caller's retry budget (IDE concern, not core).

3. **C — PR-description: deterministic strip (UNANIMOUS).** `sanitizePrBody`
   and `sanitizePrTitle` **strip** (lossy) the forbidden content and return
   `{ body/title, warnings }` rather than rejecting — an always-on Core gets a
   hard compliance guarantee that beats trusting prompt-following. `text-rules.ts`
   removes AI-attribution lines (focused patterns: AI co-author trailers,
   "Generated with <AI>", "PR opened by", bare AI-vendor links) and decorative
   emoji (functional `❌ ✅ ⚠️` survive in bodies; titles allow no emoji at all).
   `readCommitLog` is **bounded** (default newest-30 commits, per-body cap,
   `truncated` flag) so a long-running branch can't blow the prompt budget (both
   councils flagged this trap). Risk: over-stripping a legitimate human
   `Co-authored-by:` — mitigated by requiring an AI-vendor token in the pattern.

4. **D — review summary: pure derivation (UNANIMOUS).** `summarizeReview`
   folds an existing `RunReviewResult` + the source `FileChange[]` into a
   `ChangeSummary` (files, additions/deletions from the hunks, exhaustive
   per-severity counts, top-N findings, potential count) with **no** extra LLM
   call — the findings already exist; aggregating them is deterministic and
   zero-cost. The severity-count record is exhaustive and zero-initialised
   (codex trap) so the card never guesses a missing bucket.

5. **E — transport deferred (UNANIMOUS).** The builders ship **standalone**
   (the `agent/modes.ts` precedent, ADR-014 fork C): no protocol method, no
   Kotlin codegen this slice. The Zod/Kotlin contract for `gitCommitMessage` /
   `gitPrDescription` / `gitReviewSummary` is locked when the IDE cards land and
   the transport shape is concrete, reducing churn. Risk: a second wiring PR —
   accepted; it is the cheaper order.

## Consequences

- **Positive.** The git-loop contracts are stable and unit-tested with no IDE
  dependency: a diff-driven commit-message turn + a strict Conventional-Commit
  parser, a bounded PR-description turn + a deterministic house-rule sanitiser,
  and a zero-cost review change-summary. 34 new tests; core 799 pass / 1 skip;
  `task ci` + `task jetbrains:check` green (codegen no-op — no protocol change).
- **Negative / deferred.** No client renders these yet; nothing wires a builder
  into a turn or surfaces the sanitiser warnings; the re-prompt-on-parse-fail
  loop is the IDE's to own.
- **Neutral.** No protocol / Kotlin change — codegen output is byte-identical.
  The Core never runs a git mutation; it only reads (`git diff` / `git log` via
  the injected runner) and emits text.

## Alternatives considered

- **Heuristic commit-type fallback** — rejected (B): path/ratio heuristics
  mislabel refactors; a re-prompt keeps history high-fidelity.
- **Reject (throw) on a dirty PR body** — rejected (C): a lossy strip gives an
  always-on Core a hard guarantee; warnings surface what changed.
- **Unbounded `readCommitLog`** — rejected (C): a 100-commit branch blows the
  prompt budget; bound + `truncated` flag instead.
- **A second LLM call to summarise the review** — rejected (D): the findings
  already exist; another call adds latency, cost, and nondeterminism.
- **Add the git protocol methods + Kotlin codegen now** — rejected (E): the
  transport shape is unknown until the cards exist; defer per the modes.ts
  precedent.

## References

- AI council design round: codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31
  (Phase-4 git loop, UNANIMOUS on all five forks).
- `review/diff-source.ts` (`getDiff`/`FileChange`) · `review/prompts.ts`
  (`renderNumberedHunks`) · `review/run.ts` (`runReview`) ·
  `commands/commit.ts` (`GitRunner`) · `agent/modes.ts` (ADR-014, `commit` /
  `review` modes).
- House rules: `no-attribution-footers`, `no-decorative-emojis-in-git-surfaces`,
  `commit-policy`, `scope-control`.
- road-to-product-readiness Phase 4 — T-PRD14, T-PRD15, T-PRD16.

## Sign-off

On flip to **Accepted**: the deferred render halves build against these frozen
shapes; the transport (`gitCommitMessage` / `gitPrDescription` /
`gitReviewSummary` protocol methods + Kotlin DTOs) is specified in a follow-up
when the IDE cards surface the builders and the sanitiser warnings.
