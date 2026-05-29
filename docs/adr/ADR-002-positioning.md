---
adr: 002
title: Positioning — Public, event4u-first
status: Proposed (drafted 2026-05-28 — awaits user sign-off + open question on soft vs hard event4u-first)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (claude-sonnet-4-5 + gpt-4o, 2026-05-28, 2 rounds — claude rejected Option C)
related: ADR-001 (Build-vs-Fork), ADR-003 (UI-stack)
date: 2026-05-28
source_analysis: agents/analysis/positioning-decision.md
---

# ADR-002 — Positioning

## Status

**Proposed** — Option B (public, event4u-first) chosen by solo-dev per Phase 2 analysis. **One open question remains:** soft vs. hard event4u-first surface in marketplace copy. Awaits user sign-off + decision on the soft/hard choice before flip to **Accepted**.

## Context

Three options on the table:

- **A — internal only.** event4u team distribution. No marketplace listing.
- **B — public, event4u-first.** Marketplace listing on JetBrains + VS Code Marketplace. event4u workflows showcased; agent-config-flavored skills are real but documented as "Bring your own agent-config tree."
- **C — public generic.** Continue.dev-style competitor. event4u content removed or behind a paid tier.

AI Council Round 2 (claude, analysis-lens) **hard-rejected Option C** under solo-dev: *"under positioning C with one developer you'd be re-creating Continue with worse polish."* Option A is structurally limiting — gates the public agent-config tree's IDE host artificially.

## Decision

**Option B — public, event4u-first.**

### Soft vs. hard event4u-first (open question)

Two flavors:

| | Soft event4u-first | Hard event4u-first |
|---|---|---|
| Marketplace copy | "AI assistant with first-class support for agent-config skills, rules, commands, personas." | "event4u Agent IDE Plugin — built for content teams using event4u workflows." |
| Brand presence | none in screenshots | event4u logo + colors in screenshots and copy |
| Out-of-event4u adoption | Friendly to non-event4u teams | Signals "for event4u only" |
| Y1 user mix | ~30% event4u, ~70% adjacent | ~80% event4u, ~20% curious |

**Default for the draft: Soft event4u-first.** Reasoning: agent-config is already a public Galawork artefact; gating the IDE host hard to event4u branding contradicts the upstream's "any team" framing. Soft keeps option C reversible toward later.

**User decides at sign-off.**

## Consequences

### Positive

- agent-config remains a coherent open story (public tree + public IDE host).
- Marketplace listings are achievable for solo-dev (2 PW one-time, 2 PD/quarter ongoing).
- Y1 user count target 50-300 is realistic without a marketing engine.
- Path to Y2-Y3 drift toward Option C exists if dogfooding proves out.

### Negative

- Code-signing required (~€100/year Apple Developer + signing infra).
- GDPR/EU-AI-Act-strict telemetry (opt-in default-OFF, pseudonymous IDs, ≤90d retention, DSR-ready, EU-hosted endpoint).
- Modest marketing baseline (5-10 PD/year) — non-zero solo-dev tax.

### Negative — risks not mitigated

- Marketplace review rejection on first submission (handled by retry with feedback, ~1-2 week delay).
- Soft event4u-first doesn't differentiate enough to drive adoption — hedge against this with strong agent-config-tier-A first-screen onboarding.

## Alternatives considered

- **Option A — internal-only.** Rejected: gates a public artefact's IDE host artificially; no recovery path if event4u priorities shift.
- **Option C — public generic.** Rejected hard by council: solo-dev cannot sustain a Continue competitor.

## References

- `agents/analysis/positioning-decision.md` — full A/B/C analysis with 5-row consequences table
- AI Council top-10 finding #10 (positioning must be confirmed, not assumed), 2026-05-28
- AI Council Round 2 verbatim reject of Option C

## Sign-off

Awaits user sign-off + soft/hard decision. On sign-off:
- Flip Status to **Accepted (YYYY-MM-DD)**.
- Marketplace listing copy drafted per chosen flavor in MVP Sprint 4 (T-414).
- `agents/analysis/PLAN.md` §17 updated to reflect public marketplace timeline.
