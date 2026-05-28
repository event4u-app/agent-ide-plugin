---
spike: 0.5 — UX prototype
phase: 0 (Validation)
status: prototype-delivered-feedback-pending
date: 2026-05-28
runtime_validated: false
---

# Spike 0.5 — UX prototype rationale + feedback template

## Pass / fail criteria (from roadmap)

- **Step 1:** Build 30-min mock of slash-picker (135 cmds), rule-injection UX, command-detail view.
- **Step 2:** Show prototype to 2 event4u team members, capture verbatim reactions.
- **Step 3:** Exit gate — feedback recorded; slash-picker scope confirmed or shrunk.

## What this session delivered

- **Three ASCII/markdown mocks** with interaction notes, prop tables, and rationale at `agents/analysis/ux-prototype-0-5/README.md`:
  - Mock 1 — Slash-picker with fuzzy filter + favorites + tabs (135 commands).
  - Mock 2 — Active-rules sidebar with tier grouping + cost line.
  - Mock 3 — Command detail with skill/rule dependency graph + cost estimate.
- **Verbatim feedback-session template** (5 questions, ordered, with "what to watch for") for the user to drive the team-validation step. Not run in this session — requires two team members and ~30 minutes of synchronous time.

## Provisional verdict (pre-feedback)

**Discoverability question is answered** by fuzzy + favorites; **visibility question is answered** by the active-rules sidebar; **preview question is answered** by command detail with cost estimate. If team feedback validates this without major rework, MVP T-403 ships the full Mock 1 picker.

**If team feedback collapses scope** to "I just want 5 commands ready to go," T-403 ships favourites-only and the full picker moves to v1.0 Sprint 6. This shrink is acceptable per the roadmap's exit-gate condition.

## What the team-feedback session would discover that we cannot

1. **Whether `★ favourites` are discoverable on first launch.** If users don't notice the pin column, the categorization concern resurfaces.
2. **Whether the active-rules sidebar is a feature or noise.** Some teams want to ignore rule injection; others want to audit every turn.
3. **Whether cost surfaces (Mock 1 footer + Mock 3 estimate) are reassuring or scary.** "$0.012 first turn" might read as "expensive" to a team not used to per-action pricing.
4. **Whether 20-line procedure preview is enough or too much.** A team that wants the full procedure inline ≠ a team that wants 5 lines.

These are quantitative-vs-qualitative gaps that no autonomous session closes — they require live human reactions.

## Recommendation to user

Run the 5-question validation in `agents/analysis/ux-prototype-0-5/README.md` § "What the team-feedback step would test" with two event4u team members before MVP Sprint 4 begins. Capture verbatim reactions in this file under a new `## Feedback (date)` section. ADR-003 (Phase 9) reflects the post-feedback scope.

## Open question on visual fidelity

Text-based mocks are sufficient for **interaction-model decisions** (which surface, which action, which key) but inferior for **polish review** (color contrast, type hierarchy, density). If the user wants Figma fidelity before Sprint-4 ships, schedule 2-4 hours; otherwise the mocks above are the contract.

## Feedback (pending)

> _To be filled in after the user runs the team-validation session._
>
> Q1 (commit flow): …
> Q2 (rule sidebar): …
> Q3 (command-detail missing): …
> Q4 (grouping required): …
> Q5 (smallest usable subset): …
>
> Scope decision: …
