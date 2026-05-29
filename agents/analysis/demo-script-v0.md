---
phase: 0
step: Phase 8 Step 1
status: draft-pending-team-validation
date: 2026-05-28
target_demo: end of MVP Sprint 4 (T-414)
default_command: /commit
---

# Demo Script v0 — Sprint-4 MVP Demo

> **Purpose.** Sprint 4's "internal demo" (T-414) needs a script before T-403 picks the lead command. A demo without script = waterfall failure (dev builds what they think is cool; users want something else). This script names the command, the scenes, the expected cost-footer values, the expected timing — and the substitution points where a different command could replace `/commit` if Phase 8 Step 2 reveals the team would actually use `/blog-post` more.
>
> **Pivot from Spike 0.3c.** The CLI is reply-stream, not token-stream. Demo timing reflects this — no typing animation, spinner during `ttft_ms`, then full reply at once.

## Demo target (from `road-to-mvp.md`)

> Open PhpStorm + VS Code, open event4u repo, type `/commit` in the plugin chat. Plugin reads `commands/commit.md` from the agent-config tree, the agent **runs a minimal 2-step tool-call loop** (read `git status` → propose commit message), user accepts. Cost footer shows tokens + USD. Stop button works. Hard caps fire on a prepared "expensive prompt" scenario.

## Scene-by-scene (2 pages)

### Scene 1 — IDE + plugin launch (30 sec, no cost)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| PhpStorm 2024.2 opens with event4u repo. Plugin tool window visible on the right. | "This is the event4u repo. Plugin tool window. No chat yet." | 5 sec |
| Side-by-side VS Code window opens with same repo. Same plugin tool window. | "Same plugin, same agent-config tree, two IDEs. Same brain." | 5 sec |
| User makes a tiny code change (rename a variable in `app/Modules/Foo/Foo.php`). Saves. | "I'm going to commit this. Watch the picker." | 10 sec |
| User types `/` in chat. Picker opens with favourites pinned. | "135 commands. Fuzzy. Favourites pinned." | 10 sec |

**No cost incurred.** Picker is local; no LLM call.

### Scene 2 — Command selection + cost preview (15 sec, no cost)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| User selects `/commit`. Command-detail panel opens (Mock 3 from `ux-prototype-0-5`). | "Before invoking, you see what it'll do." | 5 sec |
| Estimated cost line: `$0.012 first turn, $0.003 follow-ups`. | "Pre-flight cost. No surprises." | 5 sec |
| User hits "Invoke." | "Now it runs." | 5 sec |

**No cost incurred yet.** Pre-flight estimate uses cached frontmatter; no actual LLM call.

### Scene 3 — Tool-call loop step 1: `git status` (5-8 sec, ~$0.001)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| Spinner appears: "Reading repo state…" | "Step 1 — agent asks to run `git status`. Hard-Floor allowlist passes; it runs." | 1 sec |
| Permission prompt: "Run `git status`? [Allow always-this-session] [Allow once] [Deny]" | "First time we see this command, it asks. After this, it's session-allow-listed per ADR-004." | 3 sec |
| User picks "Allow always-this-session." Status output appears in the panel: ```M app/Modules/Foo/Foo.php``` | "That's the tool result. Now the agent sees one modified file." | 1 sec |

**Cost so far:** ~$0.001 (countTokens pre-flight + first turn cache-write — small because allowlisted commands are exempt from confirmation cost overhead in MVP).

### Scene 4 — Tool-call loop step 2: propose commit message (3-5 sec, ~$0.011)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| Spinner: "Drafting commit message…" Spinner runs ~3 sec (TTFT from Spike 0.3c). | "This is the LLM call. Watch the spinner — about 3 seconds." | 3 sec |
| Spinner replaces with proposed message:<br>`refactor(foo): rename {old} → {new} for readability`<br><br>`- Renamed identifier in app/Modules/Foo/Foo.php:42`<br>`- No behavior change` | "Reply-stream — full message appears at once. Sprint 4 doesn't do per-token typing animation." | 1 sec |
| Below the message: `[ Accept and commit ]   [ Edit ]   [ Cancel ]` | "Accept. Edit. Cancel. Standard." | 1 sec |
| User clicks "Edit," tweaks the subject. Clicks "Accept and commit." | "Demo shows the edit affordance." | 5 sec |

**Cost so far:** ~$0.012. Cost footer ticks up live: `$0.012 turn · $0.012 conversation · $4.26 daily remaining`.

### Scene 5 — Hard-Floor demonstration (10 sec, no cost — gate fires before LLM)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| Demo-er types `/commit` again, but this time invokes a scripted scenario where the agent **proposes `git push origin main` as the next step** (fake skill installed for the demo). | "Now I'll show what happens when a skill tries to push to main. Watch the gate." | 5 sec |
| Hard-Floor toast appears: **❌ Blocked. `git push origin main` matches Hard-Floor pattern `prod-branch-push`. Not allowed.** | "Layer 2 — Hard-Floor pattern. ADR-004. Per-conversation override is NOT available — this is hard-denied." | 5 sec |

**Cost incurred:** $0.001 for the LLM-proposed-action (the LLM did produce the tool call), then $0 for the gate (no further LLM round).

### Scene 6 — Stop button + cost footer (5 sec)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| Demo-er triggers a long-running scripted skill ("Summarize this entire 50k-token PDF"). Spinner appears. | "Long task. Watch the stop button." | 2 sec |
| User clicks "Stop" mid-stream. Spinner clears. Cost footer shows `$0.038 (stopped, ~50% complete)`. | "Stop works. Cost is honest — you pay for what came back, no more, no less." | 3 sec |

### Scene 7 — Recap (10 sec)

| What appears | What the demo-er says | Expected duration |
|---|---|---|
| Cost footer total: `$0.051 this session · 4 commands · 0 Hard-Floor violations after gate fix`. | "Five cents for the whole demo. Hard-Floor caught the bad push. Stop worked. agent-config commands surfaced naturally." | 10 sec |

**Total demo time: ~75 sec live, padded for talk-through = 3-4 minutes.**

## Substitution table — if Phase 8 Step 2 reveals a different command is more useful

The script above is `/commit`-centric. If the team validates that `/blog-post` or `/release-notes` is more representative of their daily use, swap Scene 3-4 accordingly:

| If team picks | Scene 3 (tool 1) | Scene 4 (tool 2) | Cost shape |
|---|---|---|---|
| `/commit` (default) | `git status` | propose commit message | ~$0.012 |
| `/blog-post` | `Read CHANGELOG.md` | draft 600-word post | ~$0.028 |
| `/release-notes` | `git log v1.0..v1.1` | summarize into release notes | ~$0.020 |
| `/refine-ticket` | `Read agents/runtime/jira/PROJ-123.md` | rewrite ticket | ~$0.018 |
| `/feature-roadmap` | `Read 2-3 related ADRs` | draft phase tree | ~$0.045 |

Hard-Floor scene (5) stays the same — illustrates the gate independent of the demo command.

## Cost-footer values (expected by scene)

| Scene | Footer value at end of scene |
|---|---|
| 1 | (no footer yet — pre-pickup) |
| 2 | `pre-flight: $0.012 estimated` |
| 3 | `$0.001 · 1 turn · $4.27 remaining` |
| 4 | `$0.012 · 1 turn · $4.26 remaining` |
| 5 | `$0.013 · 2 turns · $4.26 remaining · 1 Hard-Floor block` |
| 6 | `$0.051 · 3 turns · $4.21 remaining · 1 stop` |
| 7 | `$0.051 · 3 turns · $4.21 remaining · 1 Hard-Floor block · 1 stop` |

## Stage props required

For the demo to look credible:

1. **Live event4u repo** with at least one uncommitted change (Foo.php rename).
2. **A scripted skill that proposes a Hard-Floor-blocked action.** Lives in `agents/analysis/demo-fixtures/skill-push-to-main.md` for the demo only — NOT shipped in the plugin.
3. **A scripted long-running skill** (50k-token PDF summary) for the stop demonstration. Real PDF in `agents/analysis/demo-fixtures/big.pdf` (CC0-licensed source).
4. **A pre-set "daily remaining" budget** of $4.27 in the plugin's Settings so the footer math demos cleanly.

## Team-feedback session (Phase 8 Step 2 — pending)

Show this script (and ideally a video walk-through if available) to 2 event4u team members. 4 questions:

```
1. "Is /commit the command you'd use most? If not, name three you'd use more."
2. "Would the cost preview before invocation reassure you or scare you?"
3. "Is the Hard-Floor demo visceral enough to make the safety story land?"
4. "If we cut one scene, which one and why?"
```

Capture verbatim. If two of two team members name a different command in Q1, swap it into Scene 3-4 per the substitution table above. T-403 in `road-to-mvp.md` then references the chosen command verbatim.

## Acceptance for Phase 8 Step 3

- ✅ Demo script drafted (this file).
- ⚠️ Team validation (Step 2) pending — autonomous session cannot run.
- ⚠️ T-403 verb-lock pending Step 2 outcome.

## Cross-references

- ADR-004 (permission model) — Hard-Floor demo in Scene 5.
- Spike 0.3c — reply-stream UX, not per-token streaming, drives Scene 4 timing.
- Spike 0.4 — cost figures use Sonnet 4.6 pricing.
- UX prototype 0-5 — Mock 3 (command detail) is the surface in Scene 2.
- MVP T-411b — pre-flight cost estimate is the surface in Scene 2 footer.
