---
complexity: heavy
---

# Roadmap: v1.0 — Internal alpha, dogfood it

> **Time-box:** 27 weeks sprint-work + Sprint 15 buffer (2-3 weeks) = 29-30 calendar weeks ≈ 6.5-7.5 months after MVP demo.
>
> **Goal at end of Sprint 15.** Plugin is dogfood-ready for the event4u team daily, with all of: multi-step agent loop, multi-file edit, Context Engine v1 (retrieval works), live PTY terminal, native IDE depth (Cmd+I, intention actions, right-click), per-CLI gear panel, unified session browser, MCP client, persisted history, Cost Dashboard, Pricing-Book Sigstore signature, telemetry opt-in, full docs. Marketplace-ready (private/public per ADR-002).
>
> **Source:** distilled from `agents/analysis/PLAN.md` §7.2 + §17 Phase 2 + 2026-05-28 AI Council review. Council top-10 findings #7 (Context Engine deferred too late) and #8 (sprint sequencing) drove the Context-Engine-up reorder — was Sprints 11-12, now Sprints 6 + 8.

## Context

- **Gates.** `minimal-safe-diff`, `scope-control`, `verify-before-complete`, `no-pr-progress-comments`. Sprint exits become commit/release decision points; the user authorises per Sprint, never standing.
- **Council-driven reorder vs original PLAN.md §17 Phase 2:**
  - **Context Engine moved from Sprints 11-12 to Sprints 6 + 8** (council finding #7 + #8 — retrieval is highest-leverage post-MVP feature; without it the agent flies blind, agent-config Skills/Rules never get matched into context).
  - **Live PTY Terminal moved from Sprint 8 to Sprint 9** (after Context Engine).
  - **Native IDE Depth (SweepAI-style) moved from Sprint 9 to Sprint 10** (after PTY because intention-actions trigger shell commands; shell commands need PTY).
  - **Per-CLI gear panel + Session Browser stay together but moved from Sprint 10 to Sprint 12** (after MCP / agent-config full coverage — gear panel is polish, not foundation).
- **Council-driven content changes vs original:**
  - **Pre-flight Cost Estimate (Sprint 7)** keeps Range UI per PLAN.md §14.3 but adds explicit "reconciliation logging" — every real cost is compared to estimate; >50% drift over upper-bound logs a Calibration-Event for heuristic improvement. (Plan already had this; surfaced here as Sprint 7 explicit task.)
  - **Sprint 14** keeps Pricing-Book Sigstore signature (host-rejected council expansion to staleness/rotation; recorded in `road-to-mvp.md` Notes). Sprint 14 adds a `pricing-book-version` audit-trace in step-events (was T-408 in MVP; v1.0 surfaces this in Cost Dashboard).
- **Sprint estimates use P50 + worst-case-cut.** Per council round-2 finding ("v1.0 sprint estimates lack confidence intervals"). Each sprint below lists `Baseline (P50)`, `If blocked, cut to:` (the minimum-viable subset that lets the next sprint start), and explicit dependencies on prior sprints.

---

## Phase 5 — Catch-up: missing providers + capability manifests (2-3 weeks)

> **Goal.** Multi-provider support that was cut from MVP. OpenAI API + Codex CLI + Gemini CLI all land here. Capability manifests stabilise; CLI detection covers all three.
>
> **Dependencies.** MVP Sprint 4 done. Phase 0 Spike 0.3c verdict applied (if CLI-pipe spike failed, this sprint is API-only and Sprint 12 absorbs all CLI work).

- [ ] **T-501 — OpenAI API Backend with streaming.** `packages/core/src/llm/openai-api.ts` using the OpenAI SDK. Capture full `usage` including `reasoning_tokens` for o-series models. Tool-calling normalization: extend `normalizer.ts` to map OpenAI tool-use blocks to the canonical `NormalizedToolCall`.
- [ ] **T-502 — Codex CLI backend.** Analogous to T-406 from MVP but for `codex exec --json`. Parser walks the newline-delimited JSON event stream. Session-id preserved. Stdin via piped prompt.
- [ ] **T-503 — Gemini CLI backend.** Analogous for `gemini --output-format json` with prompt piped on stdin. OAuth consent must be granted once interactively; surface this in the CLI-detection result with a "click here to authorise" link.
- [ ] **T-504 — CLI-detection extended.** Service from T-405 (MVP) now scans for `claude` + `codex` + `gemini`. Each carries a version range + auth probe + capability-manifest reference. Result feeds the Mode toggle (T-407, MVP) per provider.
- [ ] **T-505 — Capability manifests for all 3 CLIs.** `packages/core/src/llm/cli/manifests/{claude,codex,gemini}.ts` per PLAN.md §9.11.2. Each declares: abort method, auto-modes, slash-commands, model-switch, permission-modes, verbosity, session-files. Verified against the latest stable version of each CLI as of Sprint 5 start; comment header records date + version.
- [ ] **T-506 — OpenAI-compatible HTTP backend.** `packages/core/src/llm/openai-compat.ts` for Mistral / Together / Groq / OpenRouter. Reads endpoint config from `.agent-settings.yml::llm.providers[].base_url` + auth header. Pricing comes from `prices.yml::custom_endpoints` (user-provided).
- [ ] **T-507 — Multi-provider Cost-Dashboard fixture data.** Insert synthetic step events spanning all 4 providers × API+CLI modes into `tracking.db` for use as fixture by Sprint 7's Cost Dashboard.

**Baseline (P50):** 2 weeks. **If blocked (e.g., Gemini OAuth flow fights you):** Cut T-503 (Gemini) to Sprint 12, ship T-501 + T-502 + T-505 (Claude + Codex manifests) at minimum. T-506 (OpenAI-compat) is independent and can slip.

### Exit gate — Phase 5 exit criteria

- [ ] User in chat picks any of: Anthropic API · Anthropic CLI · OpenAI API · Codex CLI · Gemini CLI · OpenAI-compat URL — works end-to-end.
- [ ] CLI-detection panel in settings shows all detected CLIs with version + signed-in status.
- [ ] Capability manifests committed and linked from §9.11.

---

## Phase 6 — Context Engine v0: Tree-sitter + BM25 (3 weeks, moved up)

> **Goal.** Per-user-turn retrieval of relevant code snippets. Replaces the MVP's naive "open editors + selection" with a real indexer. Without this sprint, the plugin's agent-config value evaporates: skills + rules never get matched into context unless the right file is open in the editor.
>
> **Council finding #7 (consensus):** Context Engine deferral to Sprint 11-12 harms usability. Reviewer A: "Without retrieval, agent-config's curated knowledge is inaccessible when it's not in the active viewport."
> **Council finding #8 (consensus):** Sprint sequencing puts less-valuable items (PTY, IDE depth) before retrieval, the highest-leverage post-MVP feature.
>
> **Dependencies.** MVP Sprint 4. Pricing Book has Anthropic cache_control wired (MVP T-404) so Context-block injection stays cache-friendly.

- [ ] **T-601 — Workspace walker.** `packages/core/src/context/walker.ts` walks the project root with chokidar, respecting `.gitignore`, `.augmentignore`, and a built-in skip-list (`node_modules`, `dist`, `out`, `vendor`, `.git`, build outputs). Emits a stream of file paths to the symbol indexer.
- [ ] **T-602 — Tree-sitter symbol indexer.** `web-tree-sitter` WASM bindings + grammars for TS / JS / PHP / Kotlin / Go / Python / Rust / YAML / Markdown. Parse each source file, extract top-level symbols (classes / functions / methods / interfaces / types) with file path + line range. Store in `sqlite-fts5` table `symbols` for fast text-search.
- [ ] **T-603 — BM25 retriever.** `packages/core/src/context/bm25.ts` builds an inverted index over symbol names + path tokens (split on `/` and camelCase + snake_case). Query API: `retrieve(query: string, k: number): SymbolMatch[]`. Path-token boosting (e.g., a query with "auth" boosts files under `src/auth/**`).
- [ ] **T-604 — Incremental re-index.** On file save (chokidar event, debounced 2s): re-parse + update symbols + refresh BM25 partial index. Test: edit a file with 500 functions, re-index completes <200ms.
- [ ] **T-605 — Context-block injection into prompts.** `packages/core/src/context/inject.ts` runs per-turn: query = user message + agent-config command name (if any). Retrieve top-K symbols, fetch their surrounding range (±20 lines), add as `[Context: top-10 snippets from codebase]` block in the user message. Token budget: 20% of model context window (Claude Sonnet 4.6 = 200k → 40k for context).
- [ ] **T-606 — Cache-friendly placement.** Context block goes before user message but after the static rule-injection (which has cache_control). Verifies that cache_creation_tokens stay low on repeated turns of the same conversation (rule block is cached; context block changes per turn — that's fine).
- [ ] **T-607 — Skill-aware boost.** If the active turn invokes a `/skill <name>` command, BM25 query gets boosted by terms from that skill's `description` field. Foundation for advanced v1.0 retrieval (skill `api-design` invokes → controllers + routes boosted).

**Baseline (P50):** 3 weeks. **If blocked (e.g., tree-sitter WASM toolchain fights you):** Drop T-607 (skill-aware boost — needs T-602 stable anyway) to Sprint 13. Ship T-601 to T-606 as MVP-of-retrieval.

### Exit gate — Phase 6 exit criteria

- [ ] First-time index of a 20k-file Laravel repo completes <5 min on a 2024 MacBook Pro.
- [ ] User asks "Where is the user-registration code?" — agent gets relevant Controller + FormRequest + Tests injected without those files being open in the editor.
- [ ] Single-file save updates the BM25 index <500ms.

---

## Phase 7 — Multi-step agent loop + Multi-file edit + Action-card polish (3 weeks)

> **Goal.** Full agent loop with phases (refine → plan → implement → verify) per PLAN.md §8.1. Multi-file edits with bulk permission card. All action-card badges (diff-stats, numeric counter, status-dot) shipped. Pre-flight cost estimate with Range UI. Cost Dashboard tab visible.

- [ ] **T-701 — Agent loop state machine.** `packages/core/src/agent/loop.ts` implements `refine → plan → implement → verify → report` phases. State persisted to `.work-state.json` per agent-config convention. Halt-protocol emits `{phase, question, options}` between phases for user steering.
- [ ] **T-702 — Multi-file edit.** Tool `write_files(edits: FileEdit[])` accepts a batch. Plugin shows a Bulk-Permission-Card per PLAN.md §8.8.11 bulk variant — list all files, per-file diff preview, bulk Apply / per-file approval / cancel. Atomic rollback: if any file fails to write (permission error, disk full), all previously-written files revert.
- [ ] **T-703 — Full action-card UI.** Implement all card types from PLAN.md §8.8.1 with all three badge slots (Diff-Stats, Numeric Counter, Status-Dot). Cards: Thought / Terminal (still naive-pipe — PTY is Sprint 9) / Read File / Glob-Search / Created/Edited/Deleted File / Skill Invocation / MCP Tool Call / Web Fetch / Permission Request / Halt / Cost Footer / Correction.
- [ ] **T-704 — Inline-editable permission scope.** Permission-card from MVP T-304 gains the inline scope-editor per PLAN.md §8.8.11. Fields: pattern (glob-editable), working-dir, time-scope dropdown, args-allowlist. Allow/Always/Deny buttons read the (possibly-edited) scope before persisting.
- [ ] **T-705 — Pre-flight cost estimate.** `packages/core/src/cost/estimate.ts` produces a Range estimate per PLAN.md §14.3: lower-bound (min-output + cache-hit), upper-bound (max-output + cache-miss). UI shows `Context: ≈14,238 tok · Est. cost: $0.02 – $0.12 (~$0.04 typical)`. Hover-tooltip: "±15-30% drift normal. Realer Cost siehe Step-Footer."
- [ ] **T-706 — Reconciliation logging.** Every completed turn: compare real cost vs estimated Range. If real > upper-bound × 1.5, write a `calibration-event-<date>.jsonl` row with the inputs and outputs. Drift is signal for heuristic improvement, not a regression — surface in Cost Dashboard as a "Calibration drift" KPI for v1.5+ improvement.
- [ ] **T-707 — Cost Dashboard v0.** Tool-Window tab "📊 Usage" per PLAN.md §14.7. Widgets: Daily Token Consumption (line) · Consumption by Resource (donut) · Daily Stacked by Model (stacked bar) · Consumption by Activity (donut) · Consumption by Mode (donut, API vs CLI) · Top Conversations (table) · Quota Status (progress bars). Render in JBCef-webview + VS Code webview using same Preact code from `packages/shared/ui/`.
- [ ] **T-708 — Trace replay v0.** Conversation menu has "Replay last run." Reads `agents/runtime/state/run-<id>.jsonl` and renders a step-by-step slider with cost accumulator. Foundation for v1.5 trace-share.

**Baseline (P50):** 3 weeks. **If blocked:** Cut T-704 (inline scope) to Sprint 13 (UX polish). Cut T-708 (trace replay) to v1.5. Minimum: T-701, T-702, T-703, T-705, T-707.

### Exit gate — Phase 7 exit criteria

- [ ] User asks for a 3-file refactor — multi-step loop runs through plan → implement → verify; user accepts a bulk-diff card.
- [ ] Action-card UI shows all badges across all card types.
- [ ] Pre-flight estimate range visible before every send.
- [ ] Cost Dashboard tab opens, shows real data from MVP+Sprint 5+6 usage.

---

## Phase 8 — Context Engine v1: Embeddings + hybrid retrieval (2-3 weeks, moved up)

> **Goal.** Vector embeddings on top of BM25. Hybrid retrieval (BM25 + vector) with RRF + local cross-encoder rerank. Quality jump over Sprint 6.
>
> **Dependencies.** Sprint 6 (BM25 lives, walker + parser solid).

- [ ] **T-801 — Embedder.** `@xenova/transformers` ONNX runtime, default model BGE-small-en-v1.5 or MiniLM. Worker pool — embedding is CPU-heavy, must not block UI. Chunk strategy: tree-sitter respects function boundaries up to ~512 tokens per chunk.
- [ ] **T-802 — Vector store.** `sqlite-vec` extension to the existing `tracking.db` or a separate `index.db`. Schema: `chunks(id, file, range_start, range_end, embedding BLOB)`. Cosine-similarity query API.
- [ ] **T-803 — Hybrid retrieval.** `packages/core/src/context/hybrid.ts` combines BM25 top-50 + vector top-50 via Reciprocal Rank Fusion (RRF), keeps top-K (K=20 default).
- [ ] **T-804 — Cross-encoder rerank.** Local rerank model `ms-marco-MiniLM-L-6-v2` (ONNX, ~50MB) re-scores top-K from hybrid. Replaces top-K with the reranked top-10.
- [ ] **T-805 — Incremental re-embedding.** On file save: re-chunk + re-embed only the changed file's chunks. Test: edit 50 lines in a 2000-line file, re-embed completes <2s.
- [ ] **T-806 — Optional remote embedding.** Toggle in `.agent-settings.yml::context.embeddings.provider` between `local` (default) and `voyage` / `openai` (remote, requires API key). Remote embeddings respect Hard Caps (each embedding call counted as a step event with `activity: "context-compression"`).

**Baseline (P50):** 2 weeks. **If blocked (ONNX runtime fights you on a platform):** Skip T-806 (remote embedding) to Sprint 13. Minimum: T-801 to T-805 with local embedding.

### Exit gate — Phase 8 exit criteria

- [ ] Quality test: 20 sample queries from MVP+Sprint 6 chat history get measurably better retrieval (manual evaluation against a held-out test set in `agents/analysis/retrieval-eval/`).
- [ ] First-time index of a 20k-file Laravel repo completes <8 min including embeddings.
- [ ] Single-file save re-embeds <2s.

---

## Phase 9 — Live PTY terminal + dual-surface sync (3 weeks, moved from S8)

> **Goal.** Real PTY-backed terminal in the chat card, with ANSI colour, spinner, elapsed-time, waiting-for-input detection (3 strategies per PLAN.md §8.9.3). VS-Code IDE-terminal sync via Pseudoterminal API. JetBrains IDE-terminal read-only mirror (full read/write deferred to v1.5 per Spike 0.3d outcome).

- [ ] **T-901 — node-pty integration.** `packages/core/src/terminal/pty.ts` wraps `node-pty` IPty instances per command. Prebuilds for 6 architectures (darwin-x64 + arm64, linux-x64 + arm64, win32-x64 + arm64). CI matrix verifies each prebuild loads.
- [ ] **T-902 — TerminalSessionManager.** `Map<commandId, TerminalSession>` per PLAN.md §8.9.2. RingBuffer for last 5000 lines (10 MB cap). FIFO input queue. Reconnect-after-IDE-restart works: sidecar survives, on plugin reconnect the card renders current state.
- [ ] **T-903 — JSON-RPC terminal events.** Schema from PLAN.md §8.10: `terminal.output`, `terminal.status`, `terminal.input`, `terminal.subscribe` (with `replayFromSeq` for reconnect).
- [ ] **T-904 — xterm.js renderer in chat cards.** Both surfaces (JBCef-webview for JetBrains, VS Code webview for VS Code) host xterm.js + ANSI parser. Status bar in card shows: command preview, elapsed time, spinner during run, `🔗 synced w/ IDE Terminal` pill when bridged.
- [ ] **T-905 — Waiting-for-input detection (3 strategies).** Per PLAN.md §8.9.3: heuristic regex (last 200 bytes) + PTY stdin-readiness (node-pty hook) + idle-timeout (800ms). UI flow: tentative banner first ("possibly waiting"), bestätigt-banner after idle confirms.
- [ ] **T-906 — Inline input card.** When waiting-for-input fires, an input field appears in the card. Send writes to the PTY's stdin. First-write-wins on conflict; later surfaces see toast "Input already submitted from <surface>".
- [ ] **T-907 — VS-Code Pseudoterminal bridge.** `vscode.window.createTerminal({pty: new PtyWrapper(commandId)})` — IDE terminal becomes a thin renderer of the same sidecar PTY stream. Bidirectional: typing in IDE-terminal writes back to the sidecar PTY.
- [ ] **T-908 — JetBrains IDE-terminal read-only mirror.** `JBTerminalWidget` rendering the same stream **read-only**. Full read/write via `TtyConnector` deferred to v1.5 per Spike 0.3d outcome.

**Baseline (P50):** 3 weeks. **If blocked (prebuilds fail on Windows ARM):** Ship Windows x64 only, log Windows-ARM as known-limitation in docs. **If T-907 blocked:** Fall back to read-only mirror in VS Code too — user uses xterm.js in chat card only.

### Exit gate — Phase 9 exit criteria

- [ ] User runs `python scripts/setup-env.py` (interactive prompts) in chat — card shows live output, prompt detected, user types answer, script proceeds.
- [ ] Same script attached to VS Code IDE terminal — input/output mirror in both surfaces.
- [ ] Conflict-resolution test: user types in chat card AND IDE terminal simultaneously — first input wins, second toast surfaces.
- [ ] IDE restart mid-command: sidecar survives, on re-open card shows current state of the command.

---

## Phase 10 — Native IDE depth (SweepAI-style) (3 weeks, moved from S9)

> **Goal.** Plugin feels native to JetBrains, not "Webview in an IDE." Inline-edit Prompt Bar (`Cmd+I`), diff-accept shortcuts (`Cmd+Y/N/Enter/Shift+Backspace`), right-click `EditorPopupMenu` group, intention action, Find Action integration.
>
> **Dependencies.** Sprint 9 (intention actions may trigger shell commands — needs PTY).

- [ ] **T-1001 — Inline-edit Prompt Bar (`Cmd+I`).** Select code → press `Cmd+I` → small floating prompt bar appears anchored to the selection. User types a transform request ("rename this to `userName`", "add error handling"), Enter sends. Result shown as inline-diff with accept/reject.
- [ ] **T-1002 — Diff-accept shortcuts.** Per PLAN.md §3.5.4 SweepAI shortcuts: `Cmd+Y` accept single, `Cmd+N` reject single, `Cmd+Enter` accept-all-in-file, `Cmd+Shift+Backspace` reject-all. Implement for both IDEs. Resolve Sweep's `Cmd+N` conflict (Sweep uses `Cmd+N` for both "new chat" and "reject" — we use `Cmd+J` for new chat, `Cmd+N` for reject).
- [ ] **T-1003 — Right-Click EditorPopupMenu group.** JetBrains: `<group id="event4u.editor"/>` in `plugin.xml` with actions "Ask about this", "Fix this", "Explain this", "Refactor this". VS Code: contributes to `editor/context` menu in `package.json`.
- [ ] **T-1004 — Intention Action.** JetBrains: `IntentionAction` registered, `Alt+Enter` shows "Fix with event4u-agent" alongside built-in intentions. Action fires the inline-edit prompt bar (T-1001) pre-populated with the relevant code.
- [ ] **T-1005 — Find Action integration.** JetBrains: register all plugin actions in `Find Action` (`Cmd+Shift+A`). User types "ask about" → shows our action. VS Code: commands already register in Command Palette via `contributes.commands`; nothing extra needed.
- [ ] **T-1006 — Floating code toolbar.** JetBrains: `Floating.CodeToolbar` group with "Ask", "Fix", "Explain" buttons that appears on selection. SweepAI pattern.
- [ ] **T-1007 — Go-to-changes navigation.** `Alt+L` goes to next file with pending changes. `Alt+J/K` navigates within a file's hunks. SweepAI pattern.

**Baseline (P50):** 3 weeks. **If blocked (Compose UI for the floating toolbar fights you):** Cut T-1006 to Sprint 13. Minimum: T-1001, T-1002, T-1003, T-1004.

### Exit gate — Phase 10 exit criteria

- [ ] Inline-edit `Cmd+I` works in both IDEs, produces diff, shortcuts accept/reject.
- [ ] Right-click on code → "Ask about this" in both IDEs.
- [ ] Find Action / Command Palette surfaces all event4u actions.
- [ ] Sweep-style shortcuts (`Cmd+Y/N/Enter/Shift+Backspace`, `Alt+L/J/K`) all functional.

---

## Phase 11 — MCP client + full agent-config coverage (3 weeks)

> **Goal.** Plugin can connect to arbitrary MCP servers (per `.agent-settings.yml::mcp.servers`). All 136 agent-config commands are callable via slash-picker. Memories work (lokal + optional `@event4u/agent-memory` MCP backend). Hooks (sessionStart/End/Stop) respect agent-config hook system.

- [ ] **T-1101 — MCP Client.** `@modelcontextprotocol/sdk` integration. Reads `.agent-settings.yml::mcp.servers[]`, spawns each as subprocess, manages JSON-RPC connection. Tool registry includes MCP tools with prefix `<server-id>:<tool-name>`.
- [ ] **T-1102 — agent-config MCP server consumption.** Connect to the agent-config-shipped MCP server (`npx @event4u/agent-config mcp`). Use its tools (`memory_lookup`, `chat_history_read`, `list_skills`, `skill_read`, `command_read`) instead of our own filesystem readers for skill/rule/command content.
- [ ] **T-1103 — All 136 commands callable.** Slash-picker shows all commands from the agent-config tree (filtered by user-set favourites if Phase 0 Spike 0.5 recommended favourites). Each command's procedure is loaded via the MCP `command_read` tool at invocation time.
- [ ] **T-1104 — Memories — local.** `packages/core/src/memory/local.ts` reads/writes `.event4u-agent/memories/` JSON files per agent-config memory schema. Two memory types in MVP: `user` (long-lived) and `feedback` (workflow corrections).
- [ ] **T-1105 — Memories — MCP backend.** Optional: if `@event4u/agent-memory` MCP server configured, route memory_lookup/memory_write calls there. Local fallback if MCP server unreachable.
- [ ] **T-1106 — Hooks.** `agents/runtime/hooks/sessionStart.sh`, `sessionEnd.sh`, `Stop.sh` executed at lifecycle points. Compatible with agent-config hook system (same env vars, same exit code semantics).

**Baseline (P50):** 3 weeks. **If blocked (MCP SDK fights you):** Local memory only (T-1104), MCP work to Sprint 13. Hooks (T-1106) are independent.

### Exit gate — Phase 11 exit criteria

- [ ] User adds a GitHub MCP server to `.agent-settings.yml`; tools appear in chat with `github:` prefix.
- [ ] All 136 agent-config commands invocable.
- [ ] Memory created in one session, recalled in the next.
- [ ] sessionStart hook fires when chat opens.

---

## Phase 12 — Per-CLI gear panel + Unified Session Browser (2 weeks)

> **Goal.** The per-CLI controls panel (PLAN.md §9.11) and session browser (§9.13) ship. Settings render adapts per CLI capability manifest. User can browse + resume sessions across all 4 sources (plugin-API, claude-CLI, codex-CLI, gemini-CLI).

- [ ] **T-1201 — Capability-manifest renderer.** Reads the manifest of the currently-selected CLI, renders the gear panel inline (auto-modes radio group, slash-commands as buttons, permission-modes dropdown, etc.).
- [ ] **T-1202 — Session adapter per CLI.** `packages/core/src/sessions/adapters/{claude,codex,gemini,aider}.ts`. Each adapter knows the CLI's session-file location + format. Returns `SessionSummary` per PLAN.md §9.13.1.
- [ ] **T-1203 — Unified Session Browser overlay.** Click `📚 Sessions` button (top-right in chat header). Overlay renders all sessions across sources, grouped by date, filterable by source + provider + search. Per PLAN.md §9.13.2 mockup.
- [ ] **T-1204 — Chokidar watcher for live detection.** Watches `~/.claude/projects/**/sessions/`, `~/.codex/sessions/`, `~/.gemini/sessions/` for new files. "Active now" section shows live sessions.
- [ ] **T-1205 — Resume logic per source.** Plugin-API: load conversation JSON, render messages. CLI: spawn `<binary> --resume <id>` as subprocess, attach the chat UI to it.
- [ ] **T-1206 — "External sessions detected" onboarding.** First-run: scan finds existing CLI sessions outside the plugin. Show consent dialog: "Show external sessions in browser? [Yes / No / Configure per-CLI]."

**Baseline (P50):** 2 weeks. **If blocked:** Ship only claude-CLI session browser + plugin-API sessions (T-1202 partial, T-1203, T-1205 partial). Codex+Gemini session browsers to Sprint 13.

### Exit gate — Phase 12 exit criteria

- [ ] Gear icon click opens panel with claude-specific controls; switch to codex CLI → panel renders codex-specific controls.
- [ ] Session browser shows all sessions across all 4 sources.
- [ ] Resume a claude-CLI session started outside the plugin (via raw `claude` in terminal).

---

## Phase 13 — UX polish + late-arriving items (3 weeks)

> **Goal.** Everything that slipped from Sprints 5-12 lands here, plus persisted history, conversation forking, checkpoints, statusbar polish, abortable streaming refinements.

- [ ] **T-1301 — Persisted chat history.** Conversation list in left sidebar of tool-window. Click opens past conversation. Search across history. Stored under `.event4u-agent/chats/` per workspace.
- [ ] **T-1302 — Conversation forking.** Editing a past user message creates a fork — original conversation kept, branch starts from the edited turn.
- [ ] **T-1303 — Checkpoints.** Multi-step agent runs auto-checkpoint at phase boundaries. User can "rewind to checkpoint" — restores conversation state + file state.
- [ ] **T-1304 — Statusbar widget — index status.** "Indexing 4,238 / 21,500 files…" or "Index ready · 21k files · last update 2m ago."
- [ ] **T-1305 — Abortable streaming refinements.** Stop button works during embedding, during MCP tool call, during external-session-watcher.
- [ ] **T-1306 — Pull-up slot.** Any T-XXX items deferred from Sprints 5-12 (gear panel for codex/gemini if cut from S12, T-704 inline scope if cut from S7, etc.) land here.
- [ ] **T-1307 — Workspace Guidelines.** Editable `.event4u-agent/guidelines.md` per workspace — content is prepended to system prompt (Augment-style + agent-config rule-compat).

**Baseline (P50):** 3 weeks (this sprint absorbs slip).

### Exit gate — Phase 13 exit criteria

- [ ] Persisted history works across IDE restarts.
- [ ] Conversation forking + checkpoints visible in UI.
- [ ] All deferred T-XXX from earlier sprints landed or explicitly punted to v1.5.

---

## Phase 14 — Pricing Book signing + Telemetry + Docs (3 weeks)

> **Goal.** Ship-readiness for internal beta. Pricing Book Sigstore signature lands. Telemetry opt-in lands. Full documentation pass.

- [ ] **T-1401 — Pricing Book Sigstore signature.** `packages/core/src/pricing/verify.ts` validates `prices.yml` against a public key shipped in the plugin. On signature mismatch: fall back to plugin-bundled baseline pricing. Hard-block dialog if new pricing has >50% drop vs current — user must explicitly confirm.
- [ ] **T-1402 — Sigstore signing pipeline.** GitHub Actions workflow signs `prices.yml` on release. Public key committed to plugin repo. SLSA provenance attached to release artifact.
- [ ] **T-1403 — Telemetry — engagement logs.** Opt-in via Settings (`telemetry.artifact_engagement.enabled`). Logs which skills/tools/commands invoked (no content, no prompts, no completions). Local-only JSONL under `.event4u-agent/telemetry/`. `event4u: Export Telemetry Report` command produces a markdown report.
- [ ] **T-1404 — Subscription-cost approximation.** CLI mode shows "Shadow API cost: $X.XX (would have cost on API)" alongside subscription quota usage. Per PLAN.md §14.5.
- [ ] **T-1405 — Docs — Quick Start.** `README.md`, `docs/quick-start.md`, screenshots of every major surface.
- [ ] **T-1406 — Docs — Architecture.** `docs/architecture.md` reflects shipped reality (vs PLAN.md's plan).
- [ ] **T-1407 — Docs — Contributing.** `docs/contributing.md` for internal contributors.
- [ ] **T-1408 — Docs — FAQ.** Common gotchas from internal beta — "Plugin doesn't start on Windows ARM", "CLI mode shows 'auth expired'", etc.
- [ ] **T-1409 — ADR consolidation.** All ADRs from Phase 0 + emerging decisions during MVP + v1.0 consolidated in `docs/adr/index.md`.

**Baseline (P50):** 3 weeks. **If blocked:** T-1402 (signing pipeline) to Sprint 15; Sprint 14 minimum is T-1401 + T-1403 + T-1405..T-1409.

### Exit gate — Phase 14 exit criteria

- [ ] Plugin verifies pricing book signature on every load.
- [ ] Telemetry opt-in works; export command produces report.
- [ ] Docs complete enough that an event4u dev can install + configure + use the plugin without asking the author.

---

## Phase 15 — Buffer + Beta Release (2-3 weeks)

> **Goal.** Explicit buffer absorption + cross-platform verification + internal beta release.

- [ ] **T-1501 — Aufholarbeit.** All overflow items from Sprints 5-14 land here or are explicitly punted to v1.5 with rationale.
- [ ] **T-1502 — End-to-end integration tests.** All targets: PhpStorm 2024.2 + 2024.3 + 2025.x, VS Code Stable + Insiders. Full demo script v0 (from Phase 0) runs through clean on all.
- [ ] **T-1503 — Cross-platform verification.** macOS Intel + ARM, Linux x64 + ARM, Windows x64 + ARM. Document each platform's known limitations.
- [ ] **T-1504 — Performance-regression tests.** Index a 50k-file repo: time + memory. Compared against Sprint 6 + Sprint 8 baselines. Regression-alarm if degraded >20%.
- [ ] **T-1505 — Beta release to event4u internal.** Internal release channel. Acceptance criteria from ADR-002 positioning checked (if Positioning A: internal-only release path; if B: prepare for public beta in v1.5).

**Baseline (P50):** 2-3 weeks.

### Exit gate — Phase 15 exit criteria

- [ ] All overflow either landed or punted.
- [ ] Demo script v0 runs on all target IDEs + OSes.
- [ ] Beta release shipped to event4u team.
- [ ] Positioning decision from ADR-002 actioned (internal-only or public-beta-prep).

---

## Acceptance criteria — v1.0 overall

- [ ] All Sprint exit criteria met (S5..S15).
- [ ] Cost Dashboard renders real usage from 7+ months of internal dogfooding.
- [ ] At least 5 event4u team members report daily usage in `agents/analysis/dogfood-feedback-<date>.md`.
- [ ] All ADRs (001 Build-vs-Fork · 002 Positioning · 003 UI-Stack · 004 Permission Model · plus new ADRs from v1.0 surprises) in `docs/adr/index.md`.
- [ ] `road-to-v1-5-public-beta.md` is the next active roadmap (only if Positioning B was chosen).

## Notes

- **Council source (no path-link per `no-roadmap-references`):** Council (claude-sonnet-4-5 + gpt-4o, 2026-05-28, analysis lens, 2 rounds, $0.12) drove the Sprint reorder: Context Engine moved from Sprints 11-12 to Sprints 6 + 8; PTY moved from Sprint 8 to Sprint 9; Native IDE depth moved from Sprint 9 to Sprint 10; per-CLI + sessions moved from Sprint 10 to Sprint 12. Reconciliation logging in T-706 came from council finding #6 round-1 (Calibration-Event idea).
- **Rejected council findings (host verdict):**
  - "Cut CLI mode entirely from MVP + v1.0" (round-2 Reviewer A) — rejected as unilateral cut of a stated differentiator. CLI mode shipped in MVP (Claude only, tight scope) + v1.0 Sprint 5 (Codex + Gemini), with full polish (gear panel + session browser) in Sprint 12.
  - "Expand Sigstore to staleness / rotation / downgrade protection" (round-1 Reviewer A) — rejected. Sprint 14 keeps just the signature; key rotation goes in ops docs.
- **Sprint sequencing rationale (council-aligned):** Sprint 5 catches up missing providers (a known cut). Sprint 6 + 8 build retrieval (council's highest-leverage finding). Sprint 7 lands the agent-loop + cost UX. Sprint 9 + 10 are visible IDE polish. Sprints 11-12 round out integrations. Sprint 13 absorbs slip. Sprint 14 ship-readiness. Sprint 15 release.
- **What happens if MVP Sprint 4 demo bombed:** the v1.0 roadmap is re-cut before Sprint 5 starts. Specific scenarios: if team rejected `/commit` and wanted a different command → re-author Sprint 11 (`/commit` becomes `/release-notes` or whatever, plus Sprint 5 stays as-is). If team rejected agent-config integration entirely → Phase 0 was wrong about positioning B; revisit before continuing.
- **Hard-floor reminder.** No commits / pushes / tags / releases during sprint work without explicit user authorisation each time. Sprint exits are inflection points where a commit batch becomes appropriate; the user authorises per sprint. Marketplace submissions are v1.5 (per Positioning B/C) — never an autonomous decision.
- **Cross-reference.** Predecessor: `road-to-mvp.md`. Successor (only if Positioning B/C from ADR-002): `road-to-v1-5-public-beta.md`. v2.0 (self-hosted backend / SSO / enterprise) tracked separately when it becomes concrete.
