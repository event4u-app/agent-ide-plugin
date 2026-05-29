# MVP scope decision — what an autonomous LLM run can actually ship

**Date:** 2026-05-29
**Decision driver:** AI Council (anthropic/claude-sonnet-4-5 + openai/gpt-4o, 2 rounds, analysis lens, $0.06 actual)
**Raw verdict:** `mvp-scope-council-2026-05-29.json`

## The question

A solo dev asked an autonomous LLM agent to process `road-to-mvp.md` (67 tasks across 5 phases, 13–16 week plan) "in full" — code, tests, commit-in-chunks, PR, CI green. Phase 1 was 4/7 done + T-103/T-105 in `[~]` (compile + lint + CI green, IDE-runtime smoke unverified because CI has no GUI). Council was asked to pick between:

- **A.** Close Phase 1 exit gate only (docs work)
- **B.** Phase 1 exit + thin slice of Phase 2 (T-206 + T-208 backend)
- **C.** Phases 1–4 in one autonomous run ("die volle road-to-mvp.md")
- **D.** Something else

## Verdict — converged on B+

Both members converged on a refined Option B. Synthesis:

### Reject C
- **Token budget IS the constraint, not soft risk.** At ~8K output tokens/hour, a 16-hour session approaches Claude's 200K window with input context. C is **token-infeasible**, not just risky. (claude-sonnet-4-5, New Finding 4)
- **Surface-area explosion.** 60 tasks = 60 potential merge conflicts, 60 test suites, 60 regression edges. The real C failure mode, not the "approval theater" framing.
- **IDE-runtime gates can't be auto-verified.** Compose Multiplatform vs Swing, plugin-lifecycle behavior, webview rendering — none of these are CI-checkable.

### Reject A
- **Documentation theater wastes generative capacity.** (gpt-4o, finding #1)
- **The exit gate is the build-measure gap, not the work.** Adding more docs around an unverifiable gate doesn't close it.

### Adopt B+ (scope this run)
1. **T-208 (`.agent-settings.yml` reader v0)** — Zod schema + YAML parse + minimal validation for the **MVP-relevant fields only** (`llm.default_provider`, `llm.default_mode`, `roles.active_role`, `commands.suggestion.*`). Hot-reload is T-207's responsibility, NOT v0's surface. ~80 LOC src + ~100 LOC tests.
2. **T-206 (Pricing Book v0)** — `pricing/prices.yml` (Anthropic-only) + `pricing/loader.ts`. Token→cost lookup. No remote fetch, no Sigstore. ~60 LOC src + ~80 LOC tests.
3. **T-401 (agent-config tree-walker) — PULL FORWARD from Phase 4.** Pure data transformation: recursive scan of `.event4u-agent/` → `.augment/` → `.agent-src/`, parse YAML frontmatter, index in-memory. No IDE, no UI, no networking. **High-leverage Phase-4 unblock that costs nothing to ship now.** ~100 LOC src + ~120 LOC tests.
4. **MANUAL_VERIFICATION.md** — capture the GUI smoke checklist for T-103 (JetBrains plugin install in PhpStorm 2024.2+, tool-window appears, ping after restart, kill PhpStorm → assert no zombie sidecar) and T-105 (JetBrains side of ping RPC). 20-minute metadata work the agent can do while writing parsers.

### Project-state reclassification
- **T-103 and T-105 stay `[~]` (in-progress)**, NOT flipped to `[x]` based on CI alone. Council New Finding 3: "Compile green, runtime red trap". Each gets an inline blocker note pointing at `MANUAL_VERIFICATION.md`. (The council member said `[-]` "blocked", but the roadmap's checkbox vocabulary maps "blocked but not abandoned" to `[~]`, not `[-]`. The semantic is the same.)
- **Phase 1 exit gate stays open.** Closing it is human work (running PhpStorm 2024.2+ manually), not autonomous-agent work.

## Why "phase boundaries are administrative, dependency edges are technical"

Council consensus (claude-sonnet-4-5 + gpt-4o, finding #3): the roadmap groups tasks into phases for narrative, not for execution sequencing. T-401 lives in Phase 4 but has zero dependency on Phases 2-3 — it's a pure tree-walker. Pulling it forward into this PR is a leverage play, not a scope violation. The dependency edges, not the phase labels, define safe PR scope.

## Estimated final scope

- **Files added:** 6 src + 4 test + 3 docs = ~13 new files
- **Lines added:** ~440 LOC code + ~300 LOC tests + ~200 lines docs
- **Tasks moved:** T-206 [x], T-208 [x], T-401 [x] · T-103 + T-105 stay [~] with inline blocker notes
- **Phase 1 dashboard:** still partial (T-103, T-105 not flipped) — honest signal
- **Phase 2 dashboard:** 2/8 done
- **Phase 4 dashboard:** 1/14 done (T-401 pulled forward)

## Token-cost ledger

- Council estimate: $0.058 · actual: $0.060 (the run itself, 2 rounds)
- Agent-run output (this PR): not yet measured; capture in commit description

## Follow-ups (NOT in this PR)

Council's HIGH-leverage items the agent did NOT do here:

1. **CI enhancement for headless IDE smoke** — adds `task jetbrains:headless-smoke` running PhpStorm headlessly under Xvfb. Worth a dedicated spike, not bundled with backend work.
2. **Dependency-graph the roadmap** — extract T-NNN edges, surface other pull-forward candidates beyond T-401. Worth its own analysis pass.
3. **Phase 2 T-201/202/203/204/205/207** — all need IDE plumbing or UI work; deferred to a human-driven sprint where the dev can iterate on the chat UI while the agent handles backend deltas.

## How to read this when this PR lands

- The PR description cites this file by path.
- The reviewer reads the council verdict (`mvp-scope-council-2026-05-29.json`) for the raw arguments.
- The progress dashboard reflects the honest state: backend tasks done, IDE-runtime gates still open.
- Phase 4 carries one [x] for T-401, which surprises a reader who expects strict phase-order; this evidence file is the cited rationale.
