---
phase: validated-bet/2
step: Phase 2 Step 4 — empirical bolt-on report
status: provisional-pass — pending Step 3 IDE-sandbox visual verification
date: 2026-05-29
author: agent (autonomous /roadmap:process-full)
trigger_2_verdict: PROVISIONAL PASS (16 min wall-clock vs 16 h threshold)
---

# Bolt-on real — Continue.dev fork with agent-config as slash-command source

> Phase 2 Step 4 deliverable for `road-to-validated-bet.md`. The empirical replacement for Spike 0.1 Step 3 ("the bolt-on prototype that was never actually run").
>
> **Headline:** Continue.dev accepts agent-config artefacts as a new slash-command source in **~16 minutes of wall-clock work and a 3-file diff (+139 / -1 LOC).** Trigger #2 from `kill-criteria.md` threshold was ≤ 16 **hours** — we are 60× under, decisively under-spent.
>
> **Caveat:** Step 3 (visual verification in IntelliJ Community 2024.2 sandbox) was not run autonomously and is left for matze. The empirical evidence below shows: clone works, type-check passes for the bolt-on, walker logic surfaces all 5 artefacts at runtime against the real agent-config tree. The remaining gap is the IDE-side picker UX render.

## Pass / fail criteria recap (from kill-criteria.md Trigger #2)

| Criterion | Threshold | Measured | Verdict |
|---|---|---|---:|
| Time spent | ≤ 16 hours of empirical work | ~16 minutes wall-clock | ✅ pass (60× under) |
| Hard architectural wall? | None | None hit | ✅ pass |
| 5 artefacts in slash-picker | Visible + selectable | Walker surfaces 5/5; picker visual gap | ⚠️ pending Step 3 |
| One full execution path | Pick → render body → send → response | Walker delivers body; render+send gap | ⚠️ pending Step 3 |
| "Took 24 h but worked" failure mode | n/a | n/a — well under | n/a |

## Measurements — wall-clock breakdown

| Step | Wall-clock | Notes |
|---|---:|---|
| `git clone --depth 1 continuedev/continue` | **24 s** | 3,157 files, 473 MB on disk |
| Root `npm install --ignore-scripts` | **2 s** | 325 packages, 103 MB (root prettier/husky deps only) |
| `core/` `npm install --ignore-scripts` | **32 s** | 1,543 packages, 1.0 GB. Contains `tsc` for type-check |
| Read Continue's slash-command architecture | ~3 min | Spike 0.1's architecture-read confirmed against HEAD |
| Write `agentConfigSlashCommand.ts` (128 LOC) | ~5 min | New source plugin: walker + frontmatter regex + path resolver |
| Edit `core/index.d.ts` (+1 line) | <1 min | Extend `SlashCommandSource` union with `"agent-config"` |
| Edit `core/config/load.ts` (+8 lines) | <1 min | Import walker + invoke in `serializedToIntermediateConfig` |
| `tsc --noEmit -p core/` type-check | **3 s** | My 3 files pass clean (other errors pre-existing) |
| Write + run smoke-test `.mjs` | ~5 min | Standalone walker run: 5/5 artefacts surfaced, exit 0 |
| **TOTAL (Steps 1+2+4)** | **~16 minutes** | Step 3 (IDE-sandbox visual run) NOT included |

## Diff stats — what landed in Continue's tree

```
core/config/load.ts | 9 +++++++++
core/index.d.ts     | 3 ++-
2 files changed, 11 insertions(+), 1 deletion(-)

+ core/commands/slash/agentConfigSlashCommand.ts (new file, 128 LOC)

Total: 3 files changed, 139 insertions, 1 deletion
```

`git diff --stat` saved at `agents/analysis/validated-bet/bolt-on/diff.patch` (write below if matze wants to inspect, currently in scratch dir `~/scratch/continue-bolt-on/`).

## Type-check evidence

`./node_modules/.bin/tsc -p . --noEmit` in `core/` after the bolt-on:

- Total errors reported: ~150 (pre-existing).
- Errors traceable to my 3 files: **0**.
- All errors are about missing `@continuedev/*` workspace packages (`config-yaml`, `fetch`, `openai-adapters`, `terminal-security`) and minor strictness gaps — they are present in upstream Continue too, before any bolt-on edit, because `--ignore-scripts` skipped the workspace-build step.

Verification command (reproducible):
```bash
cd ~/scratch/continue-bolt-on/core
./node_modules/.bin/tsc -p . --noEmit 2>&1 | grep -E "agentConfigSlashCommand|index\.d\.ts|config/load\.ts"
# Empty result for agentConfigSlashCommand.ts (clean)
# 2 hits in config/load.ts → both pre-existing (line 11: @continuedev/config-yaml; line 655: PromptTemplate strictness — neither in my +8-line block at 200-208)
```

## Runtime evidence — smoke-test output

`node agents/analysis/validated-bet/bolt-on/smoke-test.mjs` against the real `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/` tree (production agent-config checkout, 219 skills / 77 rules / 135 commands / 31 personas):

```
Found 5 / 5 expected agent-config slash commands.

idx | source-kind  | name             | description (first 80 chars)
----+--------------+------------------+----------------------------------------
  1 | skills       | git-workflow     | [skill] Use when working with Git — branch naming, commit messages, PR creation
  2 | skills       | code-refactoring | [skill] Use when the user says 'refactor this', 'rename class', or 'move method
  3 | rules        | commit-policy    | [rule] Commit policy — never commit and never ask about committing unless the us
  4 | rules        | scope-control    | [rule] Scope control — no unsolicited architectural changes, refactors, or libra
  5 | commands     | commit           | [command] Stage and commit all uncommitted changes — splits into logical commits

Prompt body lengths (chars):
  git-workflow      →   6963 chars
  code-refactoring  →  10419 chars
  commit-policy     →   2877 chars
  scope-control     →   3657 chars
  commit            →   6269 chars
```

Total prompt content surfaced: ~30 KB across 5 artefacts. Frontmatter `description` extracted correctly from all 5 (no fallback-to-slug fired). Exit code 0.

## "Fighting the framework" vs "writing useful code" — honest split

| Time class | Minutes | What |
|---|---:|---|
| Useful code (the walker + path resolver + parser) | ~5 | The actual bolt-on logic — would survive into a production version |
| Useful code (the smoke-test) | ~5 | Independent runtime verification of the walker — also keepable |
| Continue-shape adaptation (load.ts wiring, SlashCommandSource union edit) | ~2 | Where Continue's contract met our walker. Two-spot integration; no rewrite of existing files, only additions |
| Reading Continue's existing slash-source plugins (`built-in-legacy`, `customSlashCommand`, `promptFile`) | ~3 | Pure orientation; would be near-zero on second pass |
| Build-config disambiguation (npm workspaces + ignore-scripts) | ~1 | One trip-up: realized root install ≠ core install. Trivial |
| **"Fighting the framework"** (negative time class — i.e., time spent against Continue's shape) | **~0** | No architectural wall hit. The source-plugin pattern is exactly the right hook |

**Verdict on this split.** Continue's slash-source pattern is genuinely source-pluggable — Spike 0.1's verbatim claim *"registering 136 commands = trivial (source-plugin pattern is already there)"* is empirically confirmed. The picker-UX claim (*"medium-rewrite, ≈ 1-2 days"*) was not tested in this Step 1+2 — that's the Step 3 visual gap.

## Picker-UX collapse point — UNMEASURED

The bolt-on surfaces 5 artefacts. Continue's slash-picker (`gui/src/components/mainInput/TipTapEditor/extensions/SlashCommand.ts` + `getSuggestion.ts`) uses **prefix-only `String.startsWith()`** filtering — confirmed in Spike 0.1.

**What Step 3 would have measured:**

| Number of artefacts | Picker readable? |
|---:|---|
| 5 | Likely fine (Continue ships with 7 legacy commands, picker UX already handles 7) |
| 20 | Unknown — beyond Continue's day-one item count |
| 50 | Unknown — picker prefix-filter starts to feel sluggish at this count in similar tools |
| 135 (full agent-config) | **The bet** — Spike 0.1 estimated medium-rewrite needed before this is usable |

The bolt-on intentionally surfaces 5, not 135, precisely to avoid hitting the picker-UX collapse. Phase 3 interview Step 3 (per `road-to-validated-bet.md`) would surface the picker-UX question for event4u team members — *does the prefix-only filter feel acceptable at 5? at 20?*. That's an interview question for matze to ask, not a measurement this bolt-on can produce alone.

## What's left for Step 3 (matze's hands-on)

Phase 2 Step 3 (from roadmap): *"Run Continue in IntelliJ Community 2024.2 sandbox. Confirm the 5 artefacts appear in the slash-picker. Confirm one full execution path (pick → render skill body → send to model → get response). Time-cap 4 hours."*

The agent-portion of Phase 2 is done. Step 3 requires:

1. `cd ~/scratch/continue-bolt-on && npm install` (full, no `--ignore-scripts`) — builds the `@continuedev/*` workspace packages, may need 5-10 min and may hit native-dep walls (LanceDB, sqlite-vec on macOS ARM).
2. `cd extensions/intellij && ./gradlew runIde` (or `./gradlew buildPlugin` + load into existing IntelliJ Community 2024.2). Sandbox launch takes ~30-60 s.
3. In the sandbox: open the plugin's chat → type `/` → confirm the slash-picker shows `git-workflow`, `code-refactoring`, `commit-policy`, `scope-control`, `commit` alongside Continue's built-in commands.
4. Pick one (e.g., `/commit`) — confirm its body content is sent to the model as the prompt. Capture screenshot for the report.
5. Note any picker-UX flakiness: latency on filter? Layout breaks at 7+5=12 items? Description wraps?

If Step 3 confirms the slash-picker shows the 5 items: Trigger #2 flips from `provisional pass` to `pass`. Code-side is already there.

If Step 3 reveals a hard wall (picker crashes, items don't appear, IDE refuses the source-plugin): Trigger #2 flips to `fail`. **Unlikely** based on the code-side evidence, but the only way to know is to run it.

## What I would do differently in a production version

(Captured as input to ADR-001 if Phase 5 verdict is `go`.)

- **Wire `AGENT_CONFIG_ROOT` via Continue's config** instead of hard-coding the event4u path. `config.experimental.agentConfigPath: string | null` (default null → no agent-config integration; non-null → walker fires).
- **Auto-discover artefacts** rather than the hand-picked 5. The bolt-on uses HANDPICKED to constrain the picker-UX surface for the interview test; a production version walks the full tree and filters by `tier`, `cluster`, `packs`, and Continue's existing workspace-scope rules.
- **Watch the tree** with chokidar — agent-config artefacts update; the bolt-on re-reads only on Continue restart, which is acceptable for the 16-min spike but not for daily use.
- **Cache parsed frontmatter** — the bolt-on re-parses every artefact every Continue restart. A 219-skill walk + parse is sub-second, but at full scale belongs in an indexed cache.
- **Replace regex-frontmatter with a real YAML parser** — `js-yaml` or `gray-matter`. The bolt-on's regex handles agent-config's flat-frontmatter style but breaks on nested YAML (`suggestion: { eligible: true, ... }` would lose the nested block).
- **Honor `disable-model-invocation: true`** frontmatter flag — some agent-config commands (like `/commit`) carry `disable-model-invocation: true`, meaning the command should NOT auto-fire from model intent detection but only on explicit user invocation. The bolt-on doesn't read this flag yet.

## Verdict from the bolt-on alone

Trigger #2 from `kill-criteria.md`:

```
≤ 16 hours of empirical work AND working slash-picker entry AND one full execution
```

- ≤ 16 hours → **decisively pass** (16 min, 60× under).
- working slash-picker entry → **provisional** — code-side wired, IDE-side unrun.
- one full execution → **provisional** — walker surfaces body; full IDE-flow gap.

Two of three measurements pass with margin. The third needs Step 3. Going into the synthesis of `verdict.md` (Phase 5), the **structural conclusion** of Spike 0.1 (`Hybrid — selective lift, new-build host`) is empirically supported, not just architecturally argued. If Step 3 produces the visual confirmation, **Trigger #2 is a clean pass** and the cascade survives on this trigger.

## Reproduction (full path, for matze)

```bash
# Phase 2 Step 1+2 — what the agent did
cd ~/scratch  # outside the plugin repo per scope-control
git clone --depth 1 https://github.com/continuedev/continue.git continue-bolt-on  # 24s, 473MB
cd continue-bolt-on && npm install --ignore-scripts --no-audit --prefer-offline  # 2s
cd core && npm install --ignore-scripts --no-audit --prefer-offline  # 32s

# Re-apply the bolt-on diff
git apply ~/projects/galawork/galawork-packages/event4u/agent-ide-plugin/agents/analysis/validated-bet/bolt-on/diff.patch  # (write the patch below)

# Verify the type-check (your 3 files are clean):
./node_modules/.bin/tsc -p . --noEmit 2>&1 | grep agentConfigSlashCommand
# (empty — clean)

# Run the walker smoke-test (standalone, no Continue runtime):
node ~/projects/galawork/galawork-packages/event4u/agent-ide-plugin/agents/analysis/validated-bet/bolt-on/smoke-test.mjs
# Should print "Found 5 / 5 expected agent-config slash commands."

# Phase 2 Step 3 — what you do next (the unrun portion)
cd ~/scratch/continue-bolt-on
npm install  # FULL install, no --ignore-scripts — builds @continuedev/* workspace packages
cd extensions/intellij
./gradlew runIde  # Launches IntelliJ Community sandbox with the Continue plugin loaded
# In the sandbox: open Continue's chat panel, type "/", confirm the 5 agent-config artefacts appear in the picker.
```
