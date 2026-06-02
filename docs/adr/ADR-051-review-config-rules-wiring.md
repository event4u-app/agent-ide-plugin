---
adr: 051
title: Review Config + Rules Wiring — Threading The Dead Phase-5 loadReviewRules / ReviewSettings Into The Live reviewSummary Path (T-CR-501/502)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council — gemini-cli 0.41.2 (Q0=A, Q1=C, Q2=A, Q3=A, Q4=A) + codex-cli 0.134.0 (Q0=A, Q1=B, Q2=A, Q3=A, Q4=A), both 2026-06-02, run serially (`gemini -p` / `codex exec --skip-git-repo-check`). Both answered cleanly this round (no codex hang). The one divergence is Q1 (settings source) — synthesised below; Q0/Q2/Q3/Q4 unanimous.
related: sibling of the wire-a-dead-seam ADRs (ADR-048 command-palette data path, ADR-050 config registry data path). Builds on ADR-042 (review tracked-observer wiring) — the same live `reviewSummary` entry point. The settings WRITE surface (settings UI) remains the IDE client layer (MVP T-204 pattern); this ADR is the Core READ + apply path.
date: 2026-06-02
---

# ADR-051 — Review Config + Rules Wiring (T-CR-501/502)

## Status

**Proposed** — awaits sign-off. One branch / one PR, committed in logical
chunks (core seam → tests → docs), preserving minimal-safe-diff.

CI-verified locally: `task ci` exit 0 (lint, format, build, typecheck, test —
core 1141 pass / 1 skip, +11 over baseline). Pure-core TypeScript: no protocol
/ DTO / codegen change, so the JetBrains + package matrix jobs are unaffected.
**No checkbox flip** — T-CR-501/502 are already `[x]` (their cores shipped
2026-05-29); this PR lands the live wiring those cores were built for, and the
done-comments are updated to cite it.

## Context

road-to-code-review.md Phase 5 shipped two pieces tested but with **zero live
callers** — a dead seam, the exact shape ADR-048/050 wired before:

- `review/rules.ts::loadReviewRules(cwd)` reads `.event4u-agent/review-rules.md`
  and returns the text (or `undefined`). `ReviewPipelineOptions.rules` already
  exists and is consumed by `prompts.ts::stage1System(rules)`. But the live
  review entry point — `GitHandler.reviewSummary` (ADR-042) — never set
  `pipeline.rules`, so a project's review rules never reached the model.
- `review/config.ts` defines `ReviewSettingsSchema` + `resolveReviewSettings`
  + `voteOptionsFromSettings` + `applySeverityFloor` (security-exempt). All
  four had zero callers: `reviewSummary` always ran with the hard-coded
  defaults (groupSize 5) and never applied a severity floor.

The capability gap is real: the review engine was configurable and
rules-aware by construction, but the only path that runs it ignored both.

## Decision

Thread both into `reviewSummary` as one slice. Per council (Q0=A unanimous):
wire rules **and** settings together — they share the one edit and the same
"read the workspace config" step.

- **Rules (T-CR-501).** `reviewSummary` loads the rules best-effort and passes
  them as `pipeline.rules`; `stage1System` injects them into the Stage-1
  system prompt. Unconditional (Q3=A unanimous) — the reader already
  fail-opens, so a missing file simply yields no rules block.
- **Settings (T-CR-502).** `reviewSummary` resolves `ReviewSettings`, maps them
  through `voteOptionsFromSettings` into `runReview({ vote })` (so `group_size`
  / thresholds drive the group-vote), and applies `applySeverityFloor` to both
  `result.issues` and `result.potentialIssues` **before** `summarizeReview`
  (Q2=A unanimous) so the counts, top findings, and potential tally all reflect
  the same filtered set.
- **Testability (Q4=A unanimous).** `GitHandlerDeps` gains two optional readers
  — `loadReviewRules?` and `loadReviewSettings?` — defaulting to the real file
  readers; tests inject fakes. Separate readers (not one combined provider)
  keep their independent failure modes visible.
- **Settings source (Q1 — reasoned synthesis).** gemini chose C (inject a
  resolved reader into deps, keep the handler pure); codex chose B (keep review
  config owned by `review/`, no `config/ → review/` coupling). The Q4=A
  injection is unanimous and reconciles both: the **default reader lives in
  `review/settings-source.ts`** (codex B — self-contained, reads
  `.agent-settings.yml :: review` via the existing `yaml` dep, fail-open to
  defaults; `AgentSettingsSchema` is **not** extended, so no config→review
  coupling), and it is **injected as an optional `GitHandlerDeps` reader**
  (gemini C — the handler stays pure and the sidecar can override). Rejected
  the alternative of extending `AgentSettingsSchema` (couples the config reader
  to the review schema) and of adding the settings to the `GitReviewSummary`
  wire DTO (the values are persisted in the workspace file, not passed
  per-call).

## Consequences

- A project's `.event4u-agent/review-rules.md` now shapes the review prompt,
  and the `review:` block in `.agent-settings.yml` now tunes vote size,
  thresholds, and the severity floor — both on the live IDE "Review changes"
  path.
- **The council-flagged trap** (both members named it): the severity floor must
  never hide a `security` finding. `applySeverityFloor` exempts
  `category === 'security'` when `security_always_error` is on; a regression
  test asserts a low-severity security finding survives a `high` floor while a
  low-severity bug is dropped.
- No behaviour change when no config is present: missing `review-rules.md` →
  no rules; missing/invalid `review:` block → default settings (groupSize 5,
  floor `info` = keep all). Identical output to before for an unconfigured
  workspace.
- Pure-core, additive: no protocol/DTO change, no new dependency (`yaml` was
  already a core dep), `CommandHandler`/other handlers untouched.

## Alternatives considered

- **Leave the seam dead (Q0=D).** Rejected — the cores were built for this
  exact wiring; leaving them unreachable is the gap, not a safe default.
- **Extend `AgentSettingsSchema` with a `review` key (Q1=A).** Rejected —
  couples the generic settings reader to the review schema for a single narrow
  read; the self-contained `review/` reader keeps the boundary clean.
- **Pass settings on the wire DTO (Q1=D).** Rejected — settings are persisted
  workspace config the Core reads, not a per-request transport input.
- **Apply the floor only to `topFindings` after summarising (Q2=B).** Rejected
  — the per-severity counts and potential tally would then disagree with the
  shown findings.

## References

- `packages/core/src/git/handler.ts::reviewSummary` — the live entry point now
  threading rules + settings.
- `packages/core/src/review/settings-source.ts` — the new fail-open
  `.agent-settings.yml :: review` reader (the wired settings seam).
- `packages/core/src/review/rules.ts::loadReviewRules` — the wired rules seam.
- `packages/core/src/review/config.ts` — `resolveReviewSettings`,
  `voteOptionsFromSettings`, `applySeverityFloor` (the wired settings helpers).
- ADR-042 — the `reviewSummary` tracked-observer wiring this extends.
- ADR-048 / ADR-050 — the sibling wire-a-dead-seam data-path ADRs.
- `agents/roadmaps/road-to-code-review.md` T-CR-501 (rules) / T-CR-502
  (settings) — the Phase-5 cores wired here.
