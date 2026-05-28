---
phase: 0
step: Phase 2 Step 1
status: draft-awaiting-signoff
date: 2026-05-28
recommendation: B — public, event4u-first
---

# Positioning Decision — A vs B vs C

> **Required deliverable** for Phase 0 Step 1 (`road-to-phase-0-validation.md`). One pager listing the three positioning options with concrete consequences in five rows. The roadmap is explicit: **Council Round 2 (claude) rejected Option C** under solo-dev constraints ("under positioning C with one developer you'd be re-creating Continue with worse polish"). Option C therefore appears below for completeness but is the council's `reject`.

## Option summary

- **A — internal-only.** Plugin ships to event4u team only. No JetBrains Marketplace / VS Code Marketplace listing. Distributed via internal artefact repo (GitHub Releases, private S3, or `.zip` over Slack).
- **B — public, event4u-first.** Plugin listed on JetBrains Marketplace + VS Code Marketplace. README + screenshots show event4u workflows first (Blog Post / Release Notes commands). Generic AI-assist features (chat, slash commands, cost tracking) are the public surface; agent-config-flavored skills are real but documented as "Bring your own agent-config tree."
- **C — public generic.** Plugin positioned as a Continue.dev alternative for any team. event4u-flavored content removed or behind a paid tier. README leads with feature parity to Continue + differentiators.

## Five-row consequences table

| Dimension | A — internal only | B — public, event4u-first | C — public generic |
|---|---|---|---|
| **Marketplace submission effort** | None | JetBrains Marketplace plugin review (~2-5 business days first-time, faster on updates) + VS Code Marketplace (immediate, no review) + screenshots + descriptions in EN/DE + privacy policy | Same as B **plus** competitive positioning page, comparison-with-Continue page, brand assets, possible logo redesign for non-event4u use, support for non-event4u language packs |
| **Code-signing requirement** | None (we control the install path; internal users accept unsigned) | **Required.** JetBrains Marketplace requires signed plugin (`.jar` signing via Marketplace-provided certificate or self-signed with marketplace approval). VS Code Marketplace requires publisher cert. Apple notarization needed if we ship the Node sidecar as a native binary on macOS. Cost: ~€100/year (Apple Developer) + signing infra | Same as B; if we ship enterprise tier, EV code-signing certificate adds ~€500/year |
| **Telemetry strictness** | Loose — internal users accept opt-in telemetry, can use email-keyed user IDs, debug mode default-on | **Strict.** GDPR + EU AI Act — opt-in default-OFF, pseudonymous IDs, retention ≤90 days, DSR-ready (export/delete), privacy policy public, telemetry endpoint EU-hosted. See `domain-safety-pii` from agent-config | Same as B plus US privacy disclosures (CCPA), possibly enterprise SSO/SAML for telemetry dashboard access |
| **Marketing effort** | Zero — onboarding via Slack DM | **Modest.** Landing page (1 page on event4u.de or subdomain), 3-5 blog posts on agent-config + dual-mode pricing, JetBrains Marketplace SEO. Estimated 5-10 PD/year ongoing | **Heavy.** Continue.dev has 33k stars, 393 contributors; competing requires a sustained content + community presence. 50+ PD/year ongoing (blog, Discord, conference talks, integrations). Solo-dev cannot sustain this without dedicated marketing |
| **Realistic user count Y1** | 5-15 (event4u team + close partners) | **50-300** (event4u team + curious event4u-style content teams + agent-config consumers who want IDE depth + small adopters from Marketplace SEO) | 500-3000 IF marketing investment lands; 20-100 if it doesn't. High variance, high bus factor on solo-dev marketing capacity |

## Council read

- **Round 1 (`claude-sonnet-4-5 + gpt-4o, 2026-05-28`):** Option B emerged as the default early; both lenses concurred that A under-uses the agent-config differentiator (the public agent-config tree is open-source, gating its IDE host artificially fragments the value prop). C was tabled as plausible.
- **Round 2 (claude, analysis-lens):** Hard reject on C under solo-dev. Verbatim: *"under positioning C with one developer you'd be re-creating Continue with worse polish."* The host verdict accepted this; Phase 2 Step 2 of the roadmap codifies the reject.
- **Top-10 finding #10 (consensus):** solo-dev mitigations are speculative without a forced choice — B must be confirmed, not assumed.

## Recommendation

**B — public, event4u-first.**

### Why B over A

- agent-config is already a public Galawork artefact. Gating the IDE host (A) creates a discoverability gap that the public tree cannot reach back across — every external agent-config consumer who wants IDE depth has to ask for access.
- Solo-dev capacity is fixed; the marginal cost of A → B is the marketplace listings + privacy policy + code signing (≤2 PW one-time, ≤2 PD/quarter ongoing), not a marketing department.
- A leaves no recovery path if event4u priorities shift. B keeps the plugin alive in the marketplace independently of internal headcount.

### Why B over C

- C demands a marketing engine event4u does not have. Continue.dev is 4 years deep with 393 contributors; positioning as their alternative without an event4u-grade differentiator narrative is the "worse polish" failure mode the council named.
- B retains the option to drift toward C later (Y2-Y3) once event4u dogfooding proves out the differentiators. C is reversible-to-B with effort; A → C is a positioning reset.

### Open question this leaves

How explicit do we get about "event4u-first" in marketplace copy? Two flavors:
1. **Soft event4u-first.** Marketplace listing says "AI assistant with first-class support for agent-config skills, rules, commands, and personas." Screenshots show event4u workflows (Blog Post / Release Notes / Commit). No event4u brand visible.
2. **Hard event4u-first.** Marketplace listing says "event4u Agent IDE Plugin — built for content teams using event4u workflows." Brand front-and-center.

ADR-002 (Phase 9 Step 2) locks this. Default for the draft: **Soft event4u-first** — keeps the public-facing surface friendly to non-event4u adopters while delivering event4u-grade defaults out of the box.

## Decision session (Phase 2 Step 2)

Solo-dev decision (the author is the only stakeholder):
- ✅ Reject C (per council).
- ✅ Pick B (per analysis above).
- ⚠️ Open: soft vs hard event4u-first → captured for ADR-002.

## ADR-002 trigger

Phase 9 Step 2 drafts ADR-002 reflecting:
- Decision: Positioning B (public, event4u-first).
- Open question: soft vs hard event4u-first surface (defaulted soft, awaits user override).
- Consequences: code-signing required, GDPR-strict telemetry, modest marketing baseline, Y1 user target 50-300.

## Exit gate

Phase 2 Step 3 = ADR-002 drafted. Captured in Phase 9.
