---
complexity: standard
---

# Roadmap: Multi-Project / Multi-Root Workspace Support

> **Goal.** When the plugin runs inside an IDE window that holds more than one project — a VS Code multi-root workspace (`*.code-workspace` / multiple folders) or a JetBrains window with several modules / content roots / linked projects — the agent can see and index *all* of them, and the chat exposes an Augment-style **multiselect** so the user scopes which projects feed a given turn. Single-root windows behave exactly as today (no new UI surface).
>
> **Why it's a separate roadmap.** This feature is cross-cutting (Core walker/index + Protocol + both clients + chat UI + retrieval) and depends on the Context Engine already existing. Folding it into `road-to-v1-0.md` would perturb that roadmap's locked, council-sequenced sprint order. It is sequenced **after v1.0 Phase 8** (embeddings retrieval) and slots naturally into the v1.x line.
>
> **Source.** Authored 2026-05-29 on user request. The current `road-to-mvp.md`, `road-to-v1-0.md`, and `agents/analysis/PLAN.md` all assume a single workspace root (v1.0 `T-601` walks "the project root", the NDJSON protocol carries no folder list). This roadmap closes that gap. No AI Council was run on it yet — a council review pass is the recommended next step before execution (see Notes).

## Context

- **Gates.** `minimal-safe-diff` (extend the walker/index, do not rewrite them), `scope-control` (no new retrieval library — reuse the v1.0 BM25 + embeddings stack), `verify-before-complete` (no `T-MR*` is marked done without fresh verification evidence in the same reply that ships the work).
- **Hard dependencies (must be shipped before Phase A starts):**
  - **v1.0 Phase 6** — `T-601` (workspace walker), `T-602` (tree-sitter indexer), `T-603` (BM25 retriever), `T-604` (incremental re-index), `T-605` (context-block injection).
  - **v1.0 Phase 8** — embeddings + hybrid retrieval (only `T-MR04`'s embeddings-scope clause depends on it; the BM25-scope clause depends only on Phase 6).
  - **MVP Phase 2** — chat UI (`T-203`) for the picker surface; v1.0 `T-703` action-card polish is a soft dependency for the picker's visual integration.
- **Terminology.** A **root** is one indexable project directory. In VS Code it is a `workspace.workspaceFolders[i]`. In JetBrains it is a module content root (`ModuleRootManager`) or a linked/attached project (`ProjectManager`). The Core treats roots uniformly: `{ id, name, absPath, enabled }`.
- **Non-goals (explicitly out of scope here).** Cross-root *symbol rename* / refactor, cross-root dependency-graph analysis, remote/SSH roots, and per-root distinct model/provider settings. Each is a candidate for its own v1.5+ roadmap.

---

## Phase A — Core: multi-root walker + root-partitioned index (≈ 2 weeks)

> **Goal.** The Core stops assuming a single project root. The walker walks N roots; the symbol/BM25 index is partitioned by root; retrieval can be scoped to a subset of roots. No client or UI change yet — proven by unit tests + a fixture with two nested + two sibling roots.

- [ ] **T-MR01 — `WorkspaceRoot` model.** Add `packages/core/src/context/roots.ts` with `WorkspaceRoot = { id: string; name: string; absPath: string; enabled: boolean }` and a `RootRegistry` (add / remove / list / setEnabled). Replace the single `projectRoot: string` assumption in the context layer with `RootRegistry`. Single-root construction is a registry of length 1 — behavioural parity with today is a test.
- [ ] **T-MR02 — Multi-root walker.** Extend v1.0 `T-601` walker to iterate the registry: each root walked independently, each respecting its **own** `.gitignore` / `.augmentignore` plus the built-in skip-list. Dedup nested roots (root B inside root A → B's subtree is walked once, attributed to the most-specific root) and overlapping roots (symlink / same absPath → single entry). Walker output gains `rootId` per emitted path.
- [ ] **T-MR03 — Root-partitioned index.** `symbols` (and the BM25 inverted index) carry a `rootId` column / namespace. Adding a root creates its index segment incrementally (no full rebuild of existing roots); removing a root drops only its segment. Test: index two roots, drop one, assert the other's symbols + BM25 scores are untouched and query latency unchanged.
- [ ] **T-MR04 — Scoped retrieval.** `retrieve(query, k, rootIds?: string[])` restricts candidates to the given roots (default: all `enabled` roots). The per-turn token budget (v1.0 `T-605`: 20% of context window) is split fairly across selected roots so one huge root cannot starve the others. Embeddings/hybrid path (v1.0 Phase 8) honours the same `rootIds` filter.
- [ ] **T-MR05 — Multi-root fixture + tests.** Add `packages/core/test/fixtures/multi-root/` with: two sibling repos, one nested root, one symlinked duplicate, and per-root `.gitignore`. Unit tests cover dedup, per-root ignore, segment add/drop, and scoped retrieve. Verify with `pnpm --filter @event4u-agent/core test`.

### Exit gate — Phase A exit criteria

- [ ] Walker over a 2-sibling + 1-nested fixture emits correct `(rootId, path)` pairs with per-root ignore honoured and no duplicate from the symlink.
- [ ] Dropping one root leaves the other root's index and query results bit-identical.
- [ ] `retrieve(query, k, [rootA])` returns only `rootA` symbols; `retrieve(query, k)` spans all enabled roots within budget.

---

## Phase B — Protocol + both clients: enumerate & sync roots (≈ 2 weeks)

> **Goal.** Each client tells the Core which roots the IDE window holds, on connect and whenever the set changes. The Core reconciles: spins up / tears down walker + index segments per delta. Proven by opening a multi-root window in each IDE and watching the Core log the roots.

- [ ] **T-MR06 — Protocol: workspace folders.** Extend the protocol (`packages/protocol/src/schema.ts`): add a `WorkspaceFolder` Zod schema (`{ id, name, absPath }`), carry `workspaceFolders: WorkspaceFolder[]` in the connection handshake/init payload, and add a `workspaceFoldersChanged` notification (`{ added: WorkspaceFolder[]; removed: string[] }`). Regenerate Kotlin DTOs via `task codegen`. Verify with `pnpm --filter @event4u-agent/protocol test` + schema round-trip test.
- [ ] **T-MR07 — VS Code client: enumerate + watch.** On init, send `vscode.workspace.workspaceFolders` mapped to `WorkspaceFolder[]` (handle the `*.code-workspace` multi-folder case and the no-folder case). Subscribe to `onDidChangeWorkspaceFolders` and push a `workspaceFoldersChanged` delta. Stable `id` per folder (uri fsPath hash) so the Core can match across reconnects.
- [ ] **T-MR08 — JetBrains client: enumerate + watch.** Enumerate module content roots via `ModuleManager` + `ModuleRootManager`, plus linked/attached projects via `ProjectManager`. Push on tool-window open and subscribe to a roots-changed listener (`ModuleRootListener` / project-open events) to push deltas. Compiles + lints green on the JDK-17 CI gate (`task jetbrains:check`); IDE-runtime smoke (open a 2-module PhpStorm project, confirm both roots reach the Core) recorded in `docs/MANUAL_VERIFICATION.md`.
- [ ] **T-MR09 — Core reconciliation.** On handshake + every `workspaceFoldersChanged`: diff against the `RootRegistry`, create walker+index segments for added roots (debounced 2s, reusing v1.0 `T-604` incremental path), drop segments for removed roots. Surface per-root index status (`indexing N/M` / `ready · k files`) on a query method the UI polls.

### Exit gate — Phase B exit criteria

- [ ] Open a VS Code `.code-workspace` with two folders → Core logs two roots; add a third folder live → Core indexes it without restart.
- [ ] Open a PhpStorm project with two modules → Core logs both content roots.
- [ ] Removing a folder in either IDE tears down only that root's index segment.

---

## Phase C — Chat UI: multiselect picker + scope persistence (≈ 1.5 weeks)

> **Goal.** The chat exposes an Augment-style multiselect over the available roots; the selection scopes retrieval + context injection for each turn; the selection persists per workspace. Single-root windows show no picker.

- [ ] **T-MR10 — Multiselect picker (shared Preact).** Add the picker to `packages/shared/ui/` so JBCef-webview + VS Code webview share one component. Chip/dropdown listing every root with a checkbox, per-root file count + index-status dot (from `T-MR09`), and `Select all` / `Select none`. Augment-parity: compact chip in the composer that expands to the list.
- [ ] **T-MR11 — Per-turn scoping.** The picker selection is attached to each outgoing turn; the Core's context-injection + `retrieve()` use exactly those `rootIds`. Default selection = all `enabled` roots. Changing the selection mid-conversation affects only subsequent turns (past turns keep their recorded scope for replay fidelity).
- [ ] **T-MR12 — Persisted selection.** Store the last selection per workspace under `.event4u-agent/roots.json` (alongside the per-workspace chat/guidelines convention from v1.0 `T-1301` / `T-1307`). Re-opening the window restores it. New roots default to selected; removed roots are pruned from the file.
- [ ] **T-MR13 — Degenerate / empty states.** Single-root window → picker hidden entirely (no clutter). Zero selected roots → composer shows an inline warning and disables send until ≥1 root is selected (or "send without code context" is explicitly chosen). Nested-root dedup from `T-MR02` is reflected in the list (the absorbed subtree is not shown as a separate selectable root).

### Exit gate — Phase C exit criteria

- [ ] Two-root workspace: picker lists both with file counts; deselecting one removes its snippets from the next turn's injected context (verified against the step-footer / context block).
- [ ] Selection survives an IDE restart.
- [ ] Single-root workspace renders no picker; behaviour identical to pre-feature.

---

## Acceptance criteria — Multi-Project overall

- [ ] All phase exit criteria met (A, B, C).
- [ ] In both PhpStorm and VS Code, opening a multi-project window surfaces all projects to the agent and the chat multiselect scopes context per turn — matching the Augment-style UX the user asked for.
- [ ] Single-root workspaces are behaviourally unchanged (no regression in walker, index, retrieval, or UI).
- [ ] An ADR records the `WorkspaceRoot` model + the dedup/nesting rule (created via the `adr-create` flow).

## Notes

- **Dependency framing.** This roadmap is inert until v1.0 Phase 6 (and, for the embeddings-scope clause of `T-MR04`, Phase 8) ship. Starting Phase A earlier means extending a walker/index that does not exist yet.
- **Augment parity, not copy.** "Augment-style multiselect" is the UX target (per-project scoping from the composer). The implementation reuses the project's own walker/index/retrieval stack — no Augment code or dependency is pulled in.
- **Council review recommended.** Unlike `road-to-mvp.md` / `road-to-v1-0.md`, this roadmap was not council-reviewed. A 2-round analysis-lens council pass on phase sequencing and the dedup/nesting rule (`T-MR02`) is the recommended next step before execution.
- **No release/version pins by design** (per `scope-control`): this roadmap plans work, not a release. Where it lands in the v1.x line is a separate sequencing decision.
