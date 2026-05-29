---
phase: 0
step: Spike 0.5 UX Prototype
status: draft-mocks-text-based
date: 2026-05-28
---

# UX Prototype 0.5 — Slash-Picker + Rule-Injection + Command Detail

> **Form-factor note.** Roadmap asked for Figma/Penpot/Excalidraw. This session delivers **ASCII/markdown mocks** with explicit prop tables and interaction notes. Equivalent fidelity for go/no-go on the **interaction model** — strictly inferior for visual polish review. If the user wants visual fidelity before Sprint 4 picks UI direction, schedule 2-4 hours with Figma after this Phase closes.
>
> **What this validates.** That 135 commands + 219 skills + 31 personas + 77 rules can be made discoverable without overwhelming the user. The three sub-mocks below answer three sub-questions:
>
> 1. How does the user find a command among 135?
> 2. How does the user know which rules are active?
> 3. How does the user preview a command before invoking it?

## Mock 1 — Slash-picker (the discoverability question)

User typed `/` in the chat input. Picker appears.

```
┌─ Chat — event4u-agent ───────────────────────────────────────────────────┐
│                                                                          │
│  Previous turn output…                                                   │
│  Agent reply…                                                            │
│                                                                          │
│ ┌────────────────────────────────────────────────────────────────────┐   │
│ │ /                                                                  │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│ ┌── Commands (135 total) ─────────────────────────────────────────────┐  │
│ │ ★ /commit                Conventional commit, split in chunks      │  │
│ │ ★ /create-pr             PR title + body + reviewer routing        │  │
│ │ ★ /work                  Engine plan→implement→verify              │  │
│ │ ★ /code-review           Diff review at chosen effort              │  │
│ │ ★ /roadmap:process-step  Process next roadmap step                 │  │
│ │ ──────────────  Type to filter, ↑↓ to navigate, ⏎ to invoke ──────  │  │
│ │   /agent-status          What did the agent do this session        │  │
│ │   /agent-handoff         Generate fresh-session context dump       │  │
│ │   /analyze-reference-repo Deep-dive an external repo               │  │
│ │   /batch                 Run skill across many targets             │  │
│ │   /challenge-me          Counter-pressure my plan                  │  │
│ │   …(126 more)                                                       │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│   ╭─ Tabs ───────────────────────────────────────────────────────────╮   │
│   │  Commands(135)   Skills(219)   Personas(31)   Rules(77)          │   │
│   ╰──────────────────────────────────────────────────────────────────╯   │
│                                                                          │
│  ▸ 12 KB used  · 0.04¢ cache  · 4.27€ daily remaining                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Interaction model

- **Fuzzy match** as user types. Filter on `name + description + aliases`. Match score order: exact prefix > word-boundary > substring > fuzzy.
- **★ = Favorites.** Pinned to top, even when not matching the filter. Right-click → "Pin to favorites." Default favorites for a fresh install: `/commit`, `/create-pr`, `/work`, `/code-review`, `/roadmap:process-step` — covers ~80% of use per analysis of Claude Code command frequency.
- **Tabs** at bottom switch the scope: Commands · Skills · Personas · Rules. Tabs persist last-selected on next `/`. Skills tab is for invocation (`Skill <name>`); Personas/Rules tabs are for inspection.
- **No grouping** in v1.0 picker. Council finding #6 round 2 raised grouping as a concern, but with fuzzy + favorites, 135 commands are searchable without category collapse. Re-evaluate in v1.5 if user feedback says "too flat."
- **Keyboard:** `↑↓` navigate, `⏎` invoke, `→` opens command detail (Mock 3), `Esc` cancels.

### Why this answers the discoverability concern

| Concern (council round 2) | Mitigation in this mock |
|---|---|
| 135 commands overwhelming | Fuzzy filter narrows to ≤7 visible in <50ms |
| No grouping → cognitive overload | Favorites pin top 5; tabs separate scope |
| Users learn 10 commands, never discover the rest | Favorites pinning makes promotion explicit; right-click promote is one click |
| No way to preview before invoking | `→` opens Mock 3 (command detail) without invoking |

## Mock 2 — Rule-injection visibility ("which rules are active?")

User clicks the gear icon next to the chat. Sidebar opens.

```
┌─ Chat ────────────────┬─ Active rules (this turn) ────────────────────┐
│ User: …               │  Always-on (12 rules, ~9k tok cached):         │
│ Agent: …              │  ✓ agent-authority           [view]           │
│                       │  ✓ non-destructive-by-default                 │
│                       │  ✓ scope-control                              │
│                       │  ✓ commit-policy                              │
│                       │  ✓ security-sensitive-stop                    │
│                       │  ✓ tool-safety                                │
│                       │  ✓ runtime-safety                             │
│                       │  ✓ ask-when-uncertain                         │
│                       │  ✓ user-interaction                           │
│                       │  ✓ direct-answers                             │
│                       │  ✓ verify-before-complete                     │
│                       │  ✓ language-and-tone                          │
│                       │  ───────────────────────────────────          │
│                       │  Context (3 rules, ~2k tok):                  │
│                       │  ✓ docker-commands (project has docker)       │
│                       │  ✓ php-coding     (.php file open)            │
│                       │  ✓ laravel-routing (Laravel detected)         │
│                       │  ───────────────────────────────────          │
│                       │  Off-by-tier (62 rules, 0 tok)                │
│                       │  [show ▾]                                     │
│                       │                                                │
│                       │  ▸ Total injected: 15 rules · ~11k tokens     │
│                       │  ▸ Cache: ✓ hit ($0.003 this turn)            │
│                       └────────────────────────────────────────────────┘
│                                                                        │
│ [chat input]                                                           │
└────────────────────────────────────────────────────────────────────────┘
```

### Interaction model

- **Read-only by default.** Toggle requires the right-click → "Override for this conversation." Override is **per-conversation only**, never persisted globally. This avoids the failure mode of users silently disabling Iron-Law rules and forgetting.
- **Always-on (Tier A) rules show ✓ disabled.** Cannot be toggled off in v1.0. v1.5 adds an "admin override" via Settings.
- **Context (Tier B) rules show ✓ with a "why active" hint** (e.g., `(.php file open)`).
- **Off-by-tier (Tier C) list is collapsed.** Expanding shows the 62 rules currently not active with the trigger they would need to match.
- **Cost line at the bottom** ties this back to the cost-footer narrative.

### Why this answers the visibility concern

| Concern (council round 2) | Mitigation in this mock |
|---|---|
| Users don't know which rules are active | One-glance list grouped by tier |
| Users can't toggle | Per-conversation override (read-write) via right-click |
| Iron-Law rules accidentally disabled | Tier-A is hard-disabled in v1.0 picker; v1.5 admin override |
| Cost of rule injection opaque | Token + cache-hit cost surfaced inline |

## Mock 3 — Command detail (the preview question)

User hit `→` on `/commit` in Mock 1. Detail panel slides over the picker.

```
┌─ /commit · Conventional Commit Writer ───────────────────────────────────┐
│                                                                          │
│  Source:  agent-config/.agent-src/commands/commit.md                     │
│  Skill:   conventional-commits-writing  (auto-invoked)                   │
│  Tier:    favorite ★                                                     │
│  Roles:   developer (must), senior-engineer (review)                     │
│                                                                          │
│  ── What it does ──────────────────────────────────────────────────────  │
│  Split staged + unstaged changes into logical commit chunks, write       │
│  Conventional Commit messages for each, commit foundation-first.         │
│  Never asks "one commit or multiple?" — picks the split.                 │
│                                                                          │
│  ── Procedure (first 20 lines) ────────────────────────────────────────  │
│  1. Run git status + git diff to inventory changes.                      │
│  2. Classify changes by concern: scope / refactor / rules / config /     │
│     cleanup. Foundation-first means scope before cleanup.                │
│  3. For each chunk, generate the Conventional Commit subject and body.   │
│  4. Stage files for chunk N, commit, repeat.                             │
│  [show full procedure ▾]                                                 │
│                                                                          │
│  ── Will invoke skills ────────────────────────────────────────────────  │
│  - conventional-commits-writing                                          │
│  - verify-completion-evidence  (verify nothing is missed)                │
│                                                                          │
│  ── Will read rules ───────────────────────────────────────────────────  │
│  - commit-policy           (never commit without authorization)          │
│  - non-destructive-by-default  (Hard Floor for bulk deletes)             │
│  - scope-control           (which files are in scope)                    │
│  - no-attribution-footers  (no AI-generated trailers)                    │
│  - no-decorative-emojis-in-git-surfaces                                  │
│                                                                          │
│  ── Estimated cost ────────────────────────────────────────────────────  │
│  Input (this command's frontmatter+body, cached): 1.2k tok               │
│  + skill body (cached): 0.8k tok                                         │
│  + your repo's git status:  ~2.0k tok (one-shot, not cached)             │
│  Output cap (suggested): 1.5k tok                                        │
│  Estimated total: $0.012 first turn, $0.003 follow-ups                   │
│                                                                          │
│  [ Invoke command ]   [ Add to favorites ★ ]   [ ← Back to picker ]      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Interaction model

- **Source path always visible.** Users can `Cmd-click` to open the file in the IDE editor.
- **"Will invoke skills" / "Will read rules"** sections come from static analysis of the SKILL.md/command.md front-matter + body — no LLM call. This is a tree-walker output, computed at startup.
- **Estimated cost** combines static (cached frontmatter+body) and dynamic (your repo's context) lines so the user knows what's variable.
- **First 20 lines of procedure** are shown inline; "[show full ▾]" expands. Avoids the wall-of-text problem at 135 commands.
- **Buttons:** Invoke (executes), Add to favorites (pins to ★ in picker), Back (returns to picker).

### Why this answers the preview concern

| Concern (council round 2) | Mitigation in this mock |
|---|---|
| Users can't tell what a command does before running it | Procedure summary + "will invoke skills" / "will read rules" |
| Hidden cost surprises (cache-write cold-start) | Estimated cost surfaced before invocation |
| Source of truth opaque | Source path + Cmd-click to edit |
| Too much text per command | Top 20 lines + expand toggle |

## What the team-feedback step (Phase 5 Step 2) would test

The roadmap asks: show prototype to 2 event4u team members, capture verbatim reactions. **Cannot run in this autonomous session.** Template for the user to drive the validation conversation:

> ```
> Setup (5 min): screen-share these three mocks (Mock 1, 2, 3). Don't explain — let
> them ask questions. Capture every question verbatim.
>
> 5 questions to ask (in this order):
> 1. "If you wanted to commit your changes, what would you type? Show me."
>    → Watch: do they type `/commit`? Or `/c` and expect autocomplete?
>    → Watch: do they look at the picker tabs or the input?
>
> 2. "Look at Mock 2 (rule sidebar). Which rules look unnecessary to you right now?"
>    → Watch: do they question the always-on list or the context list?
>    → Watch: do they ask 'why is this on'?
>
> 3. "On Mock 3 (command detail), what's missing that you'd want before clicking
>    Invoke?"
>    → Watch: cost concern? Permission concern? Confirmation step concern?
>
> 4. "If we shipped this without grouping commands by category, would that be a
>    problem for you?"
>    → Watch: 'no, fuzzy is fine' vs 'yes, I need to see categories.'
>
> 5. "What's the smallest version of this you'd actually use day-to-day?"
>    → Watch: 'just /commit and /create-pr' = favourites-only is enough for MVP.
>    → Watch: 'all 135' = full picker non-negotiable.
> ```

Output: a Q5-driven scope decision for MVP T-403's slash-picker scope.

## Step 3 — exit gate

If team feedback collapses scope to "favourites-only" for MVP, T-403 ships:
- Slash-picker with **5-10 favourite commands only** (no full list).
- Full picker (135 commands, fuzzy + favourites) ships in v1.0 Sprint 6.

If team feedback keeps the full picker scope, T-403 ships the full Mock 1 picker as designed.

**Default for ADR-003 / MVP plan:** full picker (Mock 1) per the council's discoverability ask. Team feedback can shrink scope but not expand.

## Open questions for the user

1. **Visual fidelity required before MVP commits?** Schedule 2-4h Figma session post-Phase-0, or accept text-based prototype as the design spec?
2. **Team feedback session ownership.** Author runs it solo, or pair with another event4u-team member?
3. **Default favourites list.** Spike defaults to `/commit, /create-pr, /work, /code-review, /roadmap:process-step`. Override?
