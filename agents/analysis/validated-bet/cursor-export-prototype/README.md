---
phase: validated-bet/3
step: Phase 3 Step 2
status: starter — refine before Phase 3 Step 3 interviews
date: 2026-05-28
author: agent (autonomous /roadmap:process-full)
---

# Cursor Export — agent-config as a cheaper alternative

> Phase 3 Step 2 deliverable for `road-to-validated-bet.md`. The "bare-minimum alternative artifact" the Phase 3 interviews compare against.
>
> **What this is.** A `.cursorrules` file + 5 `.cursor/rules/*.mdc` command-shaped rules, compiled from `@event4u/agent-config/.agent-src/{rules,commands}/`. Drop into any project root → Cursor's AI auto-loads the always-on rules and the command rules fire on intent match.
>
> **What this proves (and doesn't).** Proves: agent-config content can be compiled into Cursor's native format without writing a custom IDE plugin. Does NOT prove: 4 of 5 event4u team members find this useful — that's Phase 3 Step 3-4 (interviews + verdict).

## File layout

```
cursor-export-prototype/
├── .cursorrules                        # 12 always-on Iron Laws (Tier-A subset of 77 rules)
├── .cursor/
│   └── rules/
│       ├── cmd-commit.mdc              # split-and-confirm git commits
│       ├── cmd-work.mdc                # implement-ticket end-to-end (refine → plan → build → verify)
│       ├── cmd-refine-ticket.mdc       # sharpen Jira/Linear ticket before planning
│       ├── cmd-create-pr.mdc           # draft + open PR via gh CLI, strip attribution
│       └── cmd-review-changes.mdc      # 4-judge diff review (bug / quality / tests / security)
└── README.md                            # this file
```

## How to use this for an interview (Phase 3 Step 3)

### Setup (5 min, do once before the interview)

1. Copy the **contents** of this directory (the `.cursorrules` file + the `.cursor/` folder) into the root of a representative event4u repo on the interviewee's machine. Pick a repo they actually work in daily.
2. In Cursor: open the repo. Settings → Rules → confirm `.cursorrules` is detected. Settings → Rules → Project Rules → confirm 5 entries under `.cursor/rules/` appear.
3. Restart Cursor's AI panel so the rules load fresh.

### During the interview (30 min)

**Opening question.** "Walk me through your last 5 commits. Which ones did an AI assistant help with?" — captures their baseline AI-IDE habit.

**Test sequence (15 min).** Ask the interviewee to perform 5 representative tasks using Cursor with this `.cursorrules` + the 5 command rules loaded:

| Task | Tests | What good looks like |
|---|---|---|
| 1. Make a small refactor, then ask Cursor to commit it | `cmd-commit.mdc` | Cursor produces split commit plan, waits for approval |
| 2. Open a Jira ticket page, ask Cursor "/work PROJ-123" | `cmd-work.mdc` | Cursor refines → plans → asks for go |
| 3. Paste a vague ticket draft, ask "is this AC clear?" | `cmd-refine-ticket.mdc` | Cursor rewrites AC + lists Top-5 risks |
| 4. Ask Cursor to open a PR | `cmd-create-pr.mdc` | Cursor drafts title + body, no emoji, no AI-attribution |
| 5. Ask "review my changes critically" | `cmd-review-changes.mdc` | Cursor runs 4 judges, lists findings by severity |

**Closing questions** (interview script per `road-to-validated-bet.md` Phase 3 Step 3):

1. "Did Cursor recognise the intent of each task without explicit slash-command typing?" (yes / partial / no)
2. "On a 1-10 scale, how useful is this compared to your current setup?" (Trigger #4 rubric)
3. "If a JetBrains plugin existed that did exactly this — would you install it AND use it weekly?" (Trigger #3 rubric — **verbatim quote required**)
4. "Name ONE concrete gap this setup has that the plugin would close." (the differentiator test — vague answers = fail)
5. "What would have to be true for you to switch from Cursor + this to the plugin?" (the migration cost)

## What this artifact is NOT

- **Not a polished product.** The 12 Iron Laws in `.cursorrules` are telegraph-condensed. The original 77 rules in agent-config have nuance the condensation drops. For a real Cursor user, the `.cursorrules` should be filtered per project context — that's the work the plugin's "context-active rule loading" was supposed to automate.
- **Not the full 135 commands.** Five of agent-config's 135 commands are compiled here. The other 130 are not — for the same reason the plugin wanted a slash-picker: 135 always-on commands would blow up the context budget.
- **Not the agent-config tree-walker.** The plugin's promised differentiator is automatic detection + loading of all skills / rules / commands / personas based on intent. Cursor's `.cursor/rules/*.mdc` does pattern-based loading (description + agent-requested), not the full agent-config semantics (`tier:`, `cluster:`, `packs:`).

The gap between THIS artifact (what Cursor can do) and the plugin (what's planned) IS the differentiator the Phase 3 interviews are designed to measure.

## Refinement notes for matze (before Phase 3 Step 1 scheduling)

The auto-generated starter above hits the structural shape. Before scheduling interviews:

- [ ] **Pick representative event4u repos.** Different interviewees may use different repos — Laravel monolith, content site, ghostwriter, agent-config itself.
- [ ] **Verify Cursor's `.mdc` parser** actually loads files with `agent_requested: false` AND `description: …` as "load on intent match". Cursor's rule semantics have shifted across versions.
- [ ] **Add 1-2 event4u-specific commands.** The 5 above are generic dev workflow. If you have a `/blog-post` or `/release-notes` command, swap one in — that's where the agent-config differentiator would be visible.
- [ ] **Pre-flight test yourself.** Walk through the 5 tasks BEFORE the first real interview. If a task lands flat for you, swap it.
- [ ] **Calibrate the rubric.** Trigger #4 says ≥ 7/10 utility from Cursor-export = fail for the plugin. Sanity-check that this scale matches how event4u team members actually rate tools.

## Why this is part of the kill-criteria

Per `agents/analysis/validated-bet/kill-criteria.md` Trigger #4:

> Does the `.cursorrules` + 5-commands export inside Cursor cover ≥ 70 % of the plugin's intended value, as measured by the same interview rubric used in Trigger #3?
>
> **Pass:** Cursor-export rates ≤ 6/10 AND interviewees name a concrete gap the plugin closes.
> **Fail:** Cursor-export rates ≥ 7/10 OR named gaps are vague.

A `fail` here = the plugin's differentiator does not survive contact with the cheapest alternative. Combined with another `fail` from Triggers #2 or #3, the cascade kills.

## Source

- Rules: `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/rules/` (77 files total).
- Commands: `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/commands/` (135 files total).
- Filtering strategy: Spike 0.4 Tier-A subset (12 rules) per `agents/analysis/spike-reports/spike-0-4-agent-config.md`.
