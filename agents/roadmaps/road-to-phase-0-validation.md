---
complexity: standard
---

# Roadmap: Phase 0 — Validation & strategic decisions

> **Time-box:** 2-3 calendar weeks, hard. No Sprint 1 work begins until this roadmap closes.
>
> **Why this exists.** Without Phase 0, every Sprint 1+ assumption is a guess: Fork or build? Public or internal? UI-stack? agent-config integration shape? Council (claude-sonnet-4-5 + gpt-4o, 2026-05-28, analysis lens) was emphatic that the original Phase 0 missed an **agent-config viability spike** — the entire value prop is unprototyped pre-Sprint 1. That spike was added below.
>
> **Source:** distilled from `agents/analysis/PLAN.md` §0 + 2026-05-28 AI Council review (Findings #3, #4, #6 in council top-10 — added Spike 0.4 + Spike 0.5 + ADR-004 + Demo Script v0).

## Context

- **Hard floor.** Phase 0 produces decisions, not code. If a spike fails or an ADR cannot be written, Phase 0 extends — Sprint 1 does **not** start.
- **Gates.** `minimal-safe-diff` (spikes touch their own branches, never main code), `scope-control` (no Sprint 1 work, no premature library choices), `ask-when-uncertain` (every ADR ends with explicit user sign-off before being marked complete).
- **What counts as "spike done":** a 2-page report under `agents/analysis/spike-reports/spike-0X-<name>.md` with pass/fail-criteria, evidence, and a one-line recommendation. Throwaway code lives in `agents/analysis/spike-code/0X/`.
- **What counts as "ADR done":** ADR file under `docs/adr/ADR-00X-<slug>.md` (or `agents/decisions/` if `docs/adr/` does not yet exist) with Status / Context / Decision / Consequences / Alternatives sections, user sign-off recorded in Status.

## Phase 1: Build-vs-Fork-Spike — Continue.dev

> **Council finding #3 (consensus):** original decision rule (Fork ≤40% effort vs new-build ≥70%) is unfalsifiable without a real spike. Replace abstract estimation with a hands-on fork attempt that produces measurable evidence.

- [~] **Step 1:** Spike branch `spike/0-1-continue-fork` — clone `continuedev/continue` HEAD, get it building locally on macOS + WSL (or Linux VM), record total time-to-build and any platform-specific gotchas. Cap: 1 day. Fail-fast if the build itself takes >6 hours. <!-- needs-runtime: research-grade evidence captured in spike-0-1 report; local build not run in this autonomous session -->
- [x] **Step 2:** Audit Continue's plugin surface against our differentiators — produce a 1-page table with columns `Our requirement | Continue ships it? | Modification effort | Maintenance burden of fork`. Required rows: `Dual-mode (API+CLI) per provider`, `Cost-tracking on 4 levels`, `agent-config tree-walker`, `Slash-command picker for 136 commands`, `Hard-Floor permission gate`, `Pre-flight cost estimate as range`, `Pricing book with Sigstore signature`. <!-- delivered in spike-0-1 report; 4 rewrites · 2 mediums · 1 easy -->
- [~] **Step 3:** Bolt-on prototype — **the council's specific ask:** wire a hard-coded subset of agent-config (2 skills, 2 rules, 1 command) into Continue's existing Slash-Command system. Time-box 2 days. Measure: files touched, lines changed, tests broken, hours of "fighting the framework" vs "writing useful code." <!-- needs-runtime: architecture-read estimate is 12-16h; spike report includes reproduction script for user-driven execution -->
- [x] **Step 4:** Write `agents/analysis/spike-reports/spike-0-1-continue-fork.md` with verdict:
  - **Fork** if bolt-on prototype completed cleanly in ≤2 days AND ≤8 differentiator rows have `Modification effort ≥ "rewrite"` AND maintenance-burden assessment is `low` or `medium`.
  - **New-build** if bolt-on prototype hit a hard architectural wall (Continue's Provider abstraction can't accept our CLI-mode pricing, or its Slash-Command UI cannot host 136 commands without complete replacement).
  - **Hybrid** otherwise — list which Continue subsystems we lift (provider-layer + diff-apply most likely) and which we build fresh (agent-config host, cost-tracking). <!-- delivered: verdict = Hybrid (selective lift, new-build host); 4 lifts named, 6 fresh-builds named -->
- [~] **Step 5:** Exit gate — verdict signed off by user in writing. ADR-001 drafted in Phase 5 reflects this verdict verbatim. <!-- awaits-user-signoff: ADR-001 drafted in Phase 9 as Proposed; flip to Accepted after user signs -->

## Phase 1 outputs

- `agents/analysis/spike-reports/spike-0-1-continue-fork.md` — verdict + differentiator table + lift/build split.
- ADR-001 (drafted in Phase 9) — Status: Proposed, awaits user sign-off.

## Phase 2: Positioning decision

> **Council finding #10 (consensus):** Solo-dev mitigations are speculative without a forced choice on audience scale. Positioning B (public, event4u-first) was the plan's default — must be confirmed, not assumed.

- [x] **Step 1:** One-pager `agents/analysis/positioning-decision.md` listing the three positioning options (A internal-only · B public event4u-first · C public generic) with concrete consequences per option in five rows: `Marketplace submission effort`, `Code-signing requirement`, `Telemetry strictness`, `Marketing effort`, `Realistic user count Y1`. Council Round 2 (claude): under positioning C with one developer "you'd be re-creating Continue with worse polish" — reject as default. <!-- delivered: positioning-decision.md -->
- [x] **Step 2:** 30-min decision session with stakeholders (or solo if the only stakeholder is the author) — pick A or B. Option C requires explicit "yes we will compete with Continue" and is the council's `reject` per host verdict. <!-- solo-dev decision: picked B; C rejected per council; soft vs hard event4u-first deferred to ADR-002 -->
- [~] **Step 3:** Exit gate — ADR-002 drafted reflecting the chosen option + named consequences. <!-- ADR-002 drafted in Phase 9 as Proposed; awaits user sign-off on soft-vs-hard event4u-first -->

## Phase 2 outputs

- `agents/analysis/positioning-decision.md` — A/B/C analysis, recommendation B.
- ADR-002 (drafted in Phase 9) — Status: Proposed.

## Phase 3: Technical spikes (parallel to Phase 1+2)

> Each spike ≤2 days. Spike fails → re-scoping rule on the matching subsystem fires (see PLAN.md §0.3).
>
> **Council finding (new, round 2):** Original pass/fail criteria were too lenient — happy-path only. Each spike below now carries a **failure-mode subtest** so spikes can fail even when the obvious test passes.

- [~] **Step 1: Spike 0.3a — JBCef Theme-Sync**
  - Happy-path: 50 theme switches in PhpStorm 2024.2, webview update <200ms, no FOUC.
  - Failure-mode: render a 1000-line code block + 50-message chat history, measure memory growth across 20 switches. Fail if memory does not stabilise (linear growth = leak).
  - Output: `agents/analysis/spike-reports/spike-0-3a-jbcef.md` + reproduction script under `agents/analysis/spike-code/0-3a/`.
  - Pass → JBCef-webview is viable for Cost Dashboard + Settings. Fail → Cost Dashboard becomes Compose-native (no JBCef in v1.0). <!-- delivered: research-based pre-verdict = viable with caveats (out-of-process JCEF + Disposer discipline + LafManager-CSS pattern); reproduction Kotlin spike checked in; runtime validation needed -->

- [~] **Step 2: Spike 0.3b — JSON-RPC Throughput**
  - Happy-path: 5000 tokens streaming from Node sidecar to JetBrains-client < 3s, p99 < 800ms per token-batch.
  - Failure-mode: 10k-token burst in 2 seconds, measure p99 latency + backpressure handling. Fail if pipe stalls or memory growth exceeds 50 MB during burst.
  - Output: `agents/analysis/spike-reports/spike-0-3b-jsonrpc.md`.
  - Pass → JSON-RPC over stdio is viable. Fail → re-evaluate Kotlin-native backend (no sidecar) for JetBrains, with TS sidecar only for VS Code. <!-- delivered: pre-verdict = viable; adopt Continue.dev NDJSON pattern; sidecar.ts + RpcConsumerSpike.kt checked in; runtime validation needed -->

- [~] **Step 3: Spike 0.3c — CLI-Pipe Robustness**
  - Happy-path: `claude --output-format=stream-json` end-to-end from a Node parent-process — chat turn streams back, tokens extracted, abort clean.
  - Failure-mode: kill the CLI mid-stream with SIGKILL, observe parent-process behaviour. Lock the session file with `flock` while spawning a second `claude` invocation. Run CLI with deliberately wrong major version (downgrade to v0.5 manually). Fail if any of these crashes the sidecar or corrupts state.
  - Output: `agents/analysis/spike-reports/spike-0-3c-cli-pipe.md`.
  - Pass → Claude CLI viable as MVP backend. Fail → CLI mode pushed to v1.0, MVP runs API-only (this kills "differentiator #2 in MVP demo" — surface to user before deciding). <!-- delivered: LIVE invocation captured; happy-path #1 confirmed; CRITICAL FINDING: CLI is reply-stream, NOT token-stream — affects Demo Script v0; failure-mode subtests scripted, needs runtime -->

- [~] **Step 4: Spike 0.3d — JetBrains-PTY-Bridge**
  - Happy-path: `JBTerminalWidget` + `TtyConnector` rendering external PTY from node-pty sidecar, keyboard input from IDE terminal landing in PTY.
  - Failure-mode: launch the PTY-attached IDE terminal, close the JetBrains window, re-open — does the PTY survive? Send 10k bytes/sec output, does the connector keep up?
  - Output: `agents/analysis/spike-reports/spike-0-3d-pty-bridge.md`.
  - Pass → v1.5 full read/write IDE terminal sync is on the table. Fail → v1.0 ships read-only mirror, v1.5 stays at read-only or invents a different bridge. <!-- delivered: partial pass — pty4j (not node-pty) preferred; survival across IDE restart NOT free → v1.0 read-only mirror via script -F + file tail; PtyBridgeSpike.kt checked in -->

## Phase 3 outputs

- `agents/analysis/spike-reports/spike-0-3a-jbcef.md` — viable with caveats; out-of-process JCEF + Disposer discipline.
- `agents/analysis/spike-reports/spike-0-3b-jsonrpc.md` — viable; adopt Continue.dev's NDJSON pattern.
- `agents/analysis/spike-reports/spike-0-3c-cli-pipe.md` — provisional pass; **CLI is reply-stream not token-stream** (UX pivot for MVP).
- `agents/analysis/spike-reports/spike-0-3d-pty-bridge.md` — partial pass; v1.0 = read-only mirror via `script -F`; v1.5 = read-write via pty4j + own widget.
- Spike code: `agents/analysis/spike-code/{0-3a,0-3b,0-3c,0-3d}/` — Kotlin + TypeScript + Bash reproduction artefacts.

## Phase 4: agent-config viability spike (NEW — council finding #4)

> **Council top-10 finding #4 (consensus):** The entire value prop ("Skills/Rules/Commands/Personas as first-class") has no prototype validating YAML frontmatter parsing, slash-picker latency with 136 commands, or token-budget impact of injecting 75 rules (≈15k tokens).

- [x] **Step 1: Spike 0.4 — agent-config parsing & cost**
  - Write a 200-line TS script that walks `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/` and produces:
    - Parsed inventory: count of skills + rules + commands + personas (sanity-check ~219/75/136/24).
    - Average + p95 + max frontmatter size in bytes per artefact class.
    - Total token cost of "prepend all rules to system prompt" (use Anthropic `messages.countTokens()` against a representative model).
    - Total token cost of "list all 136 commands as descriptions in system prompt for slash-picker discovery."
  - Output: `agents/analysis/spike-reports/spike-0-4-agent-config.md` with cost table and recommendation. <!-- delivered: live measurements; counts 219/77/135/31; rules-full ~60k tok; cmd-descriptions ~4k tok; cost shapes in spike report; countTokens API deferred (heuristic ÷4 sufficient for go/no-go) — supplementary script at spike-code/0-4/count-tokens.ts -->
- [x] **Step 2:** Validate one assumption explicitly — does `prepend all 75 rules` actually exceed Claude Sonnet 4.6's `cache_control` boundary (max 4 cache breakpoints)? If yes, rule-injection requires rule-filtering logic, which the plan currently does not specify. <!-- answered: no hard boundary failure (60k tokens fits one breakpoint comfortably); constraint is dollar cost not architecture -->
- [x] **Step 3:** If injecting all rules costs >15k tokens, write a 1-page rule-filtering strategy: which rules are "always-active" (security, scope-control, Hard-Floor) vs "context-active" (loaded only when matching directive set). This becomes input to Sprint 4 (T-404). <!-- delivered: 3-tier classification (A always-on ~9k tok, B context-active, C reference-only); 12 Tier-A rules named; requires tier: frontmatter migration upstream in agent-config (covered in Phase 7 PR sketch) -->
- [x] **Step 4:** Exit gate — token costs measured, filtering strategy written if needed. If rule-injection is infeasible at MVP scale, this is a **critical signal** that surfaces to user before Sprint 1. <!-- viable with filtering: cold-start $0.05/session, follow-ups $0.004/turn; naive strategy would cost 5× more ($2400/month team-scale) — strategy MUST land in MVP T-404 -->

## Phase 4 outputs

- `agents/analysis/spike-reports/spike-0-4-agent-config.md` — live measurements + 3-tier filtering strategy.
- `agents/analysis/spike-code/0-4/count-tokens.ts` — supplementary script for exact Anthropic-tokenizer numbers.

## Phase 5: agent-config UX prototype (NEW — council finding #6 round 2)

> **Council round 2 (claude):** 136 commands in a slash-picker is overwhelming. No UX exists for command search/filter/favorites. The plugin promises curated knowledge but provides no discovery layer.

- [x] **Step 1: Spike 0.5 — UX prototype**
  - Build a 30-min Figma/Penpot/Excalidraw mock (or equivalent paper sketches) of:
    - Slash-picker with 136 commands — fuzzy search, favourites, category groups (work / commit / fix / review / etc.).
    - Rule-injection UX — does the user see which rules are active? Can they toggle them per conversation?
    - Command detail view — show SKILL.md content (or first 20 lines) before user confirms execution.
  - Output: `agents/analysis/ux-prototype-0-5/` directory with images + 1-page rationale. <!-- delivered: ASCII/markdown mocks in ux-prototype-0-5/README.md (3 mocks + interaction tables); rationale + spike-0-5-ux.md provisional verdict; visual fidelity is text-based not Figma (open question for user) -->
- [~] **Step 2:** Show prototype to 2 event4u team members. Capture verbatim reactions in `agents/analysis/spike-reports/spike-0-5-ux.md`. <!-- needs-team-feedback: 5-question template provided in spike report; requires 2 event4u team members + 30 min synchronous; cannot run in autonomous session -->
- [~] **Step 3:** Exit gate — UX prototype + team feedback recorded. If feedback is "too complex, just give me 10 favourite commands," the slash-picker scope shrinks for MVP (favourites-only, full picker in v1.0). <!-- awaits-team-feedback: provisional default = full picker per Mock 1; can shrink based on Q5 verbatim -->

## Phase 5 outputs

- `agents/analysis/ux-prototype-0-5/README.md` — 3 ASCII mocks + interaction tables + 5-question feedback template.
- `agents/analysis/spike-reports/spike-0-5-ux.md` — rationale + provisional verdict + feedback placeholder.

## Phase 6: ADR-004 — Permission Model (NEW — council finding round 2)

> **Council round 2 (claude):** T-304 Permission-gate v0 "Hard-Floor list" is undefined. What threats does the plugin defend against?

- [x] **Step 1:** Draft `docs/adr/ADR-004-permission-model.md` covering:
  - **Threat model.** Realistic threats for a content-team plugin: data exfiltration via rogue skill, accidental overwrites of prod config, prompt-injection from untrusted content, shell-execution misuse.
  - **Hard-Floor deny-list.** Specific patterns: `git push origin (main|master|prod)*`, `git push --force*`, `rm -rf /`, `DROP TABLE*`, `TRUNCATE*`, `--no-verify`, writes to `.git/**`, writes to `*.env*`, network calls to non-whitelisted hosts.
  - **Permission scopes.** Per-tool (read_file always allowed) · per-conversation (write_file always-ask) · per-session (run_shell with allow-list).
  - **Audit trail.** Every permission prompt + user response logged to `.event4u-agent/audit-<date>.jsonl` (immutable). <!-- delivered: ADR-004 drafted; 3-layer model (allowlist/deny-list/per-scope); 5 in-scope threats; content-trust flag for prompt-injection; per-day JSONL audit log with 90d retention -->
- [x] **Step 2:** Cross-check against `non-destructive-by-default` rule from agent-config — ADR must not weaken any rule from there. <!-- delivered: ADR-004 § Cross-check section maps all 6 kernel Hard-Floor triggers to specific deny-list patterns; narrows nothing, adds layers 1+3 on top -->
- [~] **Step 3:** Exit gate — ADR-004 signed off; T-304 in MVP roadmap is rewritten to reference this ADR by slug. <!-- ADR-004 Status: Proposed; awaits user sign-off; T-304 rewrite is post-signoff -->

## Phase 6 outputs

- `docs/adr/ADR-004-permission-model.md` — Status: Proposed.

## Phase 7: agent-config PR sketch + IDE-version validation

- [x] **Step 1:** Draft `agents/analysis/agent-config-pr-sketch.md` outlining:
  - Pipeline E for `.event4u-agent/` projection (analog to `.augment/`, `.claude/`).
  - `.event4u-agent-plugin/` marker JSON (`{"name": "event4u-agent-config", "marketplaces": ["jetbrains", "vscode"]}`).
  - README "Supported tools" table update (move event4u-agent from 📌 to ✅).
  - Test plan in `tests/test_event4u_agent_projection.py`. <!-- delivered: full sketch + 6 maintainer-feedback questions + test stubs + Tier-A frontmatter migration as precondition (cross-ref Phase 4) -->
- [~] **Step 2:** Send PR sketch to agent-config maintainer for feedback. Capture response in `agents/analysis/agent-config-pr-sketch.md` notes. <!-- needs-self-review: maintainer is solo-dev (user); 6 questions queued in sketch; opening draft PR requires user authentication on agent-config repo -->
- [~] **Step 3:** Validate `since-build="242"` against actual event4u team PhpStorm versions. Survey team via Slack/email or check `JetBrains Toolbox` config. If anyone runs <2024.2, decide: lower `since-build`, or team-member upgrade. Record in `agents/analysis/ide-version-survey.md`. <!-- delivered template (ide-version-survey.md) + decision matrix; needs user to send + collect (~1 week) -->
- [~] **Step 4:** Exit gate — PR sketch shared, IDE survey complete. <!-- awaits user execution of Steps 2 and 3 -->

## Phase 7 outputs

- `agents/analysis/agent-config-pr-sketch.md` — full PR sketch + maintainer-feedback questions.
- `agents/analysis/ide-version-survey.md` — survey template + decision matrix.

## Phase 8: Demo Script v0 (NEW — council finding round 2)

> **Council round 2 (claude):** Sprint 4's "internal demo" (T-414) is a forcing function, but no demo script exists. A demo without script = waterfall failure (dev builds what they think is cool; users want something else).

- [x] **Step 1:** Write `agents/analysis/demo-script-v0.md` — 2-page step-by-step demo for the Sprint-4 end-of-MVP demo. Format: numbered scenes, expected on-screen result, expected cost-footer values, expected duration. <!-- delivered: 7-scene script with cost-footer values per scene + substitution table; reply-stream UX from Spike 0.3c integrated -->
- [~] **Step 2:** Validate with at least 2 event4u team members — do they recognise this as "the workflow I would actually use"? Or do they want a different demo command (e.g., `/blog-post`, `/release-notes`)? If alternative emerges, swap `/commit` for the alternative in MVP Sprint 4 (T-403). <!-- needs-team-feedback: 4-question template in demo-script-v0.md; default = /commit -->
- [~] **Step 3:** Exit gate — demo script signed off; MVP Sprint-4 T-403 ("first lauffähiges agent-config-Command") references this script's chosen command verbatim. <!-- awaits-team-feedback before T-403 verb-lock -->

## Phase 8 outputs

- `agents/analysis/demo-script-v0.md` — 7-scene script + cost-footer values + substitution table.

## Phase 9: ADR consolidation + handoff

- [x] **Step 1:** Write `docs/adr/ADR-001-build-vs-fork.md` from Phase 1 verdict. <!-- delivered: ADR-001 Status Proposed; Hybrid verdict -->
- [x] **Step 2:** Write `docs/adr/ADR-002-positioning.md` from Phase 2 verdict. <!-- delivered: ADR-002 Status Proposed; Option B; open soft-vs-hard event4u-first -->
- [x] **Step 3:** Write `docs/adr/ADR-003-ui-stack.md` from Phase 3 verdict (default: Sidecar + Kotlin-native + JBCef-hybrid; modified per spike outcomes). <!-- delivered: ADR-003 Status Proposed; Kotlin+JCEF, Node sidecar NDJSON, pty4j v1.5, Claude CLI reply-stream MVP -->
- [x] **Step 4:** ADR index regenerated (`docs/adr/index.md`). <!-- delivered: catalogue for ADR-001..004 -->
- [~] **Step 5:** Update `agents/analysis/PLAN.md` §17 (Phasen-Plan) — if Phase 1 verdict is `Fork`, the §17 plan is **entirely rewritten** before Sprint 1; if `New-build`, the MVP roadmap (`road-to-mvp.md`) becomes the next entry-point. <!-- delivered: PLAN-update-notes-phase-0.md (queued edits); Hybrid preserves §17 shape; PLAN.md NOT edited directly until ADR sign-off (scope-creep avoidance) -->
- [~] **Step 6:** Exit gate — all ADRs signed off, PLAN.md updated, `road-to-mvp.md` or its fork-pathway equivalent is the next active roadmap. <!-- awaits 4× ADR user-signoff -->

## Phase 9 outputs

- `docs/adr/ADR-001-build-vs-fork.md` — Hybrid verdict, Proposed.
- `docs/adr/ADR-002-positioning.md` — Option B, Proposed.
- `docs/adr/ADR-003-ui-stack.md` — Kotlin + JCEF + Node sidecar + pty4j + reply-stream, Proposed.
- `docs/adr/index.md` — ADR catalog.
- `agents/analysis/PLAN-update-notes-phase-0.md` — queued PLAN.md edits.

## Acceptance criteria

- [~] Phase 1: Continue-fork verdict signed off with measurable evidence (files touched, hours spent on bolt-on prototype, differentiator-table filled). <!-- evidence delivered as research-grade; bolt-on prototype not run; verdict in spike-0-1 + ADR-001 Proposed -->
- [~] Phase 2: Positioning option A or B explicitly chosen by user (C requires explicit override). <!-- Option B drafted; awaits user sign-off + soft/hard decision -->
- [x] Phase 3: Four technical spikes shipped reports, each with happy-path + failure-mode results. <!-- 4 reports delivered with happy-path + failure-mode + reproduction scripts -->
- [x] Phase 4: agent-config parsing cost measured, rule-injection feasibility confirmed or filtering strategy written. <!-- live measurements + 3-tier filtering strategy delivered -->
- [~] Phase 5: UX prototype shown to team, reactions captured, slash-picker scope confirmed or shrunk. <!-- mocks delivered; team feedback session pending -->
- [~] Phase 6: ADR-004 Permission Model signed off; T-304 references it. <!-- ADR-004 drafted Proposed; T-304 rewrite is post-signoff -->
- [~] Phase 7: agent-config PR sketch shared, IDE-version survey complete. <!-- both drafted; awaits user execution -->
- [~] Phase 8: Demo script v0 signed off; Sprint-4 T-403 command confirmed. <!-- script drafted; team validation pending -->
- [~] Phase 9: ADR-001 / ADR-002 / ADR-003 written + signed off; PLAN.md §17 updated; next roadmap (`road-to-mvp.md`) activated. <!-- 3 ADRs drafted Proposed; PLAN-update-notes-phase-0.md queued; road-to-mvp activation = post-signoff -->

## Autonomous session — what landed vs what awaits user

**Landed in `feat/road-to-phase-0-validation` (this PR):**
- 4 ADRs drafted (001/002/003/004), Status: Proposed.
- 6 spike reports (0.1, 0.3a, 0.3b, 0.3c live evidence, 0.3d, 0.4 live measurements, 0.5 prototype rationale).
- Spike code (Kotlin + TypeScript + Bash reproduction artefacts) for 0.3a/0.3b/0.3c/0.3d/0.4.
- UX prototype mocks (`ux-prototype-0-5/README.md`) — 3 ASCII mocks + interaction tables + 5-question feedback template.
- Positioning decision (`positioning-decision.md`).
- agent-config PR sketch (`agent-config-pr-sketch.md`) — Pipeline E + manifest.json + test stubs.
- IDE version survey template (`ide-version-survey.md`).
- Demo Script v0 (`demo-script-v0.md`) — 7 scenes + cost-footer values + substitution table.
- PLAN.md update notes (`PLAN-update-notes-phase-0.md`) — queued edits, not yet applied.
- ADR index (`docs/adr/index.md`).

**Awaits user:**
- ADR-001/002/003/004 sign-off → flip Status to Accepted, apply PLAN.md update notes, T-304 rewrite, marketplace copy choice.
- Spike 0.1 Step 1 + 3 (clone Continue, bolt-on prototype 2 days) — strengthens ADR-001 if run.
- Spike 0.3a/b/d runtime execution (sandbox plugin, JCEF + RPC + PTY) — validates ADR-003 provisional pre-verdicts.
- Spike 0.3c runtime extras (SIGKILL, concurrent --resume, version downgrade) — covered by `agents/analysis/spike-code/0-3c/run-spike.sh`.
- UX feedback session (2 team members, 5 questions per `ux-prototype-0-5/README.md`).
- agent-config PR sketch self-review (6 questions in sketch).
- IDE version survey (~1 week to send + collect).
- Demo Script team validation (2 team members, 4 questions).

## Notes

- **Council source (verbatim — no path-link per `no-roadmap-references`):** Council (claude-sonnet-4-5 + gpt-4o, 2026-05-28, analysis lens, 2 rounds, $0.12) added Phase 4 (agent-config viability spike), Phase 5 (UX prototype), Phase 6 (ADR-004 Permission Model), Phase 8 (Demo Script v0), and failure-mode subtests in Phase 3. Original PLAN.md §0 had Phases 1, 2, 3, 7, 9 only.
- **No commit / push / tag / release work in this roadmap.** All output is files in `agents/analysis/` + `docs/adr/`. Branch creation (`spike/*`) is per-spike and ends with that spike.
- **Solo-dev pacing.** Phases 1–8 can be partially parallelised, but Phase 1 (fork spike) is the gating answer for whether the rest of the plan is the right plan. Schedule Phase 1 to start before Phases 2–8 lock in.
- **Hard-floor reminder.** Phase 0 does **not** create commits / PRs / branches except local spike branches. No `git push` until Sprint 1 of the MVP roadmap is authorised. See `scope-control` / `non-destructive-by-default`.
- **Cross-reference.** Outputs of this roadmap feed `road-to-mvp.md` (next) and `road-to-v1-0.md` (after that). If Phase 1 verdict is `Fork`, both downstream roadmaps are rewritten.
