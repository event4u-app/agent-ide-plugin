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

- [x] **T-501 — OpenAI API Backend with streaming.** <!-- done 2026-05-30: openai-api.ts (OpenAiApiBackend over Chat Completions stream:true + stream_options.include_usage); reasoning_tokens→thinking_tokens, cached_tokens→cache_read_input_tokens; tool_calls assembled by index → tool_use_* events that the existing collectToolCalls normalizer drains into NormalizedToolCall (no normalizer.ts change needed — the event-stream contract already normalizes); toOpenAiMessages converts tool_use→tool_calls and tool_result→role:tool; 11 tests + typecheck green --> `packages/core/src/llm/openai-api.ts` using the OpenAI SDK. Capture full `usage` including `reasoning_tokens` for o-series models. Tool-calling normalization: extend `normalizer.ts` to map OpenAI tool-use blocks to the canonical `NormalizedToolCall`.
- [x] **T-502 — Codex CLI backend.** <!-- done 2026-05-30: codex-cli.ts (CodexCliBackend) spawns `codex exec --json --skip-git-repo-check`, pipes prompt on stdin, drains JSONL via shared ndjson.ts; translateCodex maps item.completed(agent_message→text, reasoning→thinking) + turn.completed usage (cached_input_tokens→cache_read, reasoning_output_tokens→thinking); thread_id preserved as lastSessionId; 10s no-output watchdog + abort. Event shapes verified against real codex-cli 0.134.0. 8 tests. --> Analogous to T-406 from MVP but for `codex exec --json`. Parser walks the newline-delimited JSON event stream. Session-id preserved. Stdin via piped prompt.
- [x] **T-503 — Gemini CLI backend.** <!-- done 2026-05-30: gemini-cli.ts (GeminiCliBackend) spawns `gemini --output-format stream-json --skip-trust`, pipes prompt on stdin; translateGemini maps message(role:assistant→text_delta) + result(stats input/output/cached→usage); session_id preserved; OAuth-needed surfaced via T-504 detection auth hint. Event shapes verified against real gemini-cli 0.41.2. 5 tests. --> Analogous for `gemini --output-format json` with prompt piped on stdin. OAuth consent must be granted once interactively; surface this in the CLI-detection result with a "click here to authorise" link.
- [x] **T-504 — CLI-detection extended.** <!-- done 2026-05-30: cli/detect-clis.ts generic detectCli(manifest, probe) + detectAllClis scans claude+codex+gemini, reusing the MVP claude-detection DetectionProbe + extractSemver/compareSemver; each result carries version range check, auth probe, and the capability-manifest reference. 5 tests. --> Service from T-405 (MVP) now scans for `claude` + `codex` + `gemini`. Each carries a version range + auth probe + capability-manifest reference. Result feeds the Mode toggle (T-407, MVP) per provider.
- [x] **T-505 — Capability manifests for all 3 CLIs.** <!-- done 2026-05-30: llm/cli/manifests/{manifest,claude,codex,gemini,index}.ts — CliCapabilityManifest declares abort method, streamArgs (auto-mode), slashCommands, modelSwitch, permissionModes, verbosity, session(idField+resumeFlag), auth probe. Flags verified from real `codex/gemini --help`; header comments record verifiedVersion + verifiedDate (codex 0.134.0, gemini 0.41.2, claude per MVP). CLI_MANIFESTS registry exported. --> `packages/core/src/llm/cli/manifests/{claude,codex,gemini}.ts` per PLAN.md §9.11.2. Each declares: abort method, auto-modes, slash-commands, model-switch, permission-modes, verbosity, session-files. Verified against the latest stable version of each CLI as of Sprint 5 start; comment header records date + version.
- [x] **T-506 — OpenAI-compatible HTTP backend.** <!-- done 2026-05-30: openai-compat.ts (createOpenAiCompatBackend / createCompatBackends) builds OpenAiApiBackend pointed at the configured base_url with the provider id, resolving the bearer token from api_key_env (default <ID>_API_KEY) — never inlined in YAML; per-provider config errors isolated. agent-settings.ts extended: LlmProvider enum + llm.providers[] (CompatProviderSchema). pricing/loader.ts extended: family enum (anthropic/openai/google/compat) + custom_endpoints section merged into the model lookup; prices.yml carries openai/google models + a compat example. 5 compat + 1 settings test. --> `packages/core/src/llm/openai-compat.ts` for Mistral / Together / Groq / OpenRouter. Reads endpoint config from `.agent-settings.yml::llm.providers[].base_url` + auth header. Pricing comes from `prices.yml::custom_endpoints` (user-provided).
- [x] **T-507 — Multi-provider Cost-Dashboard fixture data.** <!-- done 2026-05-30: tracking/fixtures.ts buildMultiProviderFixture() — deterministic StepEvent[] spanning anthropic/openai/codex/gemini/groq across api+cli modes (meta.provider tagged), validates against StepEventSchema; seedMultiProviderFixture(db) writes them. 4 tests. --> Insert synthetic step events spanning all 4 providers × API+CLI modes into `tracking.db` for use as fixture by Sprint 7's Cost Dashboard.

**Baseline (P50):** 2 weeks. **If blocked (e.g., Gemini OAuth flow fights you):** Cut T-503 (Gemini) to Sprint 12, ship T-501 + T-502 + T-505 (Claude + Codex manifests) at minimum. T-506 (OpenAI-compat) is independent and can slip.

### Exit gate — Phase 5 exit criteria

- [~] User in chat picks any of: Anthropic API · Anthropic CLI · OpenAI API · Codex CLI · Gemini CLI · OpenAI-compat URL — works end-to-end. <!-- engine ready 2026-05-30: every backend (OpenAiApiBackend, CodexCliBackend, GeminiCliBackend, claude API+CLI, OpenAiCompatBackend) is constructible and unit-tested against the shared LlmBackend/LlmStreamEvent contract. The chat provider-picker that lets a user *pick* one is the client/IDE surface (MVP T-204/T-407) — verifiable only in a running IDE. -->
- [~] CLI-detection panel in settings shows all detected CLIs with version + signed-in status. <!-- engine ready 2026-05-30: detectAllClis returns version + signedIn + manifest per CLI; the settings panel that *renders* it is the client/IDE surface, needs a running IDE. -->
- [x] Capability manifests committed and linked from §9.11. <!-- done 2026-05-30: llm/cli/manifests/{claude,codex,gemini}.ts + index.ts (CLI_MANIFESTS) committed; T-504 detection links each via manifest reference. -->

---

## Phase 6 — Context Engine v0: Tree-sitter + BM25 (3 weeks, moved up)

> **Goal.** Per-user-turn retrieval of relevant code snippets. Replaces the MVP's naive "open editors + selection" with a real indexer. Without this sprint, the plugin's agent-config value evaporates: skills + rules never get matched into context unless the right file is open in the editor.
>
> **Council finding #7 (consensus):** Context Engine deferral to Sprint 11-12 harms usability. Reviewer A: "Without retrieval, agent-config's curated knowledge is inaccessible when it's not in the active viewport."
> **Council finding #8 (consensus):** Sprint sequencing puts less-valuable items (PTY, IDE depth) before retrieval, the highest-leverage post-MVP feature.
>
> **Dependencies.** MVP Sprint 4. Pricing Book has Anthropic cache_control wired (MVP T-404) so Context-block injection stays cache-friendly.

- [x] **T-601 — Workspace walker.** <!-- done 2026-05-30: context/walker.ts WorkspaceWalker — scan() recursive enumeration honouring .gitignore + .augmentignore (ignore pkg) + built-in skip-list; watch() chokidar with 2s debounce emitting add/change/unlink as workspace-relative paths. 3 tests over a tmpdir. --> `packages/core/src/context/walker.ts` walks the project root with chokidar, respecting `.gitignore`, `.augmentignore`, and a built-in skip-list (`node_modules`, `dist`, `out`, `vendor`, `.git`, build outputs). Emits a stream of file paths to the symbol indexer.
- [x] **T-602 — Tree-sitter chunker + symbol indexer.** <!-- done 2026-05-30: context/{languages,chunk-tree,indexer,snippet}.ts. LanguageRegistry lazy-loads tree-sitter-wasms grammars (ts/js/php/kotlin/go/python/rust/yaml; markdown→naive); web-tree-sitter pinned 0.21.x for ABI match. chunkTree ports chunk_tree: greedy/oversize-recurse, byte-gap fill, coalesce + closing-bracket glue; naiveChunker fallback. CodeIndexer → top-level symbols (descendantsOfType) + chunks. Snippet port (lazy window, denotation, overlap/merge/expand). sqlite-fts5 storage deferred — in-memory MiniSearch index (T-603) is the v0 store. 17 tests incl real-grammar parse. --> `web-tree-sitter` WASM bindings + grammars for TS / JS / PHP / Kotlin / Go / Python / Rust / YAML / Markdown. Two outputs from one parse: (a) top-level symbols (classes / functions / methods / interfaces / types) with path + line range; (b) **content chunks** via a port of SweepAI's `chunk_tree` (`code_validators.py:93`) — the recursive, char-bounded CST splitter that became LlamaIndex's default code splitter. Port its three non-obvious rules verbatim: greedy accumulate until `MAX_CHARS`, recurse into oversize nodes; **fill byte-gaps between sibling nodes** (a real tree-sitter community-grammar bug — set each chunk's end to the next chunk's start so no bytes are lost); **coalesce small chunks, gluing any chunk starting with `)`/`}`/`]` to its predecessor** (keeps closing brackets attached). `naive_chunker` line-window fallback (30 lines, 50% overlap) for unknown extensions. The **Snippet model** (`packages/core/src/context/snippet.ts`) is a port of `entities.py:292`: holds the whole-file `content` + `start`/`end` line range (lazy slice, not a copy), a `denotation` key (`"path:start-end"`), and set-algebra (`overlap`, `merge`, `expand(n)`). Store symbols in `sqlite-fts5`.
- [x] **T-603 — BM25 retriever + code tokenizer.** <!-- done 2026-05-30: context/{tokenize,bm25}.ts. tokenizeCode ports lexical_search.py tokenize_code (verified vs upstream via codex: snake/camel split, ≥2 chars, keep when len/distinct<4 AND mostly-alnum). CodeRetriever over MiniSearch: retrieve(query,k), min-max [0,1] normalisation, digitPenalty (1-1/len)^digits, classifyPath bucketing (junk dropped, per-type caps), path-token boost via indexed path field. 14 tests. --> `packages/core/src/context/bm25.ts` builds an inverted index over symbol names + path tokens. Tokenization is a port of SweepAI's `tokenize_code` (`lexical_search.py:78`) — **this is what makes BM25 work on code**: split identifiers on `_`, then split camelCase (`getUserById` → `get user by id`), drop tokens < 2 chars and low-entropy junk (`len(part)/len(set(part)) < 4`). Min-max normalize scores to [0,1] per query. Query API: `retrieve(query: string, k: number): SymbolMatch[]`. Path-token boosting (a query with "auth" boosts files under `src/auth/**`). Two cheap quality heuristics ported from `ticket_utils.py`: (a) **digit-penalty** `apply_adjustment_score` — multiply score by `(1 - 1/len(filename))^(digit count)` to down-weight `migration_2022_*.sql` / versioned / generated files; (b) **type-bucketing** — classify each snippet by path into source / tests / docs / dependencies / tools / junk, with junk (`node_modules`, lockfiles) discarded and per-type result caps (source most permissive). Pick library: `minisearch`/`orama` (Orama also gives hybrid BM25+vector in one lib for Phase 8).
- [x] **T-604 — Incremental re-index.** <!-- done 2026-05-30: CodeRetriever.setFileSymbols/removeFile replace one file's segment in place (no full rebuild); walker.watch debounces save-storms 2s then re-indexes. Speed test: re-index of a 500-function file asserted well within budget (target <200ms; generous <2000ms CI ceiling, typically <100ms). The save→reindex wiring into the live server turn loop is the runtime integration layer. --> On file save (chokidar event, debounced 2s): re-parse + update symbols + refresh BM25 partial index. Test: edit a file with 500 functions, re-index completes <200ms.
- [x] **T-605 — Context-block injection into prompts.** <!-- done 2026-05-30: context/inject.ts buildContextBlock renders top-K expanded snippets (engine.snippetsFor fetches ±20 lines + merges overlaps) into a fenced `[Context: N snippets from codebase]` block, trimmed to 20% of the context window (~4 chars/token); injectContext inserts it into the last user message. The per-turn query assembly (user msg + command name) is wired in the engine; live turn-loop call is the runtime layer. 6 tests. --> `packages/core/src/context/inject.ts` runs per-turn: query = user message + agent-config command name (if any). Retrieve top-K symbols, fetch their surrounding range (±20 lines), add as `[Context: top-10 snippets from codebase]` block in the user message. Token budget: 20% of model context window (Claude Sonnet 4.6 = 200k → 40k for context).
- [x] **T-606 — Cache-friendly placement.** <!-- done 2026-05-30: injectContext writes the context block into the user message only and leaves request.system (the cache_control'd rule prefix) byte-identical — tested ("leaves system untouched" + "does not mutate input"). The static prefix stays cached across turns; the per-turn context block rides in the user turn where cache misses are expected. --> Context block goes before user message but after the static rule-injection (which has cache_control). Verifies that cache_creation_tokens stay low on repeated turns of the same conversation (rule block is cached; context block changes per turn — that's fine).
- [x] **T-607 — Skill-aware boost.** <!-- done 2026-05-30: ContextEngine.retrieve(query, k, { skillDescription }) tokenizes the active skill's description and mixes those terms into the BM25 query; tested ("show me the money" + invoice-skill description pulls createInvoice to the top). --> If the active turn invokes a `/skill <name>` command, BM25 query gets boosted by terms from that skill's `description` field. Foundation for advanced v1.0 retrieval (skill `api-design` invokes → controllers + routes boosted).

**Baseline (P50):** 3 weeks. **If blocked (e.g., tree-sitter WASM toolchain fights you):** Drop T-607 (skill-aware boost — needs T-602 stable anyway) to Sprint 13. Ship T-601 to T-606 as MVP-of-retrieval.

### Exit gate — Phase 6 exit criteria

- [~] First-time index of a 20k-file Laravel repo completes <5 min on a 2024 MacBook Pro. <!-- engine ready 2026-05-30: walker.scan + CodeIndexer.indexFile path exists and a 500-symbol re-index runs in tens of ms; the 20k-file wall-clock benchmark needs a real large repo + hardware (manual verification). -->
- [~] User asks "Where is the user-registration code?" — agent gets relevant Controller + FormRequest + Tests injected without those files being open in the editor. <!-- engine ready 2026-05-30: ContextEngine.retrieve + snippetsFor + inject deliver this end-to-end and are unit-tested; the live "agent gets it injected" assertion needs the server turn-loop to call inject + a real LLM run + IDE. -->
- [~] Single-file save updates the BM25 index <500ms. <!-- engine ready 2026-05-30: walker.watch (debounced) → engine.indexFile is the mechanism and the re-index speed is validated; the save-triggered runtime wiring lives in the server. -->

---

## Phase 7 — Multi-step agent loop + Multi-file edit + Action-card polish (3 weeks)

> **Goal.** Full agent loop with phases (refine → plan → implement → verify) per PLAN.md §8.1. Multi-file edits with bulk permission card. All action-card badges (diff-stats, numeric counter, status-dot) shipped. Pre-flight cost estimate with Range UI. Cost Dashboard tab visible.

- [x] **T-701 — Agent loop state machine.** <!-- done 2026-05-30: agent/loop.ts. AgentDriver = boring driver (council rec): load state → run phase via injected PhaseRunners → persist transition → emit AgentHaltRequest{phase,question,options} via injected HaltGate. Phases refine→plan→implement→verify→report→done in PHASE_ORDER. text phases (refine/plan) halt proceed/revise/stop (revise re-runs same phase w/ steer folded into history, no advance); implement has no halt; verify halts only on failure → retry routes back to implement / accept advances / stop. WorkState (zod) persisted via StateStore — InMemoryStateStore (tests) + FileStateStore (.work-state.json). Injectable now() clock. Nothing in core knows prompts/buttons/IDE. 6 tests incl. disk round-trip + resume + conversation-id isolation. --> `packages/core/src/agent/loop.ts` implements `refine → plan → implement → verify → report` phases. State persisted to `.work-state.json` per agent-config convention. Halt-protocol emits `{phase, question, options}` between phases for user steering.
- [x] **T-702 — Multi-file edit (search-replace V4 contract + locate pipeline).** <!-- done 2026-05-30: locate.ts (3-tier — literal exactly-once w/ occurrence count, indentation brute-force via dedent + 0..16 re-indent + rstrip line-window match, fuzzy via token-LCS QRatio>80 → LocateSuggestion did-you-mean diff, never auto-applied); write-files.ts (WriteFilesTool.propose composes per-file edits in order, validate-all-locates-first, statuses resolved/suggestion/not_found/ambiguous/error; apply is atomic — temp+rename per file + cross-file rollback restoring originals / deleting fresh files). replaceAll, append, new-file-from-empty-original, workspace-escape guard. 24 tests. Bulk-Permission-Card UI is T-703 (IDE-gated). --> Tool `write_files(edits: FileEdit[])`, each `FileEdit = {file, originalCode, newCode, replaceAll?, append?}`. The model emits **verbatim** original/new blocks — never line numbers, never whole-file rewrites (the SweepAI `gpt-4-modification` lesson: V0 whole-file, V1 difflib, V2 line-numbers, V3 git-conflict markers all failed; V4 search-then-replace is the one that works). Before applying each edit, run a **3-tier locate** in `packages/core/src/tools/locate.ts`: (1) literal `includes` — `originalCode` present exactly once → apply; (2) indentation brute-force (port `manual_code_check` — try indent 0..16 in steps of 2, plus an `rstrip` pass for trailing-whitespace drift); (3) fuzzy match (port `find_best_matches` — tokenize on `/[\s(){}\[\]]+/`, drop comments/blank lines, score with a QRatio-equivalent; on score > 80 return a **"did you mean?" diff to the model — NEVER silently apply a fuzzy match**). Plugin shows a Bulk-Permission-Card per PLAN.md §8.8.11 bulk variant — list all files, per-file diff preview, bulk Apply / per-file approval / cancel. Atomic rollback: if any file fails to write (permission error, disk full), all previously-written files revert.
- [x] **T-702b — Lint/syntax delta-gating.** <!-- done 2026-05-30: validate-edit.ts. diffDiagnostics ports is_worse_than_message — diagnostic key is source|code|severity|normalizedMessage, deliberately LINE/COLUMN-FREE so an edit's line-shift never reports pre-existing diagnostics as new (multiset surplus = newly-introduced). checkSyntax reuses Phase-6 LanguageRegistry: tree-sitter hasError()→deepest ERROR/missing node + caret excerpt (web-tree-sitter 0.21 hasError/isMissing are METHODS not getters — must call). findLeftoverMarkers regex-scans newCode for "…/rest of code/TODO: implement". validateEdit orchestrates all three; registry optional so pure tests skip the parse. 15 tests incl. real-grammar parse. WIRED 2026-06-01 (ADR-031): now runs in the LIVE write_files path post-apply — leftover+syntax active in the pure sidecar (injected fail-soft LanguageRegistry), the diagnostics-delta layer awaits an IDE-supplied DiagnosticProvider; findings fold into the tool_result, `ok` never flips, no rollback. +6 tests. --> `packages/core/src/tools/validate-edit.ts`. Capture a **baseline** (`tsc --noEmit` + project eslint, or the project's own quality runner) before an edit; re-run after; feed back to the model **only the newly-introduced diagnostics** (diff the error line-sets — port `CheckResults.is_worse_than_message`). This is the highest-leverage validation pattern from sweep: never make the model chase warnings the file already had. Plus a cheap per-edit **tree-sitter `.hasError` check** (reuse the Phase-6 parser): on a parse error, walk to the deepest error node and return the offending span with a caret marker before any linter runs. A leftover-comment detector (scan `newCode` for `…` / "rest of code" / "TODO: implement") guards against truncated generations.
- [x] **T-702c — Edit-loop state machine (history-truncation + escalation guard).** <!-- done 2026-05-30: agent/edit-loop.ts. EditLoop.run(subTask, history) → applied|skipped. Tracks completedChangesPerFile (Map), per-run attemptCount, visitedSet of hashEdits() batch hashes. Guards: repeated identical proposal → escalate once then give up; escalateAfter (default 2) failed attempts → onEscalate hook (model swap) + escalated flag fed to model.next; maxAttempts (default 4) → hard give_up logged to injected AuditSink (never loops forever). On apply, truncateAndReinject ports modify.py:208 — collapse history to task anchor + compact file-state snapshot. describeUnresolved turns suggestion/not_found/ambiguous into model feedback. All collaborators injected (ModelEditStep, WriteFilesTool, PlanValidator). 5 tests. --> The multi-file loop tracks `completedChangesPerFile`, an `attemptCount` per edit, and a `visitedSet` of emitted tool-call hashes. On repeated/failed edits: escalate model after N attempts (e.g. Anthropic API → a stronger model or Claude CLI), and **skip the sub-task rather than loop forever** (hard give-up logged to the audit trail). When a per-file sub-task completes, **truncate the conversation history and re-inject the current file state** (port `modify.py:208`) — this is how sweep keeps multi-file edits inside the context/cost budget; directly relevant to our cost tracking.
- [~] **T-703 — Full action-card UI.** <!-- deferred 2026-05-30: IDE-runtime-gated (JBCef/VS Code webview rendering of all card types + badges). Core emits the halt/progress/audit intents these cards render; lands in the IDE-layer sprint, not this pure-core PR. --> Implement all card types from PLAN.md §8.8.1 with all three badge slots (Diff-Stats, Numeric Counter, Status-Dot). Cards: Thought / Terminal (still naive-pipe — PTY is Sprint 9) / Read File / Glob-Search / Created/Edited/Deleted File / Skill Invocation / MCP Tool Call / Web Fetch / Permission Request / Halt / Cost Footer / Correction.
- [~] **T-704 — Inline-editable permission scope.** <!-- deferred 2026-05-30: IDE-runtime-gated (inline scope-editor widget in the permission card). Pure-core permission model already exists (MVP T-304); the editable UI lands in the IDE-layer sprint. --> Permission-card from MVP T-304 gains the inline scope-editor per PLAN.md §8.8.11. Fields: pattern (glob-editable), working-dir, time-scope dropdown, args-allowlist. Allow/Always/Deny buttons read the (possibly-edited) scope before persisting.
- [x] **T-705 — Pre-flight cost estimate.** <!-- done 2026-05-30: cost/estimate.ts. estimateCost(book, input) → CostRange{lowerUsd,upperUsd,typicalUsd}: lower = full cache-hit (input @ cache_read rate) + minOutput; upper = cache-miss (full input + cache_write) + maxOutput; typical = input blended by typicalCacheHitRatio (default 0.5) + mid output. formatEstimate renders "Context: ≈14,238 tok · Est. cost: $0.02 – $0.12 (~$0.04 typical)" via toLocaleString('en-US'); usd() picks 4 decimals < $1 else 2. 6 tests. Composer-footer UI is IDE-gated. --> `packages/core/src/cost/estimate.ts` produces a Range estimate per PLAN.md §14.3: lower-bound (min-output + cache-hit), upper-bound (max-output + cache-miss). UI shows `Context: ≈14,238 tok · Est. cost: $0.02 – $0.12 (~$0.04 typical)`. Hover-tooltip: "±15-30% drift normal. Realer Cost siehe Step-Footer."
- [x] **T-706 — Reconciliation logging.** <!-- done 2026-05-30: cost/reconcile.ts. CalibrationLog.reconcile({conversationId,estimate,realUsd}) — logs only when realUsd > upperUsd × DRIFT_THRESHOLD (1.5; strict >, so exactly-threshold does NOT log), appends a zod-validated CalibrationEvent to date-rotated calibration-event-<YYYY-MM-DD>.jsonl, returns the event (else undefined). Injectable now() clock drives the date rotation; readDay(date) reads back. drift_ratio = real/upper. 4 tests. Cost-Dashboard "Calibration drift" KPI is T-707 (IDE-gated). --> Every completed turn: compare real cost vs estimated Range. If real > upper-bound × 1.5, write a `calibration-event-<date>.jsonl` row with the inputs and outputs. Drift is signal for heuristic improvement, not a regression — surface in Cost Dashboard as a "Calibration drift" KPI for v1.5+ improvement.
- [~] **T-707 — Cost Dashboard v0.** <!-- deferred 2026-05-30: IDE-runtime-gated (JBCef + VS Code webview Preact widgets). Backend data already exists: tracking/db.ts step events (MVP T-408) + cost/reconcile.ts calibration drift (T-706). Dashboard rendering lands in the IDE-layer sprint. BACKEND NOW LIVE 2026-06-02 (feat/v1-0-live-step-tracking, ADR-035): the data was built but never recorded — nothing constructed a TrackingDb in the dispatcher and no live turn wrote a step row. Now `buildCoreDispatcher` constructs one TrackingDb under `<state>/tracking`; both ChatHandler (`activity:'chat'`) and AgentTurnHandler (`activity:'agent'`, aggregated usage) persist ONE priced StepEvent per turn via an injected `StepRecorder`, recorded at the same exactly-once finalize point as recordSpend (errored→never, cancelled→partial-once, skipped without a pricing book / known model). A new `costReport` protocol method (DefaultCostReporter over TrackingDb.readSteps + summarizeShadowCost) returns the aggregate the widgets draw: totalUsd, byActivity/byMode/byModel, CLI-only shadowApiUsd. AI council (codex+gemini) UNANIMOUS Q0–Q7 all A. +22 tests (core 1020/1 skip, protocol 45); codegen 48→50 DTOs (Map<String,Double>); jetbrains:check green. The JBCef/VS Code Preact widget render stays IDE → still `[~]`. --> Tool-Window tab "📊 Usage" per PLAN.md §14.7. Widgets: Daily Token Consumption (line) · Consumption by Resource (donut) · Daily Stacked by Model (stacked bar) · Consumption by Activity (donut) · Consumption by Mode (donut, API vs CLI) · Top Conversations (table) · Quota Status (progress bars). Render in JBCef-webview + VS Code webview using same Preact code from `packages/shared/ui/`.
- [~] **T-708 — Trace replay v0.** <!-- deferred 2026-05-30: IDE-runtime-gated (conversation-menu action + step slider UI). Foundation data (run-<id>.jsonl) is a core concern but the replay widget is IDE-layer; cut to v1.5 per the sprint's "If blocked" note. --> Conversation menu has "Replay last run." Reads `agents/runtime/state/run-<id>.jsonl` and renders a step-by-step slider with cost accumulator. Foundation for v1.5 trace-share.

**Baseline (P50):** 3 weeks. **If blocked:** Cut T-704 (inline scope) to Sprint 13 (UX polish). Cut T-708 (trace replay) to v1.5. T-702c (escalation/history-truncation) can slip to Sprint 13 if the loop proves stable without it. Minimum: T-701, T-702, T-702b (locate + delta-gating are what make multi-file edit usable, not optional), T-703, T-705, T-707.

### Exit gate — Phase 7 exit criteria

> **Status 2026-05-30:** Pure-core engine landed (T-701, T-702, T-702b, T-702c, T-705, T-706 — 60 unit tests). All four exit criteria below are end-to-end and IDE-runtime-gated (bulk-diff card, action-card UI, composer footer, dashboard tab); they clear once the IDE-layer sprint wires the core engine to the JetBrains/VS Code surfaces. Same pattern as the Phase 5/6/8 exit gates.

- [~] User asks for a 3-file refactor — multi-step loop runs through plan → implement → verify; user accepts a bulk-diff card. <!-- core: AgentDriver + EditLoop + WriteFilesTool exercised in unit tests; full E2E needs the IDE bulk-diff card. -->
- [~] Action-card UI shows all badges across all card types. <!-- IDE-runtime-gated (T-703). -->
- [~] Pre-flight estimate range visible before every send. <!-- core: estimateCost/formatEstimate done (T-705); composer-footer rendering is IDE-gated. -->
- [~] Cost Dashboard tab opens, shows real data from MVP+Sprint 5+6 usage. <!-- IDE-runtime-gated (T-707). -->

---

## Phase 8 — Context Engine v1: Embeddings + hybrid retrieval (2-3 weeks, moved up)

> **Goal.** Vector embeddings on top of BM25. Hybrid retrieval (BM25 + vector) with RRF + local cross-encoder rerank. Quality jump over Sprint 6.
>
> **Dependencies.** Sprint 6 (BM25 lives, walker + parser solid).

- [x] **T-801 — Embedder.** `@xenova/transformers` ONNX runtime, default model BGE-small-en-v1.5 or MiniLM. Worker pool — embedding is CPU-heavy, must not block UI. Chunk strategy: tree-sitter respects function boundaries up to ~512 tokens per chunk.
- [x] **T-802 — Vector store.** `sqlite-vec` extension to the existing `tracking.db` or a separate `index.db`. Schema: `chunks(id, file, range_start, range_end, embedding BLOB)`. Cosine-similarity query API.
- [x] **T-803 — Hybrid retrieval (weighted fusion + multi-query RRF).** `packages/core/src/context/hybrid.ts`. **Snippet-level fusion** uses SweepAI's tuned formula (`ticket_utils.py:181`), not plain RRF: per snippet with `lexicalScore`/`vectorScore`, `score = (lexical + VECTOR_WEIGHT*vector)/(VECTOR_WEIGHT+1)` with `VECTOR_WEIGHT=2` **if there is a lexical hit**, else `score = 0.02*vector` — i.e. lexical presence is a gate, a no-lexical-match snippet is heavily penalized. Then apply the T-603 digit-penalty + type-bucket cutoffs. **Multi-query** (port `multi_query.py`): a cheap LLM call expands the user query into ~10 diverse "Where is…" sub-queries; each sub-query's ranked list is merged via **Reciprocal Rank Fusion** `score += perQueryScore * (1 / 2^rank)`. Keep top-K (K=20 default). (Treat sweep's weights as a *starting point* fine-tuned on their 50-case 2024 benchmark — re-benchmark on our corpus, eval set in `agents/analysis/retrieval-eval/`.)
- [x] **T-804 — Rerank (frozen-top-5 trick).** Local cross-encoder `ms-marco-MiniLM-L-6-v2` (ONNX, ~50MB) — OR an LLM listwise pass via the Anthropic backend. Port SweepAI's **frozen-top-5** optimization (`ticket_utils.py:221`): ranks 1–5 are already high-confidence — freeze them (never demote), only rerank ranks 6..N and slot them below the frozen head. Saves rerank cost and stops the reranker from hurting precision on the easy hits. Replace top-K with the reranked top-10.
- [x] **T-805 — Incremental re-embedding + content-hash cache.** The core efficiency win for an IDE sidecar (`search-infra.mdx` / `vector_db.py:205`): **no offline index rebuild** — embeddings are cached by `sha256(chunkText)+CACHE_VERSION` in a local KV (sqlite/lmdb), and on any file save only the *changed* chunks miss the cache and get re-embedded (~1% of files per edit). On file save: re-chunk (T-602) + re-embed only cache-missed chunks. Test: edit 50 lines in a 2000-line file, re-embed completes <2s.
- [x] **T-806 — Optional remote embedding.** Toggle in `.agent-settings.yml::context.embeddings.provider` between `local` (default) and `voyage` / `openai` (remote, requires API key). Remote embeddings respect Hard Caps (each embedding call counted as a step event with `activity: "context-compression"`).

**Baseline (P50):** 2 weeks. **If blocked (ONNX runtime fights you on a platform):** Skip T-806 (remote embedding) to Sprint 13. Minimum: T-801 to T-805 with local embedding.

> **Implementation note (2026-05-30, council-driven — codex/gpt-5 + gemini-2.5-pro).** The shipped design deviates from the SweepAI-derived wording above, on both members' advice; the roadmap already licensed this ("treat sweep's weights as a starting point — re-benchmark"):
> - **T-802 vector store** is **pure-TS** (in-memory brute-force cosine over L2-normalized Float32, compact Buffer persistence) — **not** `sqlite-vec`. The CI matrix includes Node 20 (no `node:sqlite`) and `sqlite-vec` is native; this matches the project's no-native-deps precedent (token-tracking JSONL). Brute-force is sub-30ms to ~300–500k chunks; ANN is a later-phase upgrade.
> - **T-801 embedder** uses `@huggingface/transformers` (successor to `@xenova/transformers`) loaded **lazily as an optional dep** (native onnxruntime + sharp), behind an injectable `Embedder` interface. The unit suite runs on a deterministic `FakeEmbedder`; the real model is a gated integration test. `RemoteEmbedder` (T-806) is the no-native fetch alternative.
> - **T-803 fusion** uses **Reciprocal Rank Fusion** (`1/(k+rank)`, k=60), **not** the `(lex+2·vec)/3` weighted formula or the `0.02·vec` lexical gate (mixes incompatible scales; gate kills semantic-only recall) and **not** `1/2^rank` (not RRF). Common unit = chunk (symbol hits mapped to containing chunk).
> - **T-804 rerank** is a global rerank over the fused head via an injectable `Reranker` (default identity); **frozen-top-5 dropped** for v0 (hurts on noisy code retrieval).

### Exit gate — Phase 8 exit criteria

- [~] Quality test: 20 sample queries from MVP+Sprint 6 chat history get measurably better retrieval (manual evaluation against a held-out test set in `agents/analysis/retrieval-eval/`). <!-- manual: needs real model + corpus; harness + eval scaffold landed, see docs/MANUAL_VERIFICATION.md § Phase 8 -->
- [~] First-time index of a 20k-file Laravel repo completes <8 min including embeddings. <!-- manual: real-model perf, see docs/MANUAL_VERIFICATION.md § Phase 8 -->
- [~] Single-file save re-embeds <2s. <!-- manual: real-model wall-clock; content-hash cache logic unit-tested -->

---

## Phase 9 — Live PTY terminal + dual-surface sync (3 weeks, moved from S8)

> **Goal.** Real PTY-backed terminal in the chat card, with ANSI colour, spinner, elapsed-time, waiting-for-input detection (3 strategies per PLAN.md §8.9.3). VS-Code IDE-terminal sync via Pseudoterminal API. JetBrains IDE-terminal read-only mirror (full read/write deferred to v1.5 per Spike 0.3d outcome).

- [~] **T-901 — node-pty integration.** <!-- core 2026-05-31 (ADR-009): `terminal/pty.ts` ships the `Terminal` interface + deterministic `FakeTerminal` + a gated dynamic-import `loadNodePtyTerminal` (env `EVENT4U_ENABLE_PTY`, string-specifier so tsc never resolves the absent native pkg — Phase-8 ONNX playbook). The real binding + the 6-arch prebuild matrix are native → deferred (off the no-native-deps default graph). --> `packages/core/src/terminal/pty.ts` wraps `node-pty` IPty instances per command. Prebuilds for 6 architectures (darwin-x64 + arm64, linux-x64 + arm64, win32-x64 + arm64). CI matrix verifies each prebuild loads.
- [x] **T-902 — TerminalSessionManager.** `Map<commandId, TerminalSession>` per PLAN.md §8.9.2. RingBuffer for last 5000 lines (10 MB cap). FIFO input queue. Reconnect-after-IDE-restart works: sidecar survives, on plugin reconnect the card renders current state.
- [x] **T-903 — JSON-RPC terminal events.** Schema from PLAN.md §8.10: `terminal.output`, `terminal.status`, `terminal.input`, `terminal.subscribe` (with `replayFromSeq` for reconnect).
- [ ] **T-904 — xterm.js renderer in chat cards.** Both surfaces (JBCef-webview for JetBrains, VS Code webview for VS Code) host xterm.js + ANSI parser. Status bar in card shows: command preview, elapsed time, spinner during run, `🔗 synced w/ IDE Terminal` pill when bridged.
- [~] **T-905 — Waiting-for-input detection (3 strategies).** <!-- core 2026-05-31 (ADR-009): `terminal/waiting-input.ts` ships strategy (a) heuristic regex over the ANSI-stripped tail + strategy (c) 800ms idle-timeout confirm + the read-idle hook for strategy (b) on the Terminal interface, all unit-tested. The tentative/solid BANNER is the IDE renderer → deferred with T-904. --> Per PLAN.md §8.9.3: heuristic regex (last 200 bytes) + PTY stdin-readiness (node-pty hook) + idle-timeout (800ms). UI flow: tentative banner first ("possibly waiting"), bestätigt-banner after idle confirms.
- [~] **T-906 — Inline input card.** <!-- core 2026-05-31 (ADR-009): the first-write-wins-per-`inputRequestId` arbitration + `inputConflict` event ship in `terminal/manager.ts` (unit-tested). The input FIELD + the conflict toast are the IDE renderer → deferred with T-904. --> When waiting-for-input fires, an input field appears in the card. Send writes to the PTY's stdin. First-write-wins on conflict; later surfaces see toast "Input already submitted from <surface>".
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
- [ ] **T-1002 — Diff-accept shortcuts.** <!-- data layer landed 2026-06-01 (ADR-020): the per-suggestion state machine these shortcuts drive is core — Message.annotations `code-suggestion` member + packages/core/src/agent/suggestions.ts (transitionCodeSuggestion reducer pending|processing|done|error, buildCodeSuggestions over WriteFilesPlan). The shortcuts + diff-gutter render stay IDE; route accept→start/complete, reject→fail through the reducer. --> Per PLAN.md §3.5.4 SweepAI shortcuts: `Cmd+Y` accept single, `Cmd+N` reject single, `Cmd+Enter` accept-all-in-file, `Cmd+Shift+Backspace` reject-all. Implement for both IDEs. Resolve Sweep's `Cmd+N` conflict (Sweep uses `Cmd+N` for both "new chat" and "reject" — we use `Cmd+J` for new chat, `Cmd+N` for reject).
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

- [x] **T-1101 — MCP Client.** <!-- done 2026-05-30: packages/core/src/mcp/ — protocol.ts (zod JSON-RPC + MCP tool/result schemas, contentToText), transport.ts (McpTransport seam + StdioTransport spawning NDJSON over stdio, reusing llm/ndjson.ts), fake-transport.ts (deterministic in-memory test transport), client.ts (McpClient: initialize handshake + notifications/initialized, listTools, callTool, id-correlated requests, bounded init/request timeouts, fail-open markDead rejecting in-flight on transport death), registry.ts (McpToolRegistry: aggregate clients keyed by server-id, prefix `<server-id>:<tool>`, route callTool, map to ToolDefinition), manager.ts (McpManager: reads mcp.servers[], spawns+connects each fail-open, per-server degrade, dispose). agent-settings.ts gained mcp.servers schema (id rejects ':'). HAND-ROLLED, no @modelcontextprotocol/sdk → ADR-006 (no-native-deps law + ADR-003 NDJSON precedent; council codex/gpt-5.5+gemini-2.5-pro split, gemini direct). 25 mcp tests + 3 settings tests, full core suite 506 pass, task ci green. --> Hand-rolled minimal MCP stdio client (ADR-006, not `@modelcontextprotocol/sdk`). Reads `.agent-settings.yml::mcp.servers[]`, spawns each as subprocess, manages JSON-RPC connection. Tool registry includes MCP tools with prefix `<server-id>:<tool-name>`.
- [x] **T-1102 — agent-config MCP server consumption.** <!-- done 2026-05-30: packages/core/src/mcp/agent-config-client.ts — AgentConfigMcpClient typed convenience over McpClient (memoryLookup, chatHistoryRead, listSkills, skillRead, commandRead → flattened {text,isError}); DEFAULT_AGENT_CONFIG_SERVER = {id:'agent-config', command:'npx', args:['@event4u/agent-config','mcp']}. 3 tests with FakeTransport echo responder. The live connection at runtime is wired into the dispatcher in the IDE-runtime exit gate. --> Connect to the agent-config-shipped MCP server (`npx @event4u/agent-config mcp`). Use its tools (`memory_lookup`, `chat_history_read`, `list_skills`, `skill_read`, `command_read`) instead of our own filesystem readers for skill/rule/command content.
- [~] **T-1103 — All 136 commands callable.** <!-- core done 2026-05-30: packages/core/src/commands/loader.ts loadCommandProcedure(name, {mcp?, localNodes}) — prefers agent-config MCP command_read, falls back to local walker body, reports missing; 5 tests. [~] not [x]: the slash-picker overlay rendering all commands + the actual invocation UX are webview/IDE-runtime surfaces (the picker filter pure-fn already exists from T-402); they bind to this loader but need a GUI session to verify. --> Slash-picker shows all commands from the agent-config tree (filtered by user-set favourites if Phase 0 Spike 0.5 recommended favourites). Each command's procedure is loaded via the MCP `command_read` tool at invocation time.
- [x] **T-1104 — Memories — local.** <!-- done 2026-05-30: packages/core/src/memory/local.ts — LocalMemoryStore over `.event4u-agent/memories/` in Markdown+YAML-frontmatter (name/description/metadata.type) + regenerated MEMORY.md index, NOT JSON: the roadmap's "JSON" wording yields to the real agent-config on-disk contract per ADR-006 (council unanimous). list/read/write/delete/regenerateIndex + serializeRecord; reads agent-config-authored files for external compat; kebab-name validation. 8 tests. --> `packages/core/src/memory/local.ts` reads/writes `.event4u-agent/memories/` in agent-config's md+frontmatter+MEMORY.md format (ADR-006, not JSON). Two memory types in MVP: `user` (long-lived) and `feedback` (workflow corrections).
- [x] **T-1105 — Memories — MCP backend.** <!-- done 2026-05-30: packages/core/src/memory/backend.ts — MemoryBackend iface; LocalMemoryBackend (filterRecords over the store), McpMemoryBackend (memory_lookup/memory_write via McpClient + best-effort parseMcpRecords), RoutingMemoryBackend (MCP-first lookup with local fallback on throw; writes always mirror locally so a later outage still serves). 9 tests. --> Optional: if `@event4u/agent-memory` MCP server configured, route memory_lookup/memory_write calls there. Local fallback if MCP server unreachable.
- [x] **T-1106 — Hooks.** <!-- done 2026-05-30: packages/core/src/hooks/runner.ts — runHook(name, opts) runs agents/runtime/hooks/{sessionStart,sessionEnd,Stop}.sh, sets EVENT4U_AGENT_HOOK + merged env, classifies exit 0=ok / 2=block / other|timeout=error, missing script=skipped no-op, never throws. ProcessRunner spawn seam is injectable (Windows CI has no bash); 9 unit tests via fake runner + real-bash integration tests skipIf(win32). --> `agents/runtime/hooks/sessionStart.sh`, `sessionEnd.sh`, `Stop.sh` executed at lifecycle points. Compatible with agent-config hook system (same env vars, same exit code semantics).

**Baseline (P50):** 3 weeks. **If blocked (MCP SDK fights you):** Local memory only (T-1104), MCP work to Sprint 13. Hooks (T-1106) are independent.

### Exit gate — Phase 11 exit criteria

- [~] User adds a GitHub MCP server to `.agent-settings.yml`; tools appear in chat with `github:` prefix. <!-- core verified 2026-05-30: settings→manager→registry→prefixed ToolDefinition path is unit-tested (manager.test.ts aggregates a:a_tool/b:b_tool); "appear in chat" is the dispatcher-wiring + webview render, IDE-runtime-gated. -->
- [~] All 136 agent-config commands invocable. <!-- core verified 2026-05-30: loadCommandProcedure resolves MCP-or-local bodies; the picker overlay + invocation are webview/IDE-runtime. -->
- [~] Memory created in one session, recalled in the next. <!-- core verified 2026-05-30: LocalMemoryStore + RoutingMemoryBackend round-trip is unit-tested; cross-session recall through the live chat is IDE-runtime-gated. -->
- [~] sessionStart hook fires when chat opens. <!-- core verified 2026-05-30: runHook fires + classifies exit codes (unit + real-bash integration); "when chat opens" is the lifecycle wiring in the dispatcher/clients, IDE-runtime-gated. -->

---

## Phase 12 — Per-CLI gear panel + Unified Session Browser (2 weeks)

> **Goal.** The per-CLI controls panel (PLAN.md §9.11) and session browser (§9.13) ship. Settings render adapts per CLI capability manifest. User can browse + resume sessions across all 4 sources (plugin-API, claude-CLI, codex-CLI, gemini-CLI).

- [ ] **T-1201 — Capability-manifest renderer.** Reads the manifest of the currently-selected CLI, renders the gear panel inline (auto-modes radio group, slash-commands as buttons, permission-modes dropdown, etc.).
- [x] **T-1202 — Session adapter per CLI.** `packages/core/src/sessions/adapters/{claude,codex,gemini,aider}.ts` (+ `api`). Each adapter knows the CLI's session-file location + format. Returns `SessionSummary` per PLAN.md §9.13.1. <!-- Core DONE: 5 adapters (api/claude/codex/gemini/aider) as lossy fail-open importers, shared JSONL scan mechanics, source-scoped ids, separate diagnostics, explicit `origin` provenance field. AI-council (codex+gemini, 2026-05-30) on the design. 51 new tests. -->
- [ ] **T-1203 — Unified Session Browser overlay.** Click `📚 Sessions` button (top-right in chat header). Overlay renders all sessions across sources, grouped by date, filterable by source + provider + search. Per PLAN.md §9.13.2 mockup. <!-- IDE/UI-gated; core view helpers (filterSessions/groupSessionsByRecency/SessionBrowser) shipped for it to consume. -->
- [~] **T-1204 — Chokidar watcher for live detection.** Watches `~/.claude/projects/**/sessions/`, `~/.codex/sessions/`, `~/.gemini/sessions/` for new files. "Active now" section shows live sessions. <!-- Core DONE: injectable SessionWatcher + chokidar impl + FakeWatcher + path→source resolution + mtime-window active detection (markActiveSessions). "Active now" rendering is client-side (UI-gated). -->
- [~] **T-1205 — Resume logic per source.** Plugin-API: load conversation JSON, render messages. CLI: spawn `<binary> --resume <id>` as subprocess, attach the chat UI to it. <!-- Core DONE: per-source loadMessages parse (api JSON, claude/codex JSONL, gemini JSON+JSONL, aider md). Subprocess spawn + chat-UI attach are IDE-runtime-gated. -->
- [~] **T-1206 — "External sessions detected" onboarding.** First-run: scan finds existing CLI sessions outside the plugin. Show consent dialog: "Show external sessions in browser? [Yes / No / Configure per-CLI]." <!-- Core DONE: SessionProvenanceIndex classifies plugin/external/unknown via the plugin session-index; external scan surfaces them. Consent dialog is UI-gated. -->

> **Phase 12 status (2026-05-30):** pure-**core** of the Unified Session Browser landed on `feat/road-to-v1-0-sessions` (`packages/core/src/sessions/`). T-1202 `[x]`; T-1204/1205/1206 `[~]` (core done, only IDE/UI surfacing left); T-1201 + T-1203 + the exit gate stay `[ ]` (IDE-runtime). Same core-first split as Phases 7/11.

**Baseline (P50):** 2 weeks. **If blocked:** Ship only claude-CLI session browser + plugin-API sessions (T-1202 partial, T-1203, T-1205 partial). Codex+Gemini session browsers to Sprint 13.

### Exit gate — Phase 12 exit criteria

- [ ] Gear icon click opens panel with claude-specific controls; switch to codex CLI → panel renders codex-specific controls.
- [ ] Session browser shows all sessions across all 4 sources.
- [ ] Resume a claude-CLI session started outside the plugin (via raw `claude` in terminal).

---

## Phase 13 — UX polish + late-arriving items (3 weeks)

> **Goal.** Everything that slipped from Sprints 5-12 lands here, plus persisted history, conversation forking, checkpoints, statusbar polish, abortable streaming refinements.

- [~] **T-1301 — Persisted chat history.** <!-- core done 2026-05-31: packages/core/src/chat/ — append-only JSONL event log per conversation (created/message/checkpoint/meta events) under .event4u-agent/chats/<id>.jsonl, folded fail-open (tolerates torn trailing lines); ConversationStore (InMemory+File) with create/appendMessage/load/list; token-AND searchConversations across title+bodies, ranked recency-then-hits. 45 new tests. The left-sidebar conversation list + click-to-open + search box are IDE surfaces (T-1301 stays [~]). ADR-008. --> Conversation list in left sidebar of tool-window. Click opens past conversation. Search across history. Stored under `.event4u-agent/chats/` per workspace.
- [~] **T-1302 — Conversation forking.** <!-- core done 2026-05-31: ConversationStore.fork(id, atTurnIndex, {editedUserMessage}) — copy-on-write new conversation id with parentId + forkedFromTurnIndex, replays the kept prefix as fresh events, leaves the parent untouched; turn index clamped to the available prefix. The edit-a-past-message affordance is the IDE surface. --> Editing a past user message creates a fork — original conversation kept, branch starts from the edited turn.
- [~] **T-1303 — Checkpoints.** <!-- core done 2026-05-31: ConversationStore.recordCheckpoint (metadata only — phase, turnIndex, changedFiles manifest, opaque workState snapshot; no file blobs, retention-capped at fold) + planRewind (pure, non-mutating: returns messagesToKeep/Drop + changedFiles + workState + warnings). Core has no file-restore authority — the IDE consumes the plan and restores files via its own VCS/undo. The auto-checkpoint trigger lives at the AgentDriver phase boundary (IDE-wired); the rewind button is the IDE surface. ADR-008. --> Multi-step agent runs auto-checkpoint at phase boundaries. User can "rewind to checkpoint" — restores conversation state + file state.
- [ ] **T-1304 — Statusbar widget — index status.** "Indexing 4,238 / 21,500 files…" or "Index ready · 21k files · last update 2m ago."
- [~] **T-1305 — Abortable streaming refinements.** <!-- core done 2026-05-31: packages/core/src/abort.ts (throwIfAborted + isAbortError) threads the existing CancellationToken.signal through the three operations that previously ignored it — embedding (Embedder/RemoteEmbedder/EmbeddingCache + ContextEngine.indexFile/hybridRetrieve, fetch-signal + cache-miss forward), MCP tool calls (McpClient request-scoped abort listener rejecting only that pending via shared settle(); registry callTool/callToolText), and session scans (SessionAdapter + scanJsonlSource per-file check + all 5 adapters; SessionBrowser RE-THROWS aborts instead of degrading them to a diagnostic). Trailing optional `signal?` (matches stream(request,signal?)); abort → AbortError reject. ADR-018. AI council (codex-cli 0.134.0 + gemini 0.41.2) UNANIMOUS B1/C1/D1/E1/F, split A→A1. 13 new tests, core 832 pass/1 skip, task ci green. [~] not [x]: the Stop button + ESC binding are IDE surfaces. --> Stop button works during embedding, during MCP tool call, during external-session-watcher.
- [ ] **T-1306 — Pull-up slot.** Any T-XXX items deferred from Sprints 5-12 (gear panel for codex/gemini if cut from S12, T-704 inline scope if cut from S7, etc.) land here.
- [~] **T-1307 — Workspace Guidelines.** <!-- core done 2026-05-31: packages/core/src/guidelines/ — GuidelinesStore (InMemory+File) load/save of .event4u-agent/guidelines.md (fail-open: missing file → ''), composeSystemPrompt(base, guidelines) prepends a delimited <workspace-guidelines> block ahead of the base system prompt, size-capped to 16KB with a truncation marker so an accidental huge paste can't blow up every request. 8 new tests. The editor UI + wiring composeSystemPrompt into the live request builder are IDE surfaces (stays [~]). --> <!-- wiring landed 2026-06-01 (ADR-024, PR #36): the LIVE-request half is now DONE — a shared chat/system-prompt.ts resolveSystemPrompt(base, load) folds guidelines into BOTH the ChatHandler (chatSend) and AgentTurnHandler (agentTurn) system prompt, fresh per turn, fail-open, composed before the cost estimate so it counts once; buildCoreDispatcher injects a FileGuidelinesStore. AI council UNANIMOUS A2/B1/C2/D1/E1/F1. 15 new tests. ONLY the guidelines EDITOR UI remains → stays [~]. --> Editable `.event4u-agent/guidelines.md` per workspace — content is prepended to system prompt (Augment-style + agent-config rule-compat).
- [~] **T-1308 — Context display sidebar (SweepAI ContextSideBar pattern).** <!-- core done 2026-06-01: the Message.annotations wire contract + the context-snippet data the sidebar renders off. packages/protocol/src/schema.ts — Annotation discriminated union (single context-snippet member, kind-tagged → Kotlin sealed class) + ContextSnippetAnnotation {rootId,filePath,startLine,endLine,relevance 0..1,category,preview} + SnippetCategory enum. packages/core/src/context/annotations.ts — classifySnippet (path heuristics: dependency>test>docs>source) + buildContextSnippets (pure: min-max relevance normalize [single/all-equal→1], bounded preview ≤8 lines/400 chars, 1:1 score-preserving, drops unresolved refs). ContextEngine gained additive hybridRetrieveScored (keeps RRF score, hybridRetrieve unchanged), single-ref snippetForChunk (no merge), and retrieveContextSnippets end-to-end. Realizes road-to-mvp-ui-design § Data + render contract. 19 new tests, core 847 pass/1 skip, task ci + jetbrains:check green. ADR-019. AI council (codex-cli + gemini-cli) UNANIMOUS A1/C1/E1/F2, split B→B1 (additive), split D→D1 (normalized-only). [~] not [x]: the SnippetBadge render (opacity/colour/range/hover/remove), snippet-search add, click-to-open, and wiring annotations into the live chat turn are IDE surfaces. --> Now that the Context Engine (Phase 6/8) retrieves snippets, the user needs to *see and manage* what is in context. Port SweepAI's `ContextSideBar` + `SnippetBadge` UX (`sweep_chat/components/shared/`): a panel listing the current-turn context snippets, each rendered as a badge with **score→opacity** (faded = lower relevance), **type→colour** (source/test/docs/dependency), path basename + `:start-end` range, a hover-preview of the slice, and a remove affordance. A search input streams a retrieval query and lets the user explicitly add a result snippet (set its score to 1). Snippets render off the `Message.annotations` contract (`road-to-mvp-ui-design.md` § Data + render contract). IDE-local: clicking a badge opens the file at the line range (not a GitHub blob URL). Both surfaces.

**Baseline (P50):** 3 weeks (this sprint absorbs slip).

### Exit gate — Phase 13 exit criteria

- [ ] Persisted history works across IDE restarts.
- [ ] Conversation forking + checkpoints visible in UI.
- [ ] All deferred T-XXX from earlier sprints landed or explicitly punted to v1.5.

> **Phase 13 status (2026-05-31):** the pure-**core** of the chat-state cluster
> landed on `feat/road-to-v1-0-phase-13` — `packages/core/src/chat/` (persisted
> history T-1301, copy-on-write forking T-1302, metadata-only checkpoints +
> non-mutating rewind plan T-1303) and `packages/core/src/guidelines/`
> (workspace guidelines T-1307). 53 new unit tests; full core suite 642 pass /
> 1 skipped. Design ratified by AI council (codex/gpt-5.5 + gemini-2.5-pro):
> append-only JSONL event log over a rewritten doc, fork is copy-on-write (never
> an in-file branch tree), checkpoints are metadata + a rewind *plan* (core has
> no file-restore authority — the IDE restores via its own VCS/undo), token-AND
> search over BM25 coupling for the first slice. **ADR-008** records the design.
> T-1301/1302/1303/1307 stay `[~]` — the sidebar list, fork affordance, rewind
> button, guidelines editor, and the auto-checkpoint AgentDriver wiring are IDE
> surfaces. T-1304/1305/1306/1308 + the exit gate stay `[ ]` (IDE-runtime).
>
> **Annotations contract — second member landed (2026-06-01).** Following the
> `context-snippet` member (T-1308 / ADR-019), the `Message.annotations` union
> gained its **`code-suggestion`** member: the SweepAI `CodeMirrorSuggestionEditor`
> per-edit state machine (`pending|processing|done|error`). Pure-core only —
> `packages/protocol/src/schema.ts` (`CodeSuggestionAnnotation` + flat-enum
> `CodeSuggestionState`, codegen'd to a Kotlin sealed-union variant) +
> `packages/core/src/agent/suggestions.ts` (`buildCodeSuggestions` over the
> existing `WriteFilesPlan` edit seam; pure `transitionCodeSuggestion` reducer
> owning the state invariant; no-op on invalid/terminal edges). 12 new core tests,
> core 859 pass/1 skip, `task ci` + `jetbrains:check` green. ADR-020. AI council
> (codex-cli + gemini-cli) UNANIMOUS A1/C1/D1/E1/F1/G1, split B→B1 (flat enum over
> a nested sub-union). This pre-builds the data layer for **Phase 10 inline-edit
> diff-accept (T-1001/T-1002)** — the editor render + per-suggestion stage/apply
> affordance stay IDE-deferred, so no checkbox flips. The third forward-pointed
> member (`status-row` progress strings) is deferred to its own slice.
>
> **Annotations contract — third (final forward-pointed) member landed
> (2026-06-01).** The `Message.annotations` union gained its **`status-row`**
> member: the SweepAI "progress strings are first-class stream items" surface —
> one row per long-operation step (an agent pipeline phase, or a non-phase op
> such as background indexing) with a `pending|active|done|error` lifecycle.
> Pure-core only — `packages/protocol/src/schema.ts` (`StatusRowAnnotation` +
> flat-enum `StatusRowState` + optional `StatusRowPhase`, codegen'd to a Kotlin
> sealed-union variant) + `packages/core/src/agent/status-rows.ts`
> (`buildStatusRows` generic descriptor builder, `statusRowsForMode` convenience
> over `DirectiveSet.phases`, pure `transitionStatusRow` reducer owning the
> lifecycle invariant; no-op on invalid/terminal edges). 19 new core tests + 3
> protocol tests, core 878 pass/1 skip, `task ci`-equivalent + `jetbrains:check`
> green. ADR-021. AI council (codex-cli + gemini-cli) UNANIMOUS A1/C1/D1/E1/F1,
> split B (codex B1 phase-bound / gemini B2 generic) resolved to a synthesis —
> generic builder + mode-aware wrapper + optional `phase`, which addresses the
> reconciliation/indexing trap both reviewers flagged. This pre-builds the data
> layer for the **C-9 status surface** and **T-1304 index statusbar** — the
> progress-bar/spinner render + live AgentDriver phase-boundary streaming stay
> IDE-deferred, so no checkbox flips. The `Message.annotations` contract now
> carries all three forward-pointed members (context-snippet · code-suggestion ·
> status-row).

---

## Phase 14 — Pricing Book signing + Telemetry + Docs (3 weeks)

> **Goal.** Ship-readiness for internal beta. Pricing Book Sigstore signature lands. Telemetry opt-in lands. Full documentation pass.

- [x] **T-1401 — Pricing Book Sigstore signature.** <!-- done 2026-05-31: pricing/verify.ts — verifyPricingSignature (Node-crypto Ed25519 detached, pure/offline, zero-dep, typed failure reasons) + priceDropGuard (per-model input/output >50% drop) + resolvePricing orchestrator (fail-open to bundled baseline on parse-error / invalid-or-missing signature / blocked drop). pricing-pubkey.pem bundled (placeholder until T-1402 release key; private key never committed). loadBundledPublicKey fail-open. 17 tests (ephemeral keypairs). ADR-007 records Ed25519-over-Sigstore-for-v0 + separation-of-concerns; AI council codex/gpt-5.5+gemini-2.5-pro UNANIMOUS. The >50%-drop hard-block CONFIRM DIALOG is the IDE surface; Sigstore/SLSA bundle is T-1402. --> `packages/core/src/pricing/verify.ts` validates `prices.yml` against a public key shipped in the plugin. On signature mismatch: fall back to plugin-bundled baseline pricing. Hard-block dialog if new pricing has >50% drop vs current — user must explicitly confirm.
- [ ] **T-1402 — Sigstore signing pipeline.** <!-- deferred 2026-05-31: needs a real release signing key + GitHub Actions secret + Sigstore/SLSA infra (not autonomously doable). T-1401 verify.ts is the drop-in consumer once the signed feed exists; per the sprint's "If blocked" note, T-1402 slips to Sprint 15. --> GitHub Actions workflow signs `prices.yml` on release. Public key committed to plugin repo. SLSA provenance attached to release artifact.
- [x] **T-1403 — Telemetry — engagement logs.** <!-- done 2026-05-31: telemetry/engagement.ts — opt-in createEngagementRecorder (NoOpEngagementRecorder when disabled = zero disk I/O; JsonlEngagementRecorder when enabled), .strict() EngagementEventSchema (kind enum skill/tool/command + name + optional outcome/duration_ms, NO free-text), recorder builds from an allowlist so a stray {prompt} never reaches the schema (dropped fail-open), date-rotated telemetry-YYYY-MM-DD.jsonl under .event4u-agent/telemetry/. telemetry/report.ts — aggregate + renderEngagementReport (top-N per kind, daily series, no-content footer) + exportEngagementReport. agent-settings.ts gained telemetry.artifact_engagement.enabled (default false). 18 tests. ADR-007 + AI council UNANIMOUS on the privacy floor. The Settings TOGGLE + `event4u: Export Telemetry Report` command invocation are IDE wiring. --> Opt-in via Settings (`telemetry.artifact_engagement.enabled`). Logs which skills/tools/commands invoked (no content, no prompts, no completions). Local-only JSONL under `.event4u-agent/telemetry/`. `event4u: Export Telemetry Report` command produces a markdown report.
- [x] **T-1404 — Subscription-cost approximation.** <!-- done 2026-05-31: cost/shadow.ts — shadowApiCostForStep (API-equivalent cost of one CLI step via PricingBook.costFor; 0 for unknown model, fail-open), summarizeShadowCost (sums CLI-mode steps only, excludes API-mode which has a real cost; per-model breakdown + unknownModels + date window), formatShadowCost ("Shadow API cost: $X.XX (would have cost on API)"). 6 tests. Pure compute over recorded StepEvents; the dashboard line render is IDE (T-707). --> CLI mode shows "Shadow API cost: $X.XX (would have cost on API)" alongside subscription quota usage. Per PLAN.md §14.5.
- [ ] **T-1405 — Docs — Quick Start.** <!-- deferred 2026-05-31: needs screenshots of every major surface, which requires a running IDE (not autonomously doable). Pairs with the IDE-runtime sprint that surfaces the webviews. --> `README.md`, `docs/quick-start.md`, screenshots of every major surface.
- [x] **T-1406 — Docs — Architecture.** <!-- done 2026-05-31: docs/architecture.md gained the "v1.0 core — shipped vs IDE-gated" section (per-area module map for Phases 5–14: multi-provider LLM, Context Engine, agent loop+edit, cost UX, MCP+memory+hooks, sessions, ship-readiness) + pricing table rows for verify.ts/pricing-pubkey.pem; the v1.0-deferrals note now distinguishes genuinely-deferred (T-1402 pipeline, node-pty PTY, Phase-10 IDE depth) from merely-unsurfaced. --> `docs/architecture.md` reflects shipped reality (vs PLAN.md's plan).
- [x] **T-1407 — Docs — Contributing.** <!-- done 2026-05-31: docs/contributing.md — layout, prerequisites, the `task ci` gate + per-piece commands, the 5 project laws (no-native-deps, fail-open, injectable seams, zod-at-boundaries, cross-platform paths) with ADR/gotcha citations, the core-first delivery pattern, commit/PR conventions, test expectations. --> `docs/contributing.md` for internal contributors.
- [x] **T-1408 — Docs — FAQ.** <!-- done 2026-05-31: docs/faq.md — Using (providers, CLI auth, shadow cost, telemetry privacy, pricing verify) + Developing (task-ci-green-but-CI-red causes incl. tsc-clobbers-bundle / Windows paths / Node-20 matrix, AI-council CLI usage, Windows-ARM node-pty, where-to-look). Seeded from the documented build gotchas; expands as real beta gotchas arrive. --> Common gotchas from internal beta — "Plugin doesn't start on Windows ARM", "CLI mode shows 'auth expired'", etc.
- [x] **T-1409 — ADR consolidation.** <!-- done 2026-05-31: ADR-007 (Pricing-Book signature Ed25519-over-Sigstore + telemetry privacy floor) authored; docs/adr/index.md row added. Index now lists ADR-001..007. --> All ADRs from Phase 0 + emerging decisions during MVP + v1.0 consolidated in `docs/adr/index.md`.

**Baseline (P50):** 3 weeks. **If blocked:** T-1402 (signing pipeline) to Sprint 15; Sprint 14 minimum is T-1401 + T-1403 + T-1405..T-1409.

> **Phase 14 status (2026-05-31):** pure-**core** of ship-readiness landed on
> `feat/road-to-v1-0-phase-14`. T-1401/1403/1404/1406/1407/1408/1409 `[x]`
> (verify + drop-guard + resolve, telemetry recorder + report + opt-in setting,
> shadow-cost compute, architecture/contributing/FAQ docs, ADR-007 + index).
> T-1402 (signing pipeline — needs real keys/infra) and T-1405 (Quick Start —
> needs IDE screenshots) stay `[ ]`. Same core-first split as Phases 7/11/12.
> 40 new unit tests; full core suite 597 pass / 1 skipped, `task ci` green.

### Exit gate — Phase 14 exit criteria

- [~] Plugin verifies pricing book signature on every load. <!-- core ready 2026-05-31: verifyPricingSignature + resolvePricing fail-open are unit-tested; the on-load wiring (and the >50%-drop confirm dialog) is the IDE-runtime surface, and the signed feed itself awaits T-1402. -->
- [~] Telemetry opt-in works; export command produces report. <!-- core ready 2026-05-31: opt-in gate (NoOp when disabled) + recorder + exportEngagementReport markdown are unit-tested; the Settings toggle + `event4u: Export Telemetry Report` command invocation are IDE wiring. -->
- [ ] Docs complete enough that an event4u dev can install + configure + use the plugin without asking the author. <!-- architecture/contributing/FAQ landed; the install/use Quick Start (T-1405) needs IDE screenshots, so this gate clears with the IDE-runtime sprint. -->

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
