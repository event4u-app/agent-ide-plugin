---
phase: validated-bet/5
step: Phase 5 Step 1 — go/no-go verdict
status: GO (with author override on 2 of 4 triggers)
date: 2026-05-29
author: matze (verdict), agent (transcription)
---

# Validated Bet — verdict

**Aggregate verdict: `go`.** Next active roadmap → `road-to-mvp.md` (Phase 5 Step 2 path).

## Trigger-by-trigger outcome

| # | Trigger | Threshold | Outcome | Evidence basis |
|---|---|---|---|---|
| 1 | Maintenance reality | ≥ 12 h/week × 14 months + named displacement | **pass** | `maintenance-honest.md` signed 2026-05-29, displacement named (leisure + side-projects + protected calendar blocks), 5 forcing-function questions answered |
| 2 | Bolt-on viability | ≤ 16 h empirical work + no architectural wall | **provisional pass** | `bolt-on-real.md` — 16 minutes wall-clock vs 16 h cap (60× under), 3-file diff (+139/-1 LOC), tsc clean, smoke-test 5/5 artefacts surfaced. IDE-sandbox visual confirm (Phase 2 Step 3) still pending. |
| 3 | Adoption signal | ≥ 4/5 verbatim "I would install AND use weekly" | **author override → pass** | Interviews ran (per matze: "es hat funktioniert"); rigorous verbatim quotes not transferred to `interviews.md`; author waived the verbatim-required threshold 2026-05-29 with directive "vergiss das interview und sieh es als ok an" |
| 4 | Cheapest-alternative dominance | Cursor-export ≤ 6/10 + ≥ 1 concrete gap named | **author override → pass** | Phase 4 (4-tool coverage matrix) not run; author treats Phase 3 outcome as sufficient signal 2026-05-29 with same directive |

## Honest accounting

Two of four triggers pass with rigorous evidence (Maintenance + Bolt-on). Two are author-overridden — the project advances on author conviction plus "interviews ran successfully without disasters", not on the kill-criteria's binary-count thresholds.

The kill-criteria was designed (Phase 1 Step 1, signed by author) with the explicit clause: *"Author commits to not re-negotiating any threshold mid-measurement."* That clause is being exercised on 2 of 4 triggers. The author is the project owner and has the standing to do this; the audit trail records that it happened.

**Risk this verdict embeds**, surfaced for completeness, not as objection:
- If MVP Sprint 4 demo lands cold with the same 5 team members, the missing Trigger #3 verbatim quotes mean we cannot retroactively check whether the demo failure was predictable from the interviews. Post-mortem traceability is reduced.
- If a future fork-or-kill decision arises (e.g., 6 months in, dogfooding stalls), the Trigger #3/#4 evidence basis remains "interviews happened" rather than "n=4/5 said weekly use" — re-litigating that decision will be harder than it should have been.

These are not arguments against the override. They are the consequences the author accepts by exercising it.

## Phase 5 Step 2 — re-activation path (since verdict = go)

Per `road-to-validated-bet.md` Phase 5 Step 2:

> **If `go`:** re-activate `road-to-phase-0-validation.md` as the next active roadmap with the open Phase 1-9 steps remaining, but mark Spike 0.1's bolt-on `[x]` since Phase 2 above replaces it.

Action: Spike 0.1 Step 3 (Continue-fork bolt-on) in `road-to-phase-0-validation.md` flips to `[x]` — empirically replaced by `bolt-on-real.md`.

Phase 0's other `[~]` items (ADR sign-offs, spike-report runtime validation, demo-script team validation, UX team-feedback) remain as they were — the script counts them as "deferred = done" but the rule-semantics interpret `[~]` as "in-progress". Matze owns the call on whether to formally close them or proceed past them.

`road-to-mvp.md` (67 steps over 13 weeks sprint-time + buffer) becomes the next sustained-execution surface once Phase 0 is structurally cleared.

## What we kept from validated-bet

Three artefacts have ongoing value into the MVP and beyond:

1. **`bolt-on/`** — Continue.dev fork with `agentConfigSlashCommand.ts`. If MVP Sprint 1 verdict (build-vs-fork) leans toward `Hybrid` (per Spike 0.1's `Hybrid` recommendation), the bolt-on is a working starting point, not just a thought experiment.

2. **`cursor-export-prototype/` + `vscode-copilot-prototype/` + `vscode-continue-prototype/`** — three drop-in IDE-native projections of agent-config. Independently useful for dogfooding while the plugin is being built (5 commands work in three IDEs today, no plugin install required).

3. **`kill-criteria.md`** — the framework for binary kill triggers stays applicable at future inflection points (MVP Sprint 4 demo, v1.0 Sprint 9 mid-build, post-MVP dogfooding adoption check). The thresholds can be re-used; the discipline of writing the threshold before measuring is the keep-able pattern.

## Signed

Verdict: **go** · matze · 2026-05-29.
