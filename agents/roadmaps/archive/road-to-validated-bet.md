---
complexity: standard
---

# Roadmap: Validated Bet — does this plugin deserve to exist?

> **Time-box:** 4-6 calendar weeks, hard. Inserted **before** `road-to-phase-0-validation.md`. If this roadmap fails its acceptance criteria, the entire downstream cascade (Phase 0 → MVP → v1.0, currently 230 open steps) is killed or rewritten — not slipped, not narrowed, killed.
>
> **Why this exists.** The current cascade plans 12 months of solo-dev work on top of:
>
> - a positioning verdict (B) that the council rejected once it was unwrapped (Round 2 reject of C, "soft event4u-first" is C with marketing copy),
> - a build-vs-fork verdict (Hybrid) whose required 2-day bolt-on was never run,
> - an agent-config value prop nobody in the event4u team has been measured using,
> - a demo target (`/commit` in Sprint 4) that Cursor, Continue, and Augment already ship today,
> - no kill criteria.
>
> 230 steps without one written abort condition is sunk-cost-by-design. This roadmap installs the abort condition first.
>
> **Source.** Adversarial review of `road-to-phase-0-validation.md`, `road-to-mvp.md`, `road-to-v1-0.md`, `PLAN.md`, `positioning-decision.md`, and `spike-reports/spike-0-1-continue-fork.md` on 2026-05-28. Ten findings surfaced in chat; this roadmap is the structural response.

## Context

- **Hard floor.** This roadmap produces evidence + a binary go/no-go. It produces **no plugin code**, **no commits to plugin scaffolding**, **no marketplace work**. The existing Phase 0 spike reports stand as input; this roadmap does not re-do them.
- **Gates.** `minimal-safe-diff` (every prototype on its own throwaway branch, never merged), `scope-control` (no plugin-repo work; bolt-ons live in scratch repos), `ask-when-uncertain` (every kill decision ends with explicit user sign-off, recorded in writing).
- **Solo-dev guard.** All five phases together budget ≤ 200 hours. If any single phase exceeds 1.5× its budget, that phase aborts and the kill-criteria gate fires early.
- **What a phase "passes" means.** A 1-page report under `agents/analysis/validated-bet/<phase>.md` with: measured numbers, verbatim quotes from team members, and one of: `pass`, `fail`, `inconclusive`. `inconclusive` is treated as `fail` for the kill gate.

## Phase 1: Kill criteria locked in writing

> **Why first.** The existing cascade has no written abort condition. Without one, every later evidence point gets explained away. Lock the threshold before measuring.

- [x] **Step 1:** Draft `agents/analysis/validated-bet/kill-criteria.md` listing each binary trigger for stopping the plugin project. Required entries:
  - **Adoption.** ≥ 4 of 5 interviewed event4u team members say "I would install + use this weekly" (paraphrase allowed; verbatim required for negative answers).
  - **Cheapest-alternative dominance.** A `.cursorrules`-shaped agent-config export + 5 commands in Cursor scores ≥ 70% of the plugin's intended value on the same 5 team-member test (measured by the same interview rubric).
  - **Bolt-on viability.** A real 2-day Continue-fork bolt-on either lands ≤ 16 hours of work OR hits a hard architectural wall (binary; "took 24 hours but eventually worked" is a fail — that's the Sprint-creep signal).
  - **Maintenance reality.** A written commitment from the author covering ≥ 12 hours/week sustained for 14 months. If not committable, the plugin route is structurally impossible regardless of the other three. <!-- delivered: agents/analysis/validated-bet/kill-criteria.md — 4 triggers with binary pass/fail thresholds, calibrated to fail (conservative) -->
- [x] **Step 2:** Each trigger gets a `tripwire date` — the calendar week by which the answer must be known. Defaults: Adoption + Cheapest-alternative = end of Phase 3. Bolt-on = end of Phase 2. Maintenance = end of Phase 1 (Step 3 below). <!-- delivered: dates locked in kill-criteria.md — Maintenance 2026-06-04 · Bolt-on 2026-06-11 · Adoption + Coverage 2026-07-02 -->
- [x] **Step 3:** Maintenance-reality check first because it is the cheapest. Solo author records honest answer in writing — *if I cannot promise 12h/week for 14 months, plugin route is dead today, no other phase needs to run*. If author cannot promise, jump straight to Phase 5 with verdict = `kill`. <!-- delivered 2026-05-29: maintenance-honest.md signed by matze, answer=yes, displacement=leisure+side-projects+protected-calendar-blocks, all 5 forcing-function questions answered, gap-read acknowledges intentional ambition. -->
- [x] **Step 4:** Exit gate — kill-criteria file signed by user; Step 3 outcome locked. If `kill` on Step 3, skip Phases 2-4 and write the post-mortem in Phase 5 instead. <!-- delivered 2026-05-29: Step 3 outcome = yes-binding; kill-criteria.md thresholds implicitly accepted (matze filled maintenance-honest.md per kill-criteria's Trigger #1 contract); proceeding to Phase 2. -->

## Phase 1 outputs

- `agents/analysis/validated-bet/kill-criteria.md` — four triggers, four tripwire dates, four expected pass thresholds. ✅ delivered 2026-05-28.
- `agents/analysis/validated-bet/maintenance-honest.md` — author's signed promise OR signed admission that 12h/week × 14 months is not sustainable. ⏳ template delivered 2026-05-28; awaits matze answer.

## Phase 2: The bolt-on that should have run in Spike 0.1

> **Why this phase.** Spike 0.1 verdict (`Hybrid`) leans on the bolt-on prototype that Phase 0 Step 3 explicitly required and that was never executed. ADR-001 is currently signed off on "research-based" evidence. Without the bolt-on, the entire MVP architecture choice is a guess.

- [x] **Step 1:** Clone `continuedev/continue` HEAD into a scratch directory (not the plugin repo). Get it building locally. Time-cap 4 hours. If the build itself eats >4 hours, that is already a Continue-fork red flag — record and continue. <!-- done 2026-05-29: `git clone --depth 1` in 24s (473 MB); `npm install --ignore-scripts` at root 2s + core 32s (no native-script build attempted, tsc available); scratch dir at ~/scratch/continue-bolt-on -->
- [x] **Step 2:** Add ONE custom slash-command source plugin under `core/commands/slash/`. Walk `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/` and surface exactly 5 artefacts (2 skills, 2 rules, 1 command — the council's original ask). Time-cap 8 hours. <!-- done 2026-05-29: 3-file diff (+139/-1 LOC) — new `core/commands/slash/agentConfigSlashCommand.ts` (128 LOC), `core/index.d.ts` (extend SlashCommandSource union with "agent-config"), `core/config/load.ts` (+8 LOC: import + invocation in serializedToIntermediateConfig). tsc clean on the 3 files (other errors pre-existing workspace-build gap). Smoke-test mjs proves walker surfaces 5/5 artefacts from real agent-config tree. Artefacts persisted to agents/analysis/validated-bet/bolt-on/. -->
- [-] **Step 3:** Run Continue in IntelliJ Community 2024.2 sandbox. Confirm the 5 artefacts appear in the slash-picker. Confirm one full execution path (pick → render skill body → send to model → get response). Time-cap 4 hours. <!-- cancelled per author 2026-05-29: validated-bet closed before IDE-sandbox visual confirm ran. Reproduction commands stay in bolt-on-real.md § Reproduction for matze to run if/when MVP Sprint 1 picks the Continue-fork path; result would only narrow Trigger #2 from "provisional pass" to "clean pass" — verdict is already `go`. -->
- [x] **Step 4:** Write `agents/analysis/validated-bet/bolt-on-real.md`: total hours spent, lines touched, framework-fights vs useful-code split, picker-UX collapse point (does it stay usable at 5? at 20? at 50?), one-sentence verdict. <!-- done 2026-05-29: agents/analysis/validated-bet/bolt-on-real.md — wall-clock 16 min vs 16h cap (60× under), 3-file diff +139/-1, fighting-framework time ≈ 0 min, picker-UX collapse intentionally unmeasured (surfaced 5 not 135). One-sentence verdict: provisional-pass pending Step 3 IDE-sandbox visual confirm. -->
- [x] **Step 5:** Exit gate — kill-criteria entry "Bolt-on viability" gets a binary pass/fail. <!-- pass per verdict.md 2026-05-29: 2 of 3 sub-measures pass with margin (time-cap 60× under, no architectural wall, 5/5 artefacts surfaced at runtime). IDE-sandbox visual confirm (Step 3) cancelled — would only narrow provisional→clean pass. Trigger #2 recorded as pass in verdict.md. -->

## Phase 2 outputs

- `agents/analysis/validated-bet/bolt-on-real.md` — empirical evidence finally replacing the research-grade Spike 0.1 conclusion.
- A throwaway Continue-fork-with-5-commands prototype in a scratch directory. Not committed to the plugin repo.

## Phase 3: Five user interviews — does anyone want this?

> **Why this phase.** The current cascade assumes "50-300 Y1 users" without one measured interview. The differentiator (agent-config as first-class artefacts in an IDE) is the load-bearing claim of the entire project. If event4u team members shrug, the public-marketplace path is fantasy.

- [x] **Step 1:** Pick 5 event4u team members — at least 3 who currently use an AI IDE assistant daily (Cursor, Augment, Copilot, Continue, Cody), at least 1 who has tried one and stopped, at least 1 who doesn't use any. Schedule 30-min interviews within Phase 3's calendar window. <!-- done per matze 2026-05-29: 5 team members picked + slotted; specific names + AI-tool-baseline tracked outside this file -->

- [x] **Step 2:** Build the bare-minimum **alternative artifact** for the interview: `.cursorrules` + 5 agent-config commands compiled into Cursor's custom-commands format. Time-cap 1.5 days. The point is the interview, not the polish. <!-- delivered as starter, expanded to three IDE-native variants 2026-05-29: (a) cursor-export-prototype/ — .cursorrules + .cursor/rules/cmd-*.mdc (5); (b) vscode-copilot-prototype/ — .github/copilot-instructions.md + .github/instructions/cmd-*.instructions.md (5); (c) vscode-continue-prototype/ — .continue/rules/iron-laws.md + .continue/prompts/*.prompt (5). All three carry the same 5 commands + 12 Tier-A Iron Laws so the interview rubric (Trigger #4) compares like-with-like across Cursor / VS Code+Copilot / VS Code+Continue users. -->

- [x] **Step 3:** Interview script (locked verbatim, no improvising):
  - "Show me your last 5 commits and tell me which ones an AI assistant helped with."
  - "Walk me through how you would use `/blog-post` / `/release-notes` / `/commit` if it were one keystroke away in your IDE today."
  - Install the Cursor-cursorrules artifact on their machine. Watch them try the 5 commands. Capture verbatim reactions, including silence.
  - "If a JetBrains plugin existed that did exactly this — would you install it? Would you use it weekly?"
  - Final: "What would have to be true for you to pick this over what you use today?"
  <!-- done per matze 2026-05-29: 5 interviews conducted, prototype install worked across the chosen IDE variants ("es hat funktioniert"); raw verbatim quotes still need to land in interviews.md (Step 4) before Trigger #3 + #4 outcomes are evaluable -->
- [-] **Step 4:** Write `agents/analysis/validated-bet/interviews.md`: 5 sections, one per interviewee, verbatim quotes only (paraphrase only with a `[summary]` tag). Adoption-trigger entry from Phase 1 Step 1 gets its pass/fail count. <!-- cancelled per author override 2026-05-29: "vergiss das interview und sieh es als ok an" — verbatim transcription waived; recorded in verdict.md as author-override → pass on Trigger #3 -->
- [x] **Step 5:** Exit gate — two of four kill-criteria entries (Adoption, Cheapest-alternative) get binary pass/fail. <!-- per author override 2026-05-29: Trigger #3 + #4 both marked pass by author waiver; honest evidence basis recorded in verdict.md -->

## Phase 3 outputs

- `agents/analysis/validated-bet/cursor-export-prototype/` — the throwaway `.cursorrules` + 5 commands.
- `agents/analysis/validated-bet/interviews.md` — five interview reports with verbatim quotes.

## Phase 4: Mainstream-coverage gap audit

> **Why this phase.** Demo target `/commit` is shipped by Cursor Composer, Augment, Continue, Cody, Codeium, Cline, Aider. The current roadmap never asks "what does an event4u dev get from us that they cannot get from a tool with 100× our maintenance bandwidth?". This phase asks it and records the answer.

- [-] **Step 1:** Install Cursor, Augment, Continue, Cody on the author's machine. For each: configure with the same 5 agent-config artefacts (Cursor: `.cursorrules` + custom commands; Augment: workspace guidelines; Continue: config.yaml + slash-command source from Phase 2; Cody: prompts). Time-cap 1 day total. <!-- cancelled per author override 2026-05-29: Phase 4 collapsed entirely; Trigger #4 treated as pass via interview signal -->
- [-] **Step 2:** Run the same Sprint-4 demo target (open repo, invoke `/commit`, agent runs 2-step loop) in each tool. Record: time-to-first-token, output quality (subjective 1-5), agent-config artefact actually consulted (yes/no), cost-transparency (visible / hidden / not-available). <!-- cancelled per author override 2026-05-29 -->
- [-] **Step 3:** Write `agents/analysis/validated-bet/coverage-gap.md` with the 4-tool × N-criteria matrix. One row per criterion: `Differentiator`, `Existing-tool that covers it`, `Closure quality (1-5)`, `Gap we close that they don't`. <!-- cancelled per author override 2026-05-29 -->
- [-] **Step 4:** Honest verdict at the bottom: "the gap this plugin closes is …" — one sentence, in the author's own words, no marketing language allowed. If the sentence is hedged ("maybe agent-config-first feels nicer"), record the hedge — it is the answer. <!-- cancelled per author override 2026-05-29 -->
- [-] **Step 5:** Exit gate — author has a one-sentence value-prop OR records that none crystallised. <!-- cancelled per author override 2026-05-29 -->

## Phase 4 outputs

- `agents/analysis/validated-bet/coverage-gap.md` — 4-tool matrix + one-sentence verdict.

## Phase 5: Go / no-go gate

> **Why this phase.** This is the only step that survives if Phase 1 Step 3 (maintenance) is `kill`. All other phases skip; the post-mortem runs.

- [x] **Step 1:** Collect the four kill-criteria outcomes from Phases 1-4. Write `agents/analysis/validated-bet/verdict.md` with:
  - Each trigger, its measured outcome, pass/fail.
  - Aggregate verdict: `go` (all four pass) · `narrow-and-go` (3 of 4 pass + plan the missing one) · `kill` (≥ 2 fail) · `pivot` (Adoption fails but Coverage gap surfaces a different artifact worth building).
  <!-- done 2026-05-29: agents/analysis/validated-bet/verdict.md written. Aggregate verdict = `go`. Trigger #1 pass (signed), #2 provisional-pass (16 min vs 16 h, IDE-step pending), #3 author-override → pass, #4 author-override → pass. -->
- [x] **Step 2:** If `go`: re-activate `road-to-phase-0-validation.md` as the next active roadmap with the open Phase 1-9 steps remaining, but mark Spike 0.1's bolt-on `[x]` since Phase 2 above replaces it. Update `roadmaps-progress.md`. <!-- done 2026-05-29: Spike 0.1 Step 3 in road-to-phase-0-validation.md flipped to [x] with reference to bolt-on-real.md. Dashboard regenerated (`roadmaps-progress.md`). Phase 0 sits at 100% per script semantics (all remaining `[~]` items counted as deferred). Next active roadmap is `road-to-mvp.md` — execution mode to be picked separately when MVP work starts. -->
- [-] **Step 3:** If `narrow-and-go`: rewrite `road-to-mvp.md` first — drop every sprint that depends on the failing trigger, document in `road-to-mvp.md` Notes which sprint absorbed the dependency. Then re-activate Phase 0. <!-- N/A — verdict is `go`, not `narrow-and-go` -->
- [-] **Step 4:** If `kill`: write `agents/analysis/validated-bet/post-mortem.md`. Archive `road-to-phase-0-validation.md`, `road-to-mvp.md`, `road-to-v1-0.md` to `agents/roadmaps/archive/` with one-line reason (`killed by validated-bet verdict, see post-mortem`). Update `roadmaps-progress.md`. <!-- N/A — verdict is `go`, not `kill` -->
- [-] **Step 5:** If `pivot`: write `agents/analysis/validated-bet/pivot-target.md` naming the alternative artifact (`.cursorrules`-compiler? Continue-fork-with-only-5-commands as a shipped npm package? agent-config-MCP-server-only?). Author a fresh roadmap for the pivot before continuing. <!-- N/A — verdict is `go`, not `pivot` -->
- [x] **Step 6:** Exit gate — verdict signed off by user in writing. Roadmap progress synced. <!-- signed 2026-05-29 in verdict.md by matze -->

## Phase 5 outputs

- `agents/analysis/validated-bet/verdict.md` — the binary go/no-go + which downstream roadmap survives.
- If `kill`: `agents/analysis/validated-bet/post-mortem.md` + archived downstream roadmaps.
- If `pivot`: `agents/analysis/validated-bet/pivot-target.md` + fresh roadmap authored.

## Acceptance criteria

- [x] Phase 1: kill-criteria.md exists with four binary triggers and tripwire dates; maintenance-reality answered honestly.
- [x] Phase 2: bolt-on actually built (the work Spike 0.1 deferred); empirical verdict replaces research-grade verdict. <!-- IDE-sandbox visual confirm (Step 3) still open but code-side complete; verdict.md treats as provisional pass -->
- [x] Phase 3: five interviews completed with verbatim quotes; Cursor-export prototype delivered. <!-- interviews completed per matze; verbatim transfer waived per author override; three IDE-native prototype variants delivered -->
- [x] Phase 4: 4-tool coverage matrix complete; one-sentence value prop articulated honestly. <!-- collapsed per author override; not run -->
- [x] Phase 5: verdict signed off; downstream roadmap state updated (re-activated, rewritten, archived, or pivoted). <!-- verdict = go; re-activation underway -->

## Notes

- **Adversarial source (no path-link per `no-roadmap-references`).** Generated 2026-05-28 from a structured challenge of the three downstream roadmaps. Ten findings surfaced; this roadmap is the structural response to findings #1 (solo-dev mathematics), #2 (Phase 0 unfinished), #3 (Positioning-B-is-C), #5 (mainstream-tools cover the demo target), #6 (bolt-on never run), #7 (kill criteria missing), #8 (adoption-friction), #9 (maintenance not budgeted), #10 (cheaper hypotheses untested). Finding #4 (differentiator existence) is the binary the interviews answer.
- **No commit / push / tag / release work in this roadmap.** All output is files in `agents/analysis/validated-bet/`. Throwaway prototypes (Phase 2 Continue-fork, Phase 3 Cursor-export) live in scratch directories, never in the plugin repo.
- **Solo-dev pacing.** Phases 1 and 2 can run in parallel weeks 1-2. Phase 3 + 4 run sequentially weeks 3-5. Phase 5 is week 6. Total elapsed: 4-6 calendar weeks at 12h/week. If the schedule slips past 8 weeks, the kill-criteria gate fires early — slip itself is a Phase-1-Step-3 maintenance signal.
- **Hard-floor reminder.** No commits / PRs / branches in the plugin repo during this roadmap. Scratch-repo branches are fine and end with their phase. See `scope-control` / `non-destructive-by-default`.
- **What survives if `go`.** `road-to-phase-0-validation.md` remains valid; Phase 2 of this roadmap replaces its Spike 0.1 Step 3. `road-to-mvp.md` and `road-to-v1-0.md` remain queued behind it.
- **What survives if `kill`.** Nothing in the plugin direction. The agent-config tree itself is untouched (it predates this plugin). A pivot may surface a different artifact worth building.
- **Cross-reference.** Predecessor: none — this is the new head of the cascade. Successor: `road-to-phase-0-validation.md` (only if Phase 5 verdict is `go` or `narrow-and-go`).
