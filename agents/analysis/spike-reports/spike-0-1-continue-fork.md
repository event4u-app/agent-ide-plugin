---
spike: 0.1
phase: 0 (Validation)
status: research-based-verdict
date: 2026-05-28
verdict: Hybrid — selective lift, new-build host
runtime_validated: false
---

# Spike 0.1 — Continue.dev Fork-vs-Build

> **What this is.** Phase 0 Step 4 deliverable. Hard evidence from a deep read of `continuedev/continue` (HEAD as of 2026-05-28), not a hands-on bolt-on prototype. Step 1 (local build) and Step 3 (bolt-on prototype) were not executed in this session because they require ≥3 calendar days of single-developer time; the verdict below is therefore **provisional** until the user runs the bolt-on prototype OR accepts the research-grade evidence in lieu of it. Every claim is cited with the Continue source path.

## Pass / fail criteria (from roadmap)

- **Fork** if: bolt-on prototype clean in ≤2 days **AND** ≤8 differentiator rows show `Modification effort ≥ "rewrite"` **AND** maintenance burden is `low`/`medium`.
- **New-build** if: bolt-on prototype hit a hard architectural wall.
- **Hybrid** otherwise: list lifts vs. fresh builds.

## Top-line verdict

**Hybrid.** Three load-bearing differentiators land in rewrite/medium-rewrite territory (provider dual-mode, slash-picker at 136, in-chat cost footer), and two more (Hard-Floor permission, agent-config host) need new code that has no natural home in Continue's shape. But four subsystems are genuinely worth lifting (terminal-security gate, model-pricing tables, JCEF + Node-sidecar architecture, tree-sitter+LanceDB indexing), and Apache-2.0 + 393 contributors mean the lifts come with momentum behind them.

The bolt-on prototype rule (`≤2 days clean` → Fork) is **unlikely to pass**: rewiring `BaseLLM`'s cost/usage path from API JSON to CLI-text parsing alone is the work of 2 days. We did not measure this empirically — that's the gap the user closes before signing ADR-001.

## Evidence — full repo snapshot

Source: `github.com/continuedev/continue` HEAD `main` 2026-05-28. License **Apache-2.0** (`gh api repos/continuedev/continue/license`). Stars 33,435 · 393 contributors.

### 1. Repo structure

Top-level: `core/` (TS engine: `llm/`, `commands/`, `tools/`, `indexing/`, `context/`, `autocomplete/`, `protocol/`, `config/`), `extensions/{vscode,intellij,cli}/`, `gui/` (React + TipTap, shared between VS Code + JetBrains), `binary/` (esbuild + `pkg` packager — bundles `core/` into a platform-native binary spawned by the JetBrains plugin over stdin/stdout), `packages/` (npm workspaces: `config-yaml`, `config-types`, `continue-sdk`, `fetch`, `hub`, `llm-info`, `openai-adapters`, **`terminal-security`**), `actions/`, `skills/`, `sync/`, `docs/`, `eval/`. Monorepo is npm workspaces.

**Fork-friendliness: medium.** Four inherited build pipelines (`core`, `binary`, `gui`, two IDE plugins). Clean separation = the lifts are extractable.

### 2. Provider abstraction (the dual-mode gap)

- Base: `core/llm/index.ts:91` — `abstract class BaseLLM implements ILLM`, 1529 lines, streaming via `AsyncGenerator` + `AbortSignal`, `_streamChat(messages, signal, options)` at line 1436.
- 70+ providers under `core/llm/llms/` (Anthropic, OpenAI, Gemini, Bedrock, Ollama, LMStudio, Mistral, Groq, …).
- Token counting: `core/llm/countTokens.ts` (`llamaTokenizer`/`tiktoken` worker pools).
- Cost: `core/llm/utils/calculateRequestCost.ts` — per-model price tables (e.g., `claude-sonnet-4-6: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }`).
- **All transports are HTTP.** `core/llm/llms/Anthropic.ts:446` calls `this.fetch(new URL("messages", this.apiBase), {...})`. Grep `child_process` under `core/llm/llms/` returns one hit: `Docker.ts` (spawns a container, then talks HTTP to it). Grep `"claude cli"` / `"claude-cli"`: **0 hits**.
- Usage aggregation consumes `interaction.end.usage` (`gui/src/hooks/useTotalUsage.ts:1-102`), populated from API response JSON — there is no path that parses cost/usage from a CLI process's stdout.

**Verdict for our dual-mode (API+CLI per provider): rewrite for cost/usage path, new subclass for transport.** The abstraction does not anticipate it. Adding a `claude --output-format=stream-json` transport requires: new `AnthropicCli` subclass (mediocre), CLI-stdout JSON parser for chunk → token events (medium), and a parallel cost path that doesn't lean on `interaction.end.usage` (hard — it's wired throughout the GUI). ~3-5 days, conservative.

**Fork-friendliness: medium for a parallel CLI transport; hard if we want dual-mode-per-provider to be a first-class plugin concept.**

### 3. Slash-command system (the 136-commands gap)

- Interface: `SlashCommand` / `SlashCommandWithSource` in `core/index.d.ts`.
- Source plugins: `built-in-legacy` (7 ship-default commands at `core/commands/slash/built-in-legacy/index.ts` — `DraftIssue, Share, GenerateTerminal, Http, CommitMessage, ReviewMessage, Onboard`), `json-custom-command`, `prompt-file` / `prompt-block`, `rule-block`, `mcp`. Architecture is correct shape (source-pluggable).
- Picker: `gui/src/components/mainInput/TipTapEditor/extensions/SlashCommand.ts` (57 lines) — TipTap `@tiptap/suggestion` + `tippy.js` popup. Filter in `gui/src/components/mainInput/TipTapEditor/utils/getSuggestion.ts::getSlashCommandDropdownOptions`: **prefix-only via `String.startsWith()`**.
- **No fuzzy search. No category grouping. No favorites.** UI built for ~10 items, not 136.

**Verdict:** registering 136 commands = trivial (source-plugin pattern is already there). Picking among 136 = medium-rewrite (`AtMentionDropdown` + filter logic). About 1-2 days. Lift the source-pluggable pattern, rewrite the picker UI.

### 4. Permission / safety gate (the win)

- `packages/terminal-security/src/evaluateTerminalCommandSecurity.ts` — **1241 lines**, real `shell-quote` tokenizer + defense-in-depth:
  - Deny-list: `sudo`, `su`, `doas`, `runas`, `gsudo`, `psexec` (lines 496–500).
  - Patterns: `rm -rf`, `/etc/sudoers`, dangerous env vars, pipe-to-`curl`/`wget` (lines 332–348), `find -exec/-execdir/-ok/-okdir/-delete` (line 1029).
  - Three-state `ToolPolicy` (`packages/terminal-security/src/types.ts`): `allowedWithPermission | allowedWithoutPermission | disabled`.
  - Multi-line: most-restrictive wins (lines 56–86).
  - Fail-safe: parse failure → `allowedWithPermission` (line 99).
- File-access gate: `core/tools/policies/fileAccess.ts` (26 lines) — outside-workspace → `allowedWithPermission`.

**This is real defense-in-depth, not a confirmation prompt.** Isolated `@continuedev/terminal-security` npm package = lift verbatim, extend deny-list with our Hard-Floor patterns (`git push origin (main|master|prod)*`, `git push --force*`, `DROP TABLE*`, `TRUNCATE*`, `--no-verify`, writes to `.git/**`, writes to `*.env*`).

**Fork-friendliness: easy modify. Strong lift candidate.**

### 5. Cost-tracking (math yes, UI no)

- Math: `calculateRequestCost.ts` + aggregation hook `gui/src/hooks/useTotalUsage.ts` → `{ totalPromptTokens, totalGeneratedTokens, totalThinkingTokens, totalCachedTokens, totalCacheWriteTokens, totalInteractions, totalCost, costBreakdowns }`.
- UI: cost lives in `gui/src/components/console/TotalUsage.tsx` (362 lines) — a separate **"Console" view** with stat cards + cumulative line chart. **No in-chat footer.** No per-day rollup found.

**Verdict:** lift the math and aggregation hook. Build a fresh in-chat-footer component (medium, 1 day). Build per-day rollup on top of the hook (small, half day).

### 6. Plugin architecture

**JetBrains:** Kotlin + JCEF (`JBCefBrowser`), `extensions/intellij/src/main/kotlin/.../browser/ContinueBrowser.kt:199` — `JBCefBrowser.createBuilder().setOffScreenRendering(true).build()`. JS↔Kotlin via `JBCefJSQuery`, `JS_QUERY_POOL_SIZE = 200`. **Not Compose. Not JavaFX.**

**Node sidecar:** `extensions/intellij/src/main/kotlin/.../continue/CoreMessenger.kt:97` spawns `ContinueBinaryProcess` (default) or `ContinueSocketProcess` (TCP, debug via `USE_TCP` env var). Wire format in `binary/src/IpcMessenger.ts` (293 lines): **newline-delimited JSON** with `{ messageId, messageType, data }`, streaming via `done: false/true` chunks. Sidecar built with esbuild + `pkg` into platform-native binaries shipped under `extensions/intellij/binary/bin/` via `build.gradle.kts`'s `from("../../binary/bin")`. SQLite, LanceDB, tree-sitter wasms bundled as native modules.

**JetBrains pinning:** `intellijIdeaCommunity(platformVersion)`, `sinceBuild = "241"`, verified IC 2024.1, 2024.2, 2024.3, 2025.1, 2025.2. Kotlin 2.1.0, JVM 17.

**VS Code:** standard `WebviewViewProvider` API (`extensions/vscode/src/ContinueGUIWebviewViewProvider.ts`). Same React `gui/` bundle.

**Verdict:** the architecture matches our plan (Kotlin host + Node sidecar + JCEF webview + shared GUI). Lifting the IPC contract + binary-packaging pipeline saves ≥2 weeks but couples us to their wire format. Inheriting the architecture but not the host code = fresh shell, lifted plumbing. **Strong lift candidate for the IPC + binary-build pipeline. Fresh write for the host (we own the slash-picker, cost footer, agent-config tree-walker, Hard-Floor gate).**

### 7. Maintenance burden of a fork

Snapshot via `gh api` 2026-05-28:

| Metric | Value |
|---|---:|
| Commits to `main` last 30 days | **0** |
| Commits to `main` last 90 days | 224 |
| Merged PRs last 30 days | **0** |
| Merged PRs last 90 days | 196 |
| Open PRs | 243 |
| Open issues (non-PR) | 569 |
| Issues opened last 30 days | 99 |
| Issues closed last 30 days | 21 |
| Contributors (total) | 393 |

**Yellow flags:** the 30-day-zero-on-main is unusual. Either a release-cadence freeze or work happening on long-lived branches. Open-PR (243) and open-issue (569) backlogs are high for a project this size.

90-day rate is healthy (196 PRs ≈ 2.2 merges/day). Rebasing a fork against that cadence is feasible but non-trivial — call it 4-8 hours/month of rebase work on average. The hidden cost is the GUI: `gui/` ships in every release, and every gui change touches our host's webview-state contract.

**Fork-friendliness: medium-to-hard.** Pulling upstream is technically feasible; the human cost (read every relevant PR before pulling, resolve conflicts in `gui/` + `core/protocol/`) is real and recurring. Solo-dev pacing makes this expensive.

### 8. License

**Apache-2.0** (`LICENSE` at repo root, confirmed via `gh api`). CLA required for upstream contributions (`CLA.md`) — irrelevant for forking. Commercial use, modification, private fork all permitted. NOTICE-file obligation minor.

**Fork-friendliness: easy.**

## Differentiator table

(Roadmap Phase 1 Step 2 — required rows)

| Our requirement | Continue ships it? | Modification effort | Maintenance burden of fork |
|---|---|---|---|
| Dual-mode (API+CLI) per provider | ❌ HTTP-only abstraction; no CLI transport in any of 70+ providers (`core/llm/llms/`) | **rewrite** — new subclass + CLI-stdout parser + parallel cost/usage path | medium — cost/usage path is wired throughout `gui/` |
| Cost-tracking on 4 levels (turn / conversation / day / month) | ⚠️ math + aggregation yes; UI is debug-console only, no per-day rollup | **medium** — lift math, build fresh footer + per-day rollup | low — math is stable, footer is local |
| agent-config tree-walker | ❌ no equivalent (Continue has `.continuerc`/`config.yaml` but no SKILL/RULE/COMMAND/PERSONA frontmatter tree) | **rewrite** — fresh subsystem | low — independent of upstream |
| Slash-command picker for 136 commands | ⚠️ source-pluggable architecture yes; picker prefix-only, no fuzzy/group/fav | **medium-rewrite** — replace `AtMentionDropdown` + filter | medium — every `gui/` upstream pull risks conflict |
| Hard-Floor permission gate | ✅ `@continuedev/terminal-security` (1241 lines, real gate) | **easy modify** — extend deny-list | low — package is standalone npm |
| Pre-flight cost estimate as range | ❌ no pre-flight estimate; cost is post-hoc only | **rewrite** — new module (input via `messages.countTokens()`, output projection deferred per MVP scope) | low — independent |
| Pricing book with Sigstore signature | ❌ hard-coded price tables in TS source | **rewrite** — fresh signed-artefact pipeline | low — independent |

**Score:** 4 rewrites · 2 mediums · 1 easy. Rewrites cluster on the differentiators that *define our product* (dual-mode, agent-config, pre-flight cost, signed pricing book) — Continue's shape is wrong for them, not just incomplete.

## Bolt-on prototype — NOT RUN (gap)

Roadmap Step 3 asks for a bolt-on prototype wiring 2 skills + 2 rules + 1 command from agent-config into Continue's slash-command system, time-boxed 2 days. This was **not executed** in this session — it requires ≥2 calendar days of single-developer time, including:

1. Clone Continue HEAD, run `task build` (or equivalent), verify it launches in IntelliJ Community 2024.2+.
2. Add a custom slash-command source plugin (likely under `core/commands/slash/`).
3. Write a YAML-frontmatter walker pointed at `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/`.
4. Inject 2 skills + 2 rules + 1 command into the picker, render their SKILL.md body in the chat input on selection.
5. Measure: files touched, lines changed, tests broken, "fighting the framework" vs "writing useful code" hours.

**Estimate from architecture read:** ~12-16 hours of work (a day and a half if uninterrupted). The picker rewrite is the long pole — the prefix filter and `AtMentionDropdown` need replacement before 5 commands look reasonable, never mind 136. Source-plugin registration is short (≤2 hours).

**Recommendation:** sign off on the Hybrid verdict on the strength of this evidence (architecture, line counts, file paths), OR allocate 2 calendar days before Sprint 1 for the bolt-on. The latter strengthens ADR-001 but does not change the structural conclusion: Continue's provider abstraction is single-transport, its picker is built for ~10 commands, and neither matches our plan.

## What we lift (in the Hybrid)

1. **`@continuedev/terminal-security`** — verbatim npm dependency, extend deny-list with our Hard-Floor patterns. Saves 2-3 weeks of building a real shell-tokenizer gate.
2. **Model-pricing tables** (`calculateRequestCost.ts`) — copy structure, our Pricing Book wraps them with Sigstore signing.
3. **JCEF + Node-sidecar wire format** (`IpcMessenger.ts` + `CoreMessenger.kt` shape) — adopt newline-delimited JSON over stdin/stdout, keep their packaging pipeline (esbuild + `pkg`) as the reference for our `binary/` build.
4. **Tree-sitter + LanceDB indexing** (`core/indexing/`) — lift as reference for our Context Engine v0/v1.

## What we build fresh

1. **Host plugin (Kotlin + JCEF + Compose where Compose-native makes sense).** Our own slash-picker, cost footer, agent-config browser, Hard-Floor gate.
2. **Provider abstraction with first-class dual-mode** (API + CLI per provider). Our `BaseProvider` has `apiTransport` and `cliTransport`, each implements `streamChat` / `countTokens` / `extractUsage` independently.
3. **agent-config tree-walker** — parses `.agent-src/`, surfaces skills + rules + commands + personas as in-IDE artifacts.
4. **Pre-flight cost estimate module** (input exact via `messages.countTokens`, output range from prior turns).
5. **Pricing book with Sigstore signature.**
6. **In-chat cost footer + per-day rollup UI.**

## Exit gate (Step 5)

- ✅ Differentiator table filled (above).
- ⚠️ User sign-off pending. ADR-001 (drafted in Phase 9) will reflect this verdict verbatim once the user either accepts the research-grade evidence OR runs the 2-day bolt-on.

## Risks / known unknowns

1. **Bolt-on prototype not measured.** Strongest evidence is research-grade. If the 2-day bolt-on reveals Continue's source-plugin pattern is friendlier than the architecture read suggests, the `medium-rewrite` for slash-picker could drop to `medium`.
2. **GUI conflict surface unmeasured.** A fork that imports `gui/` as a vendored copy will conflict on every upstream `gui/` pull. We have not estimated conflict cost empirically.
3. **Tree-sitter / LanceDB versions** — Continue pins them in `binary/`; if our Compose-Kotlin host picks different versions, we lose the "vendored binary" lift.
4. **30-day zero-commit on main** is an outlier. Re-check before signing ADR-001 in case it indicates a project pivot.

## Reproduction (for user-driven bolt-on)

```bash
# Phase 1 Step 1 — clone + build
git clone https://github.com/continuedev/continue.git
cd continue
# Continue uses npm workspaces + Taskfile/Makefile-ish scripts via root package.json.
# Read root README.md for current dev-setup commands (they change).
npm install
npm run build  # or whatever current docs say
# Open in IntelliJ Community 2024.2+, run `extensions/intellij` as plugin sandbox.

# Phase 1 Step 3 — bolt-on
# Add a custom SlashCommand source under core/commands/slash/.
# Walk ~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/{skills,rules,commands}/
# parse YAML frontmatter (use a library — Continue likely has one in core/util/).
# Register 5 commands (2 skills + 2 rules + 1 command) with the slash-picker via the source.
# Time-box 2 days. If picker UX collapses at 5 items, the verdict locks Hybrid.
```

## Decision

Pending user sign-off. Default recommendation: **Hybrid** — new-build host, selective lifts as listed.
