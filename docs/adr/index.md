# Architectural Decision Records

> Auto-list of ADRs in `docs/adr/`. Update when a new ADR lands or a Status flips.

| # | Title | Status | Date | Driver |
|---|---|---|---|---|
| [ADR-001](ADR-001-build-vs-fork.md) | Build vs Fork — Continue.dev as starting point | Proposed | 2026-05-28 | Phase 0 Spike 0.1 (Build-vs-Fork) |
| [ADR-002](ADR-002-positioning.md) | Positioning — Public, event4u-first | Proposed | 2026-05-28 | Phase 0 Phase 2 (Positioning) |
| [ADR-003](ADR-003-ui-stack.md) | UI Stack — JetBrains (Kotlin + JCEF) + VS Code (webview) | Proposed | 2026-05-28 | Phase 0 Spikes 0.3a/b/c/d |
| [ADR-004](ADR-004-permission-model.md) | Permission Model — Threat Model, Hard-Floor Deny-List, Audit Trail | Proposed | 2026-05-28 | Phase 0 Phase 6 (council round 2 finding) |
| [ADR-005](ADR-005-workspace-root-identity.md) | Workspace Root Identity — uri / stableId / canonicalKey + nested & symlink rules | Proposed | 2026-05-30 | road-to-multi-project Phase A (T-MR01..T-MR07) |
| [ADR-006](ADR-006-mcp-client-and-memory-format.md) | MCP Client (hand-rolled, zero-dep) + Local Memory Format (md+frontmatter) | Proposed | 2026-05-30 | road-to-v1-0 Phase 11 (T-1101/02/04/05/06) |

## Status legend

- **Proposed** — drafted, awaiting decider sign-off.
- **Accepted (YYYY-MM-DD)** — decider signed off; in force.
- **Superseded by ADR-XXX** — replaced by a later ADR.
- **Deprecated (YYYY-MM-DD)** — no longer in force, no successor.

## Sign-off requirement

All four Phase 0 ADRs are **Proposed**. Each ADR's "Sign-off" section names the actions that follow the flip to **Accepted**. The user (event4u solo-dev) is the sole decider for the MVP scope.

## Cross-references

- All four ADRs cite spike reports under `agents/analysis/spike-reports/`.
- AI Council round 1 + round 2 findings (claude-sonnet-4-5 + gpt-4o, 2026-05-28) inform every ADR — see each ADR's `consulted` frontmatter.
- ADRs reference `agents/analysis/PLAN.md` §0, §7.1, §13, §17 as the upstream PLAN sections to update post-sign-off.
