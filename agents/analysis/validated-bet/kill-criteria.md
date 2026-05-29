---
phase: validated-bet/1
step: Phase 1 Step 1 + Step 2
status: draft-awaiting-signoff
date: 2026-05-28
author: agent (autonomous /roadmap:process-full)
---

# Kill Criteria — when this plugin project stops

> Phase 1 Step 1 + Step 2 deliverable for `road-to-validated-bet.md`. Four binary triggers; four tripwire dates. Each trigger is **calibrated to fail**, i.e. its threshold is the conservative end of "evidence we would not have invented if we wanted the project to live." A `fail` on any single trigger forces a re-read of the verdict in Phase 5; **two or more `fail`s force `kill`** per Phase 5 Step 1.
>
> Locked **before** measurement so the threshold cannot drift to match the result.

## Trigger #1 — Maintenance reality

| Field | Value |
|---|---|
| **Question** | Can the solo author (matze) sustain ≥ 12 h/week on this plugin for 14 calendar months (MVP + v1.0), without burning out other event4u responsibilities? |
| **Pass threshold** | Written, signed promise + a single-line statement of what the author is **giving up** to make the 12 h/week real (one of: a current side-project, a meaningful slice of free time, an event4u-internal responsibility delegated to someone else). A promise without a stated trade-off is **fail** — it means the time has not been budgeted, only wished for. |
| **Fail threshold** | "I'll try" · "we'll see" · "I can probably manage" · any answer that does not name the displaced commitment. |
| **Measurement** | One-page `maintenance-honest.md` written + signed by author in Phase 1 Step 3. |
| **Tripwire date** | **2026-06-04** (end of validated-bet Week 1). |
| **Cheapest first** | Yes — this trigger runs before Phases 2-4 because its failure short-circuits everything else. |

**Why this trigger.** Plugin maintenance after v1.0 is not a Sprint, it is permanent halftime work (2 IDE platforms × API drift × every dependency upgrade). The PLAN.md timeline budgets sprints but never the maintenance overhead. If the author cannot honestly commit, the public-marketplace path (Positioning B) is structurally impossible and the cascade kills today, not in Month 11.

## Trigger #2 — Bolt-on viability

| Field | Value |
|---|---|
| **Question** | Does a Continue.dev fork accept the agent-config tree as a slash-command source plugin in ≤ 16 hours of empirical work? |
| **Pass threshold** | A working Continue branch where 5 hand-picked artefacts (2 skills + 2 rules + 1 command) appear in the slash-picker, one full execution renders the artefact body in the chat, and the work was finished in ≤ 16 wall-clock hours. |
| **Fail threshold** | Either (a) > 16 hours spent without a working slash-picker entry, OR (b) a hard architectural wall (Continue's `BaseLLM`, its `AtMentionDropdown` filter, or its config schema rejects the integration without a rewrite). "Took 24 h but eventually worked" is **fail** — that 50% overrun is the Sprint-creep signal the bolt-on is designed to surface. |
| **Measurement** | `bolt-on-real.md` written in Phase 2 Step 4 with hours, lines, fights-vs-useful-code split, picker-UX collapse point. |
| **Tripwire date** | **2026-06-11** (end of validated-bet Week 2). |
| **Replaces** | `Spike 0.1 Step 3` in `road-to-phase-0-validation.md`, which was time-capped 2 days but never executed. The current ADR-001 "Hybrid" verdict rests on this measurement; without it, every architectural choice from MVP Phase 1 onwards is research-grade only. |

**Why this trigger.** Spike 0.1's own verdict says: *"The bolt-on prototype rule (≤2 days clean → Fork) is **unlikely to pass** … We did not measure this empirically — that's the gap the user closes before signing ADR-001."* The plan rests on a gap that must be closed.

## Trigger #3 — Adoption signal

| Field | Value |
|---|---|
| **Question** | Do ≥ 4 of 5 interviewed event4u team members say (verbatim, not paraphrased) "I would install this plugin AND use it at least weekly" — **after** they have used the `.cursorrules` alternative for at least 15 minutes in the interview itself? |
| **Pass threshold** | ≥ 4 of 5 say yes verbatim. "Maybe" / "could be useful" / "if it worked" = **fail** count for that interviewee. |
| **Fail threshold** | ≤ 3 of 5 say yes. Important: silence after the question (>3s pause) counts as "no" — the rubric is strict on purpose because the published Y1-user estimate (50-300) leans on this very small sample being enthusiastic, not lukewarm. |
| **Sample shape** | 5 event4u team members: ≥ 3 daily AI-IDE users, ≥ 1 stopped-using one, ≥ 1 never tried one. Sample heterogeneity matters more than size at n=5. |
| **Measurement** | `interviews.md` in Phase 3 Step 4 with verbatim quotes (paraphrase only with `[summary]` tag). |
| **Tripwire date** | **2026-07-02** (end of validated-bet Week 5). |

**Why this trigger.** The 50-300 Y1 user count in `positioning-decision.md` was reasoned from precedent, not measured. n=5 is small but every member of the n=5 is also the seed for "would they tell a friend" — if 4 of 5 aren't enthusiastic, the marketplace path has no organic growth lever.

## Trigger #4 — Cheapest-alternative dominance

| Field | Value |
|---|---|
| **Question** | Does the `.cursorrules` + 5-commands export inside Cursor cover ≥ 70 % of the plugin's intended value, as measured by the same interview rubric used in Trigger #3? |
| **Pass threshold** | Interviewees rate the Cursor-export at ≤ 6/10 on perceived utility AND name at least one concrete gap that the plugin would close ("Cursor doesn't show cost per turn" / "Cursor can't run Claude in subscription mode" / "Cursor doesn't have agent-config skill auto-load"). |
| **Fail threshold** | Cursor-export rates ≥ 7/10 OR the named gaps are vague ("I'd just like it more in JetBrains"). Vague gaps mean the differentiator does not survive contact with the alternative — the plugin would be a polish-over-existing-tool play, which is the rejected Positioning C. |
| **Measurement** | Same `interviews.md` (Phase 3 Step 4) + `coverage-gap.md` (Phase 4 Step 3) — both must agree. |
| **Tripwire date** | **2026-07-02** (end of validated-bet Week 5). |

**Why this trigger.** This is the binary version of the "/challenge-me Point #5" finding: Cursor / Augment / Continue / Cody all ship the demo target (`/commit`) today. The plugin needs to close a gap they don't. If Cursor with agent-config rules dressed as `.cursorrules` scores ≥ 7/10, the plugin's gap is too narrow to justify 14 months of solo-dev work.

## Aggregate decision rule (used in Phase 5 Step 1)

| Pass count (out of 4) | Verdict |
|---:|---|
| 4 / 4 | **go** — re-activate `road-to-phase-0-validation.md`, mark Spike 0.1 Step 3 `[x]` (replaced by Trigger #2 measurement). |
| 3 / 4 | **narrow-and-go** — rewrite `road-to-mvp.md` to drop sprints that depend on the failing trigger, document absorber sprint in Notes. |
| ≤ 2 / 4 | **kill** — archive all three downstream roadmaps to `agents/roadmaps/archive/`, write `post-mortem.md`. |
| Adoption fails + Coverage surfaces alternative artifact | **pivot** — write `pivot-target.md`, author fresh roadmap for the alternative (e.g. agent-config-MCP-server-only, `.cursorrules`-compiler npm package). |

## Author sign-off

- ⬜ Author has read all four triggers and accepts each threshold **before** measurement begins.
- ⬜ Author commits to **not** re-negotiating any threshold mid-measurement.
- ⬜ Author commits to writing the Phase 5 verdict from the four outcomes as-measured, not as-hoped.

(Sign-off is recorded in Phase 1 Step 4 exit-gate.)
