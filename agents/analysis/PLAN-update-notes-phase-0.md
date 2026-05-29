---
phase: 0
step: Phase 9 Step 5
status: pending-application-after-adr-signoff
date: 2026-05-28
applies_to: agents/analysis/PLAN.md §17 (Phasen-Plan), §13 (Sicherheit), §0 (Phase-0-Validation)
---

# PLAN.md — Phase 0 update notes (apply after ADR sign-off)

> **Why this file exists.** `agents/analysis/PLAN.md` is the long-form implementation plan. Phase 0 outputs change five specific things in PLAN.md. Editing PLAN.md directly during this autonomous Phase-0 run is **scope creep** — the changes only land after the user signs off on ADR-001/002/003/004. This file lists the diffs so the user (or a future autonomous turn) applies them cleanly.

## §0 — Phase-0-Validation section

Add at the end of §0:

> **Phase 0 status (2026-05-28):** roadmap closed via autonomous run (`feat/road-to-phase-0-validation`). 4 ADRs drafted (001/002/003/004), 6 spike reports written, agent-config PR sketch ready, demo script v0 drafted, UX prototype mocks delivered as ASCII. Steps requiring user execution remain `[~]` (in-progress) — bolt-on prototype (0.1 Step 3), 4 runtime spikes (0.3a/b/c/d), team UX feedback (0.5 Step 2), agent-config self-review PR (Phase 7 Step 2), IDE-version survey (Phase 7 Step 3), demo-script team validation (Phase 8 Step 2). Sprint 1 does **not** begin until those `[~]` rows close.

## §13 — Sicherheit, Privacy & Compliance

Replace the existing prose at the start of §13 with one paragraph pointing at ADR-004:

> **The permission model is specified in [ADR-004](../../docs/adr/ADR-004-permission-model.md).** Three-layer fail-closed gate: Layer 1 tool registry (allowlist per skill), Layer 2 Hard-Floor pattern deny-list (regex over normalized shell tokens + file-path scope), Layer 3 per-scope confirmation (per-tool / per-conversation / per-session with promotion UI). Audit trail in `.event4u-agent/audit-<date>.jsonl`, append-only, 90-day retention, per-project. MVP T-304 implements all three layers; ADR-004 § Sign-off names the post-acceptance actions.

The rest of §13 (privacy, GDPR, telemetry) stays — ADR-004 narrows the scope to the permission gate.

## §17 — Phasen-Plan

If ADR-001 is signed off as **Hybrid** (the recommended verdict), §17's Phasen-Plan keeps its current shape. Only the following edits are needed:

### MVP Sprint 1 — T-101 (Mono-repo bootstrap)

Add a line:

> Vendor `@continuedev/terminal-security` as an npm dependency at scaffold time (or fork-and-vendor under `packages/terminal-security/` if license attribution is easier with a vendored copy). Apache-2.0 NOTICE entry added in T-101 cleanup.

### MVP Sprint 3 — T-304 (Permission-gate v0)

Replace with:

> Implement Layer 1 + Layer 2 + Layer 3 per [ADR-004](../../docs/adr/ADR-004-permission-model.md). Lift `@continuedev/terminal-security` for Layer 2. Audit log writer in `.event4u-agent/audit-<date>.jsonl`. UI: confirmation toast with "Allow once / Always-this-session / Deny" buttons.

### MVP Sprint 4 — T-403 (first lauffähiges agent-config-Command)

Add a line:

> Lead command = `/commit` per [Demo Script v0 § Substitution table](../../agents/analysis/demo-script-v0.md). Re-evaluate after team feedback (Phase 8 Step 2).

### MVP Sprint 4 — T-404 (rule-injection logic)

Replace with:

> Read `tier: A | B | C` from each rule's frontmatter (precondition: `agent-config-pr-sketch.md` Sub-PR (a)+(b) landed upstream). Inject Tier-A always; Tier-B by trigger match; Tier-C never auto-inject. One cache_control breakpoint for the assembled block. See [Spike 0.4](../../agents/analysis/spike-reports/spike-0-4-agent-config.md).

### MVP Sprint 4 — T-411b (input-token-cost estimate)

Add a line:

> Show "Estimated input: $X · Output cap: N tokens · Daily remaining: $Y" per UX prototype Mock 3 (command-detail panel). UX shows reply-stream timing (3s TTFT spinner, full reply at once) per [Spike 0.3c](../../agents/analysis/spike-reports/spike-0-3c-cli-pipe.md).

### v1.0 Sprint 5

Add a bullet:

> **Token-stream UX** (API mode only). MVP shipped reply-stream via CLI; v1.0 adds API mode + per-token delta rendering. See [ADR-003](../../docs/adr/ADR-003-ui-stack.md) § Provider transports.

### v1.0 Sprint 9 — terminal scope

Replace with:

> **v1.0 ships read-only mirror only** via `script -F` + file tail (~1-2 days). v1.5 adds read-write PTY via pty4j + own `JBTerminalWidget` instance. Survival across IDE restart is NOT promised in v1.5 — rely on `claude --resume` for session continuity. See [Spike 0.3d](../../agents/analysis/spike-reports/spike-0-3d-pty-bridge.md).

## How to apply

After all four ADRs flip to **Accepted (YYYY-MM-DD)**:

1. Read this file end-to-end.
2. Apply each numbered edit to `agents/analysis/PLAN.md` § as named above.
3. Verify cross-references (PLAN.md → ADRs → spikes) all resolve.
4. Commit as `docs(plan): apply Phase 0 outcomes to PLAN.md`.
5. Delete this file or move to `agents/analysis/archive/`.

## Open question on PLAN.md scope

If a future ADR (ADR-005+) further changes structural decisions, PLAN.md needs a sibling update-notes file. Consider: is PLAN.md still the right shape, or should it become a thin pointer to ADRs once Phase 0 lands? Decision deferred to post-Sprint-1.
