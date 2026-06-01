---
complexity: heavy
---

# Roadmap: Product Readiness — Trustworthy, Installable, Daily-Driver

> **Goal.** Turn the working vertical slice into a product an event4u dev
> installs and trusts daily: every agent action goes through a clear
> approval/diff surface, cost and index state are always visible, agent intent
> is explicit (Ask / Edit / Plan / Review / Commit / Explain), context scope is
> user-controllable per turn, the plugin ships as a real installable artifact
> with an onboarding wizard, and the git loop (commit message, PR description,
> change summary) is built in.
>
> **Why it's a separate roadmap.** This is breadth on top of a proven spine.
> It must **not** start before `road-to-vertical-slice.md` clears — every
> feature here assumes the chat → send → stream → stop → cost path works in
> both IDEs. The engine substrate for each feature already exists
> (`permissions/`, `cost/`, `context/`, `agent/loop.ts`, `review/`); the work
> is surfacing it. Almost all of it is **IDE-runtime-/human-gated** (webviews,
> packaging, extension-host smoke tests) — executed by a human at an IDE.
>
> **Source.** Authored 2026-05-31 from the user's 12-point feedback. Item map:
> P1 = #2/#3/#5 · P2 = #5/#6/#7/#8/#9 · P3 = #4/#11/#10 · P4 = #12.

## Context

- **Gates.** `minimal-safe-diff`, `scope-control` (reuse the shipped engine
  modules — no new permission/cost/index framework), `security-sensitive-stop`
  (the permission + git surfaces gate real actions — threat-model before
  wiring), `verify-before-complete` (IDE steps need a captured manual smoke run).
- **Hard dependency.** `road-to-vertical-slice.md` complete (the working
  request path both features build on).
- **Engine substrate (already shipped, to be surfaced).**
  - Permission model — `packages/core/src/permissions/` + ADR-004 (threat model, hard-floor deny-list, audit trail).
  - Cost — `packages/core/src/cost/` (`estimate.ts`, `reconcile.ts`, `shadow.ts`).
  - Index / context — `packages/core/src/context/` (walker, BM25, embeddings, per-root status from `road-to-multi-project`).
  - Agent loop + directive sets — `packages/core/src/agent/loop.ts` (`refine → plan → implement → verify`).
  - Review / git — `packages/core/src/review/` + the `code-review` engine work.
- **Shared-UI decision.** Both clients render **per-client** (VS Code webview
  `chat-app.ts` / JetBrains Swing + JCEF), not through a shared Preact bundle.
  The `packages/shared/ui/` assumption in `road-to-v1-0` Phases 7/12/13 +
  `road-to-multi-project` Phase C is **superseded** — revisit only if
  cross-client divergence becomes costly.
- **`road-to-v1-0` `[~]` discharge map.** Surfacing a task here flips the
  matching v1-0 IDE-runtime gate: T-PRD03 → T-904/906/907/908 (terminal);
  T-PRD05 → T-704 (inline scope editor); T-PRD06 → T-707 (cost dashboard);
  T-PRD07 → T-1304 (index statusbar); T-PRD08 → directive-set modes;
  T-PRD09 → T-1308 (context sidebar) + `ContextScope`. **Still deferred**
  (not in scope here): session browser UI (T-1201/1203/1205), slash/command
  picker (T-1103), guidelines editor (T-1307), conversation sidebar/fork/rewind
  (T-1301-1303), pricing verify-on-load.
- **Non-goals.** Inline-autocomplete, repo-aware refactor skills, web tool,
  team/cloud backend — these are v1.5+ candidates, each its own roadmap.

---

## Phase 1 — Surface wiring: tool-approval + diff review (both IDEs)

> **Goal.** Agent tool-calls render as action cards the user approves; multi-file edits show a reviewable diff before they apply.

- [~] **T-PRD01 — tool-call action cards.** <!-- core half DONE 2026-05-31 (feat/product-readiness-surface-wiring, ADR-013): protocol `ToolCallEvent` union (started/approvalRequested/approvalResolved/result/error) + `packages/core/src/agent/approval.ts` `runToolCallWithApproval` — injected-`decide` + `exec`, `AbortSignal` cancel, hard-floor→error, `always`→`gate.grantAlways`, deterministic error on a failed decision. 15 unit tests. AI council (codex-cli 0.134.0 + gemini 0.41.2) UNANIMOUS. Card RENDER (VS Code webview + JetBrains Swing) + the agent-turn transport that emits these stay IDE-runtime → `[~]`. --> When the agent loop emits a tool-call (run-shell, write-files, …), both clients render an action card with the call summary and an approve/deny control wired through `permissions/`.
- [~] **T-PRD02 — multi-file diff review.** <!-- core half DONE 2026-05-31 (ADR-013): protocol `ToolReview` { kind:'diff', files:[{path,diff,isNewFile}] } + `packages/core/src/tools/review.ts` `planToReview` mapping a `WriteFilesPlan` to the approval-card diff payload (resolved files only); rides inside `approvalRequested.review`. 3 unit tests. The diff-card RENDER + accept/reject wiring stay IDE-runtime → `[~]`. Atomic rollback already shipped in `WriteFilesTool.apply`. --> `tools/write-files.ts` (atomic multi-file) output renders as a per-file diff the user accepts/rejects before write; rejection rolls back atomically.
- [~] **T-PRD03 — terminal card render.** <!-- handler/transport half DONE 2026-06-04 (feat/product-readiness-terminal-handlers, ADR-029): the Phase-9 terminal core (`TerminalSessionManager`, `Terminal`+`FakeTerminal`, ring buffer, waiting-for-input) and the `terminalSubscribe`/`terminalInput`/`terminalResize` protocol methods + Kotlin DTOs were ALL shipped but had ZERO dispatcher callers (the sidecar answered them with `handler_error`). New `packages/core/src/terminal/handler.ts` `TerminalHandler` (mirror of ChatHandler/GitHandler) wires all three to an injected `TerminalSessionManager`, registered in `server.ts` Dispatcher (terminalSubscribe streaming via the chatSend `emit` pattern; input/resize plain RPC) + `buildCoreDispatcher`; `Dispatcher.dispose()` releases sessions. AI council (codex-cli + gemini) UNANIMOUS A1(exit is the terminal done:true, no new wire payload)/B1(resolve-on-exit, synthesise already-done exit)/C1(replay response first, synchronously)/D1(unknown commandId → `terminal_no_session`)/E(spawn out of scope)/F(dispose releases sessions)/G(streaming vs plain split). 16 new tests, core 964/1 skip; codegen idempotent (NO protocol change); `task jetbrains:check` green. The xterm.js RENDER in both IDEs + the spawn path that POPULATES the manager (a future `run_shell` agent tool) + the real env-gated `node-pty` factory (T-901) stay native-/IDE-gated → `[~]`. --> Wire the shipped `terminal/` core (ring-buffer replay, waiting-for-input, first-write-wins) to xterm.js in both surfaces — completes `road-to-v1-0` T-904/906/907/908.
- [~] **T-PRD04 — streamed event union → client renderers.** <!-- core half DONE 2026-05-31 (ADR-013): `scripts/codegen.ts` gained a narrow sealed-union emitter (`@Serializable @JsonClassDiscriminator("kind")` sealed interface + per-`kind` `@SerialName` data class); regenerated `Protocol.kt` now carries the Kotlin sealed classes for BOTH `TerminalEvent` (the class deferred from ADR-009) and `ToolCallEvent`. Compiles + ktlint/detekt green via `task jetbrains:check`. The TS render switch + Swing `when` stay IDE-runtime → `[~]`. --> The `TerminalEvent` / chat event unions get the Kotlin sealed-class + TS render switch (deferred from ADR-009).

### Exit gate — Phase 1

- [ ] A multi-step agent turn that runs a command and edits 2+ files renders: approval card → live terminal card → diff review → applied — in both IDEs. Captured in `docs/MANUAL_VERIFICATION.md`. <!-- engine DONE 2026-06-01 (feat/product-readiness-agent-turn, ADR-023): protocol `agentTurn` method + `packages/core/src/agent/turn-handler.ts` `AgentTurnHandler` (bounded LLM↔tool loop) + `agent/tool-registry.ts` (injectable read+write tools, prepare/execute split) wired into `buildCoreDispatcher`. Streams `ChatTokenEvent` + `ToolCallEvent`, executes approved calls via `runToolCallWithApproval`, feeds results (incl. denials) back, maxIterations cap, cancel via `chatCancel`. 14 unit tests, core 903 pass. AI council (codex-cli 0.134.0 + gemini 0.41.2) UNANIMOUS forks 1A/2A/3A/4A/5A/6A/7A/8A. The cards RENDER + the inbound approval round-trip that drives `decide` (default-denies until wired) stay IDE-runtime → exit gate stays `[ ]`. -->

**Baseline (P50):** 2.5 weeks.

---

## Phase 2 — Trust & Control UX

> **Goal.** The user always sees what it costs, what is indexed, what mode the agent is in, and what context a turn uses — and can change each.

- [~] **T-PRD05 — permission cards, full (#5).** <!-- core half DONE 2026-05-31 (feat/product-readiness-trust-control, ADR-014): `permissions/audit.ts` AuditLog — append-only date-rotated JSONL audit trail (grant_once/grant_always/deny_user/deny_hard_floor, fail-open, torn-line tolerant), wired into `runToolCallWithApproval` via an optional injected `audit` recorder (records decisions + hard-floor blocks, NOT auto-allows); `classifyRisk(level)` → low|medium|high derived risk badge (never persisted, UI hint not a boundary). 11 unit tests. AI council UNANIMOUS (separate log over permissions.json bloat). Card RENDER + audit-trail link UI stay IDE-runtime → `[~]`. --> Diff preview, risk-level badge (from the hard-floor classifier), `allow once / allow always / deny`, and a link to the audit-trail entry. Always-rules persist per workspace.
- [~] **T-PRD06 — cost UX, full (#6).** <!-- core half DONE 2026-05-31 (ADR-014): `cost/budget.ts` DailyBudgetTracker — date-rotated JSONL spend log, injectable clock+dir, `record(usd)→BudgetStatus{spent,remaining,ratio,overBudget,warning}`, warn at spent/limit ≥ threshold (default 0.8), no-budget tracks-but-never-breaches, survives restart; `cost` settings key (daily_budget_usd?, warning_threshold_ratio). Pre-send estimate (`estimate.ts`) + reconcile (`reconcile.ts`) already shipped. 9 unit tests. HANDLER WIRING now DONE 2026-06-01 (ADR-022): `chat/handler.ts` emits a pre-send `ChatEstimate` as an early `done:false` envelope (B1), records each real-cost turn's actual spend via an injected `BudgetRecorder` (B-inj), and surfaces `ChatBudgetStatus` (incl. soft overBudget/warning flags, B-warn) on the terminal response; CLI-shadow + unpriced turns read status without debiting, errored turns never debit, recorder failure is fail-open. Protocol: `ChatEstimate`/`ChatEstimateEvent`/`ChatBudgetStatus` + optional `ChatSendResponse.budget` + Kotlin DTOs. 14 new tests (core 889/1 skip, protocol 39). Only the composer footer RENDER (pre-send/live/final cost + budget bar) stays IDE-runtime/deferred → `[~]`. --> Pre-send estimate (`±` range) before the prompt fires; live counter during; reconciled final after (`cost/reconcile.ts`); a configurable **daily budget** with a soft warning on approach.
- [ ] **T-PRD07 — index statusbar (#7).** Statusbar widget: `Indexing 428 / 1200 files…` / `Index ready · N files · last update …`; per-root error surfacing; a Reindex action. Consumes the `rootStatus` protocol method. <!-- ZERO core change — `rootStatus` method + `RootIndexStatus` + `WorkspaceCoordinator.status()` already shipped (multi-project Phase B). Pure IDE statusbar widget → stays `[ ]`. -->
- [~] **T-PRD08 — agent modes (#8).** <!-- core half DONE 2026-05-31 (ADR-014): `agent/modes.ts` standalone — AgentMode (ask/edit/plan/review/commit/explain) → DirectiveSet { phases:AgentPhase[], mutates, label }; MODE_DIRECTIVES map + resolveMode + phaseRunsInMode; only `edit` mutates, read-only modes stop before `implement`. AgentDriver left UNTOUCHED (council Option 1, minimal-safe-diff) — consumes a DirectiveSet later. 11 unit tests exhaustive vs AgentPhase. Mode selector UI + the driver wiring stay IDE/later → `[~]`. AGENT-TURN ENFORCEMENT HALF DONE 2026-06-03 (ADR-028): `mode` wired onto `AgentTurnRequest`/`AgentTurnResponse` (protocol now owns `AgentModeSchema`, fork A1); `AgentTurnHandler` resolves the directive once before the loop and enforces `mutates:false` two ways (fork B3) — advertise-filter (read-only modes never see `write_files`) + a runtime backstop (`runOneTool` refuses a `tool.mutates` call before prepare/exec so a stale call writes nothing); `RegisteredTool.mutates` metadata + `definitions({mutating})` filter (fork C1, no hard-coded tool name); resolved mode surfaced on the response (fork D1); default `edit` (fork E1); unknown modes REJECTED not coerced (coercing unknown→edit would grant writes). 6 new tests (4 turn-handler + 2 registry), core 948/1 skip. Mode selector UI (composer) + the phase-based AgentDriver gating (consumes `DirectiveSet.phases`, unused by the iteration-based turn) stay IDE/driver → STILL `[~]`. --> Explicit mode selector — `Ask` / `Edit` / `Plan` / `Review` / `Commit` / `Explain selection` — each mapping to a directive set on `agent/loop.ts`; the mode is visible in the composer.
- [~] **T-PRD09 — per-turn context chips (#9).** <!-- core half DONE 2026-05-31 (ADR-014): `scripts/codegen.ts` gained `object`-variant support for payload-less union members; ContextScope (all/roots/none) now codegen'd as a Kotlin sealed interface (`object ContextScopeAll/None` + `data class ContextScopeRoots`) and `ChatSendRequest.scope: ContextScope? = null` added — DTO parity with the TS protocol. Compiles + ktlint/detekt green. The chips UI + actually honouring `scope` in a turn (context injection) stay deferred to Phase C → `[~]`. CONTEXT-INJECTION HALF DONE 2026-06-01 (ADR-025): the chat turn now honours `scope` — resolves it to rootIds, retrieves scoped snippets, folds them into the system prompt, and returns them on ChatSendResponse.annotations. Only the composer CHIPS render stays IDE → still `[~]`. --> Composer chips: `current root` / `all roots` / `no codebase` / `specific files`, emitting the `ContextScope` discriminated union the protocol already carries.
- [~] **T-PRD17 — provider/model selector, incl. OpenAI.** <!-- late addition 2026-05-31: feedback — the OpenAI backend exists in core (`llm/`) but the VS Code config only offers Anthropic. core half DONE 2026-05-31 (PR for feat/product-readiness-provider-core): `ProviderRegistry` (resolveBackend/resolveModel over all 5 backends, eager build + isolated config errors, env default `EVENT4U_DEFAULT_PROVIDER`, throw `provider_not_configured`, env model override) + `buildCoreDispatcher` wired into `main.ts` so the real sidecar answers `chatSend` instead of `chat_not_configured`. ADR-011. Client provider/model selector UI (settings, both IDEs) stays IDE-runtime → `[~]`. --> Client settings expose a provider + model selector across Anthropic / OpenAI / CLI backends; the choice flows into the `chatSend` `providerId` the vertical slice already carries. Both IDEs.

### Exit gate — Phase 2

- [ ] A user can: see a pre-send estimate, watch live cost, hit a daily-budget warning; read the index status + reindex; switch agent mode; scope a turn to specific files — in both IDEs.

**Baseline (P50):** 3 weeks.

---

## Phase 3 — Distribution & onboarding

> **Goal.** Someone can install the plugin from an artifact and be productive without reading the source.

- [x] **T-PRD10 — VSIX packaging (#4).** <!-- DONE 2026-05-31 (feat/product-readiness-distribution, ADR-017): `clients/vscode/scripts/bundle-sidecar.mjs` copies `packages/core/dist/server.js` (+ root LICENSE) into `clients/vscode/sidecar/`; `resolveSidecarPath` already prefers `sidecar/server.js`. Spawn fixed to set `ELECTRON_RUN_AS_NODE=1` so the bundled sidecar runs on VS Code's own Node in a packaged `.vsix` (AI council Fork 1A) — a real packaged-extension bug (`process.execPath` would launch a window). `pnpm run package` (build → bundle → `vsce package --no-dependencies`) emits `event4u-agent.vsix` (verified: contains `extension/sidecar/server.js`, 9 files). Added `.vscodeignore`, README, CHANGELOG, `repository`, `@vscode/vsce` devDep, version 0.1.0. New CI `package` job asserts the bundled sidecar. The clean-machine *install/run* smoke is the Phase-3 exit gate (human-gated). --> Build a real `.vsix` with the Node core bundled (no dev-path assumption); the sidecar resolves from the bundled location.
- [x] **T-PRD11 — JetBrains plugin ZIP (#4).** <!-- DONE 2026-05-31 (ADR-017): `prepareSandbox` `from(...).into(pluginName.map { "$it/sidecar" })` bundles `server.js` into the plugin dist; `./gradlew buildPlugin` ZIP verified to contain `event4u-agent-jetbrains/sidecar/server.js`. Pure JUnit-tested `SidecarPathResolver` (bundled → dev fallback) + IDE glue `SidecarLocator` (`PluginDescriptor.pluginPath`); both spawn sites (`SidecarChatController`, `WorkspaceFolderService`) rewired. System `node` on PATH (AI council Fork 4A; README states the Node ≥ 20 requirement). The directory-form `from` is tolerant of a missing core build so the existing `check` job stays green. CI `package` job asserts the bundled sidecar. Clean-sandbox *load* smoke is the Phase-3 exit gate (human-gated). --> `buildPlugin` ZIP with the bundled core; verified to load in a clean sandbox without the repo checkout.
- [~] **T-PRD12 — onboarding wizard (#11).** <!-- core DETECTION seam DONE 2026-05-31 (ADR-017, AI council Fork 5B measured): `packages/core/src/onboarding/detect.ts` — `detectReadiness(probes)` derives a `ReadinessReport` (Node ≥ 20, Anthropic key present, Claude CLI on PATH, recommended mode api>cli>none, ordered blockers) from INJECTED probes, pure + 9 unit tests. This is the shared core backing the JetBrains "Node ≥ 20 required" path + the mitigation both reviewers asked for against Node-runtime asymmetry. The first-run wizard UI, the model/budget pickers, and the live test-ping that proves the round-trip stay IDE-runtime → `[~]`. --> First-run flow: detect API key / Claude CLI, pick a model, set a budget, run a test ping that proves the round-trip. Reuses the existing `agent-config` onboarding contract where it overlaps.
- [ ] **T-PRD13 — IDE extension-host smoke tests (#10).** Automated smoke tests against a real VS Code Extension Host and a JetBrains test IDE — open chat, send a canned prompt against a fake provider, assert a streamed answer. Wired into CI where the runner supports it; reference-only where it cannot. <!-- IDE-runtime: needs a real VS Code Extension Host (@vscode/test-electron + xvfb) + a JetBrains test IDE runner; not a pure-core seam → stays `[ ]`. -->


### Exit gate — Phase 3

- [ ] A clean machine installs the VSIX / JetBrains ZIP, runs the wizard, sends a test ping, and gets a streamed answer — no repo checkout. Smoke tests run (or are documented reference-only per platform).

**Baseline (P50):** 2.5 weeks.

---

## Phase 4 — Git workflow integration

> **Goal.** The agent helps close the loop: commit message, PR description, review mode, change summary.

- [~] **T-PRD14 — commit-message suggestion (#12).** <!-- core half DONE 2026-05-31 (feat/product-readiness-git-loop, ADR-015): `git/commit-message.ts` — `buildCommitMessagePrompt(changes,opts)` renders the staged diff via the shipped `renderNumberedHunks` into a Conventional-Commit turn; `parseCommitMessage(raw)` validates the model reply (type set, ≤72 header, emoji-free subject, `!`/`BREAKING CHANGE:`→breaking) and FAILS HARD with structured errors so the caller re-prompts — no path/ratio heuristic (AI council fork B, UNANIMOUS). 12 unit tests. Core never commits. TRANSPORT DONE 2026-05-31 (feat/product-readiness-git-transport, ADR-016): protocol `gitCommitMessage` (full-turn, single sanitised envelope) + `GitHandler.commitMessage` — reads the staged diff, runs the provider, parses, RE-PROMPTS bounded (default 2 attempts) on a parse failure, returns `{ok,message,text,errors,attempts}`; Kotlin DTOs codegen'd. AI council (codex-cli 0.134.0 + gemini 0.41.2) UNANIMOUS forks A1/B1/C1/D1/F1. Card RENDER (compose/edit/accept) stays IDE-runtime → `[~]`. --> From the staged/working diff, propose a Conventional-Commit message; the user edits/accepts. Never commits autonomously (respects `commit-policy`).
- [~] **T-PRD15 — PR description draft (#12).** <!-- core half DONE 2026-05-31 (ADR-015): `git/pr-description.ts` — `readCommitLog` (BOUNDED: newest-30, per-body cap, `truncated` flag) + `buildPrDescriptionPrompt(changes,log,opts)` (diff + commit log → PR-body turn) + `sanitizePrBody`/`sanitizePrTitle` deterministic STRIP sanitisers (drop AI-attribution lines + decorative emoji, keep functional ❌✅⚠️ in bodies, titles emoji-free) returning `{body/title,warnings}` — house rules enforced in core, not trusted to the model (AI council fork C, UNANIMOUS). Shared helpers in `git/text-rules.ts`. 10+8 unit tests. TRANSPORT DONE 2026-05-31 (ADR-016): protocol `gitPrDescription` + `GitHandler.prDescription` — reads the `base..head` diff + commit log, runs the provider, sanitises body + a title candidate (derived from the newest commit subject, no extra LLM call), returns `{title,body,warnings,commitCount,truncated}`; Kotlin DTOs codegen'd. The card RENDER + warning surfacing stay IDE-runtime → `[~]`. --> Generate a PR body from the branch diff + commit log; no attribution footer, no decorative emoji (house rules).
- [~] **T-PRD16 — review mode + change summary (#12).** <!-- core half DONE 2026-05-31 (ADR-015): `git/review-summary.ts` — `summarizeReview(result,changes)` folds an existing `RunReviewResult` (`review/run.ts`) + source `FileChange[]` into a `ChangeSummary` {filesChanged, additions/deletions, exhaustive per-severity counts, top-N findings, potentialFindings} by PURE DERIVATION — no extra LLM call (AI council fork D, UNANIMOUS). The `review` agent mode already exists (`agent/modes.ts`). 4 unit tests. TRANSPORT DONE 2026-05-31 (ADR-016): protocol `gitReviewSummary` + `GitHandler.reviewSummary` — runs `runReview` internally over the selected diff (fork E1), folds via `summarizeReview`, returns a wire `ChangeSummary` with an exhaustive `findingsBySeverity[]` + a MINIMAL `topFindings[]` (`{file,line,severity,category,description}` — no votes/confidence leak); Kotlin DTOs codegen'd. The change-summary + findings CARD render stays IDE-runtime → `[~]`. --> The `Review` agent mode runs the `review/` engine over the current diff and renders a change summary + findings as cards.

### Exit gate — Phase 4

- [ ] From a working branch: get a commit-message suggestion, a PR-description draft, and a review summary — all surfaced as editable cards, none executing a git action without explicit user confirmation.

**Baseline (P50):** 2 weeks.

---

## Acceptance criteria — product readiness

- [ ] Every agent action (tool-call, multi-file edit, terminal, git) is surfaced through an approval/diff/summary card before it takes effect.
- [ ] Cost (pre-send estimate, live, final, daily budget) and index status are always visible.
- [ ] Agent mode and per-turn context scope are explicit and user-controllable.
- [ ] The plugin installs from a VSIX / JetBrains ZIP with an onboarding wizard, no repo checkout.
- [ ] Extension-host smoke tests cover the core path (or are documented reference-only per platform).
- [ ] The git loop (commit / PR / review) is built in and never acts without confirmation.
