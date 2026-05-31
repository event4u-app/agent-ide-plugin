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
| [ADR-007](ADR-007-pricing-signature-and-telemetry.md) | Pricing-Book Signature (Ed25519 over Sigstore for v0) + Telemetry Privacy Floor | Proposed | 2026-05-31 | road-to-v1-0 Phase 14 (T-1401/1403/1404) |
| [ADR-008](ADR-008-chat-persistence-and-checkpoints.md) | Chat Persistence (append-only JSONL event log) + Copy-on-Write Forking + Metadata-only Checkpoints | Proposed | 2026-05-31 | road-to-v1-0 Phase 13 (T-1301/1302/1303/1307) |
| [ADR-009](ADR-009-live-terminal-core.md) | Live PTY Terminal Core — Interface+Fake PTY, Streaming-Subscribe Push, Dual-Cap Ring Buffer, First-Write-Wins Input | Proposed | 2026-05-31 | road-to-v1-0 Phase 9 (T-901/902/903/905/906) |
| [ADR-010](ADR-010-chat-streaming-dispatch.md) | Chat Streaming Dispatch — Additive emit-Callback, Cancellation by conversationId, Provider-Direct Slice, Single Cost Shape | Proposed | 2026-05-31 | road-to-vertical-slice Phase 1 (T-VS01/02/03/04) + Phase 4 (T-VS12/13) |
| [ADR-011](ADR-011-provider-registry-and-sidecar-wiring.md) | Provider Registry + Sidecar Composition Root — Eager Build, Env-Default, Throw-on-Unconfigured, Env Model Override | Proposed | 2026-05-31 | road-to-product-readiness Phase 2 (T-PRD17, core half) |
| [ADR-012](ADR-012-streaming-client-integration.md) | Streaming Client Integration — Separate Correlation Map, Session conversationId, Mode→Provider, Env-Key, Snapshot-per-Token | Proposed | 2026-05-31 | road-to-vertical-slice Phase 2/3 (T-VS05–11) |
| [ADR-013](ADR-013-tool-call-approval-events.md) | Tool-Call Lifecycle Events — One Union, Diff-in-Approval, Sealed-Class Codegen, Injected-Decide Orchestrator, Transport Deferred | Proposed | 2026-05-31 | road-to-product-readiness Phase 1 (T-PRD01/02/04) |

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
