---
adr: 016
title: Git-Loop Transport — Full-Turn RPC Methods (gitCommitMessage / gitPrDescription / gitReviewSummary) over a Dedicated GitHandler, Single Sanitised Envelope, Bounded Commit Re-Prompt, Review-Run-Internal
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 Phase-4 git-loop transport design round — UNANIMOUS on all six forks A1/B1/C1/D1/E1/F1)
related: road-to-product-readiness Phase 4 (T-PRD14/15/16 transport half); builds on the git-loop core (ADR-015), the chat-streaming dispatch + ChatHandler precedent (ADR-010), the provider-registry composition root (ADR-011), the review/ engine, and the no-attribution-footers / no-decorative-emojis house rules
date: 2026-05-31
---

# ADR-016 — Git-Loop Transport

## Status

**Proposed** — the protocol + dispatcher + codegen layer that exposes the
shipped git-loop builders (ADR-015) as RPC methods. The IDE *card render*
(compose / edit / accept for commit-message, PR-description, review summary)
stays deferred; its in-IDE smoke signs the verification log
(`docs/MANUAL_VERIFICATION.md § Product readiness Phase 4`). This is the
"next IDE-wiring PR" ADR-015 flagged as deferred.

## Context

ADR-015 shipped three pure-core git-loop builders — `buildCommitMessagePrompt`
+ `parseCommitMessage`, `readCommitLog` + `buildPrDescriptionPrompt` +
`sanitizePrBody` / `sanitizePrTitle`, and `summarizeReview` — fully unit-tested
but **not** reachable over the wire. The dispatcher answered chat, terminal,
and workspace methods only. Phase 4 needs the IDE to ask the Core for a commit
message, a PR draft, and a review change-summary; the builders are the
ingredients, but the *method boundary*, the *handler shape*, whether to
*stream*, how to handle a *parse failure*, whether `gitReviewSummary` *runs the
review itself*, and how the IDE *selects the diff* are all open. The Core never
commits or opens a PR (`commit-policy`, `scope-control`) — every method returns
editable text the IDE card surfaces.

## Decision

Six forks, ratified by the AI council (codex-cli 0.134.0 + gemini 0.41.2,
2026-05-31 — UNANIMOUS on all six):

- **A1 — full-turn server-side methods.** Each method reads the diff (and, for
  PR, the commit log), runs the provider via the shared `ProviderRegistry`,
  parses / sanitises, and returns the structured result in one round-trip —
  rather than returning a raw prompt for a (nonexistent) client to drive. Keeps
  provider execution, parsing, sanitisation, and git IO in the Core and gives
  one contract testable with a scripted backend.
- **B1 — a dedicated injected `GitHandler`.** A new `packages/core/src/git/
  handler.ts` orchestrates the three methods (resolver + default cwd + injectable
  `GitRunner`), constructed in `buildCoreDispatcher` and passed as the
  dispatcher's third dependency — mirroring `ChatHandler` (ADR-010) and keeping
  the dispatcher a thin router. The three methods register in the generic
  handler map; the generic catch was generalised to honour a string `error.code`
  (so `git_not_configured` / `git_bad_request` surface as themselves, exactly
  like the `chatSend` block already does).
- **C1 — one terminal sanitised envelope, no token streaming.** The value is
  the *parsed / sanitised* result; streaming raw draft tokens would flash
  un-stripped attribution / emoji before the sanitiser runs. Each method is a
  plain request/response (no `emit`).
- **D1 — bounded internal commit re-prompt.** `gitCommitMessage` re-prompts on
  a `parseCommitMessage` failure (appending the errors as a corrective turn),
  capped at 2 attempts by default, then returns a structured
  `{ ok:false, errors, attempts }`. Parse failures are a provider-output
  concern the Core handles deterministically; the thin client never sees the
  jitter.
- **E1 — `gitReviewSummary` runs the review internally + minimal wire findings.**
  No precomputed-review RPC exists, so the method runs `runReview` over the
  selected diff then folds via `summarizeReview`. The wire `topFindings` expose
  only `{ file, line, severity, category, description }` — the internal
  `ReviewIssue` votes / confidence / proposedFix / groupSize stay out of the
  protocol (no debt leak). `findingsBySeverity` is an exhaustive
  `GitSeverityCount[]` (every severity present, 0 when none).
- **F1 — `cwd` + selectors on the wire.** The request carries `cwd` (the IDE
  always knows the workspace root, multi-root ready) plus the git selectors
  (`source` for commit / review, `base` + `head` for the PR range). A fixed
  handler cwd would bake a single-root assumption into the v1 protocol; the
  handler's `defaultCwd` is only the fallback when a request omits `cwd`.

PR-title note: `buildPrDescriptionPrompt` deliberately produces body-only, so
`gitPrDescription` derives an editable **title candidate** from the newest
commit subject (or the branch) and runs it through `sanitizePrTitle` — no
second LLM call, the shipped sanitiser is used as intended.

## Consequences

- **Positive.** The git loop is reachable end-to-end from both IDEs through one
  testable contract; the house rules (no attribution footer, no decorative
  emoji) are enforced in the Core, not trusted to the model or the client; the
  Kotlin DTOs are codegen'd (9 new data classes) so the JetBrains client
  decodes them with the existing `Json { ignoreUnknownKeys = true }`. The
  dispatcher stays a thin router; the `error.code` generalisation is additive
  (existing handlers still fall to `handler_error`).
- **Negative / deferred.** `gitReviewSummary` runs a full group-vote review per
  call (heavy) — acceptable for an explicit user action, tunable later. The
  card render (compose / edit / accept, warning surfacing, finding list) stays
  IDE-runtime → T-PRD14/15/16 remain `[~]`. `gitReviewSummary` reads the diff
  twice (once inside `runReview`, once for `summarizeReview`'s line counts) — a
  minor redundancy, not worth threading the parsed changes out of `runReview`.
- **Cost.** 19 new tests (9 GitHandler + 2 dispatcher git-loop + reuse of the
  builders' existing 34); full core suite 810 pass / 1 skip. `task
  jetbrains:check` green (compile + detekt + ktlint).

## Alternatives considered

- **A2 — prompt-only methods.** Return the built `ChatMessage[]`; the client
  sends via `chatSend`, then calls a separate parse/sanitise method. Rejected:
  3 round-trips, orchestration pushed to a client that does not exist yet, and
  untestable end-to-end.
- **C2 — stream draft tokens.** Rejected: surfaces un-sanitised attribution /
  emoji before the strip pass — actively harmful for the house-rule guarantee.
- **D2 — return parse failure to the client.** Rejected: pushes the re-prompt
  loop to the nonexistent client and leaks Conventional-Commit strictness into
  the thin UI.
- **Map<String,Int> for `findingsBySeverity`.** Rejected in favour of an
  explicit `GitSeverityCount[]` — the hand-rolled Kotlin codegen has no map
  support, and an array keeps every severity bucket visible.

## References

- ADR-015 — git-loop core (the builders this transport exposes).
- ADR-010 — chat-streaming dispatch + the `ChatHandler` injection precedent.
- ADR-011 — provider-registry + `buildCoreDispatcher` composition root.
- `packages/core/src/git/handler.ts`, `packages/core/src/server.ts`,
  `packages/protocol/src/schema.ts` (`Methods`), `scripts/codegen.ts`.
- `commit-policy`, `scope-control`, `no-attribution-footers`,
  `no-decorative-emojis-in-git-surfaces`.
