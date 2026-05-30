---
complexity: standard
---

# Roadmap: Multi-Project / Multi-Root Workspace Support

> **Goal.** When the plugin runs inside an IDE window that holds more than one project — a VS Code multi-root workspace (`*.code-workspace` / multiple folders) or a JetBrains window with several modules / content roots — the plugin **automatically detects every open project**, indexes them all, and the chat exposes an Augment-style **multiselect** so the user scopes which projects feed a given turn. Auto-detection is the load-bearing requirement: the user never registers roots by hand; the clients enumerate what the IDE already has open, on connect and whenever it changes. Single-root windows behave exactly as today (no new UI surface).
>
> **Why it's a separate roadmap.** This feature is cross-cutting (Core walker/index + Protocol + both clients + chat UI + retrieval) and depends on the Context Engine already existing. Folding it into `road-to-v1-0.md` would perturb that roadmap's locked, council-sequenced sprint order. It is sequenced **after v1.0 Phase 6** (BM25 retrieval); the embeddings-scope slice depends additionally on Phase 8 and ships as its own follow-up task.
>
> **Source.** Authored 2026-05-29 on user request; revised the same day after a 2-round analysis-lens AI Council (OpenAI codex/gpt-5 + Google gemini-2.5-pro) — convergence folded in below (see Notes). The current `road-to-mvp.md`, `road-to-v1-0.md`, and `agents/analysis/PLAN.md` all assume a single workspace root (v1.0 `T-601` walks "the project root", the NDJSON protocol carries no folder list). This roadmap closes that gap.

## Context

- **Gates.** `minimal-safe-diff` (extend the walker/index, do not rewrite them), `scope-control` (no new retrieval library — reuse the v1.0 BM25 + embeddings stack), `verify-before-complete` (no `T-MR*` is marked done without fresh verification evidence in the same reply that ships the work).
- **Hard dependencies (must be shipped before Phase A core tasks start):**
  - **v1.0 Phase 6** — `T-601` (walker), `T-602` (tree-sitter indexer), `T-603` (BM25), `T-604` (incremental re-index), `T-605` (context-block injection). Covers everything except the embeddings-scope task.
  - **v1.0 Phase 8** — embeddings + hybrid retrieval. **Only `T-MR06` (embeddings-scope) depends on it.** The rest of the feature ships after Phase 6 — the feature is not gated on Phase 8.
  - **MVP Phase 2** — chat UI (`T-203`) for the picker surface; v1.0 `T-703` action-card polish is a soft dependency for visual integration.
- **Root identity (council-driven, decided up front).** A **root** is one indexable project directory. The Core never identifies a root by a bare absolute path — paths break under Remote/WSL, cross-drive, symlinks, and case-insensitive filesystems. Three distinct identities, never conflated:
  - `uri` — primary identity (`file://`, `vscode-remote://`, …), what the client speaks.
  - `stableId` — client-supplied, the **persistence key** (survives path-casing / relocation).
  - `canonicalKey` — `realpath`-derived **dedup key** (case-normalized, cycle-safe). Used only to detect duplicates, never persisted as the selection key.
  In VS Code a root is a `workspace.workspaceFolders[i]`; in JetBrains a module content root (`ModuleRootManager`) of the **active** `Project`. The Core treats roots uniformly: `{ uri, stableId, canonicalKey, displayName, kind, enabled }`.
- **Non-goals (out of scope here).** Cross-root symbol rename / refactor, cross-root dependency-graph analysis, per-root distinct model/provider settings, and a generation-ID-based deterministic replay engine. Each is a candidate for its own v1.5+ roadmap.

---

## Phase A — Core: root contract + multi-root walker + scoped retrieval (≈ 2.5 weeks)

> **Goal.** The Core stops assuming a single project root. A discovery spike fixes the real root contract first; the walker walks N roots; the index is partitioned by root; retrieval is scoped to a resolved set of root IDs. No client/UI change yet — proven by unit tests + a fixture with sibling, nested, and symlinked roots.

- [x] **T-MR01 — Root-discovery contract spike.** Before any core model is frozen, enumerate what each client can actually surface, so the contract reflects IDE reality, not a guess. VS Code: `workspaceFolders` (incl. `.code-workspace` multi-folder, no-folder, virtual / remote URIs, untrusted-workspace). JetBrains: active `Project` → modules → `ModuleRootManager` content roots, with excluded / source / test roots distinguished and SDK / library roots dropped. Output: the frozen `WorkspaceRoot` schema for `T-MR02`. Time-boxed (≤ 2 days); findings recorded in `docs/MANUAL_VERIFICATION.md`.
- [x] **T-MR02 — `WorkspaceRoot` model + registry.** Add `packages/core/src/context/roots.ts`: `WorkspaceRoot = { uri: string; stableId: string; canonicalKey: string; displayName: string; kind: string; enabled: boolean }` and a `RootRegistry` (add / remove / list / setEnabled, keyed by `stableId`, dedup by `canonicalKey`). Replace the single `projectRoot: string` assumption with `RootRegistry`. A single-root window is a registry of length 1 — behavioural parity with today is a test.
- [x] **T-MR03 — Multi-root walker.** Extend v1.0 `T-601` to iterate the registry. Each explicit root is walked independently with its **own** ignore rules (`.gitignore` / `.augmentignore`) plus the built-in skip-list. For nested explicit roots: files are indexed once and attributed to the **most-specific** root; the parent segment **excludes** the child subtree, but the child stays a distinct root in the registry (and later the UI). Ignore precedence: a parent ignore must **not** suppress an explicitly registered child root. Deduplicate overlapping roots by `canonicalKey` (`realpath`, case-normalized, symlink-cycle-safe), preserving the user-facing `uri` / `displayName`; define the winner when two explicit roots resolve to the same canonical target. Walker output gains `rootId` per emitted path.
- [x] **T-MR04 — Root-partitioned index.** `symbols` + the BM25 inverted index carry a `rootId` namespace. Adding a root creates its segment incrementally (no full rebuild); removing a root drops only its segment. Test: index two roots, drop one, assert the other's symbols + BM25 scores are untouched.
- [x] **T-MR05 — Scoped retrieval (BM25/symbol).** `retrieve(query, k, rootIds?: string[])` restricts candidates to the **exact resolved set** of selected root IDs. Omitted scope = all `enabled` roots; an **explicit empty scope = "no code context"**, never "all roots". Selection is by root ID, **not** by filesystem containment (selecting a parent does not implicitly pull in a deselected nested child at retrieval time). Allocation: retrieve per selected root, guarantee a small per-root minimum for roots with hits, then allocate the remaining budget by relevance and reclaim the budget of roots with zero hits (no naive equal split).
- [-] **T-MR06 — Scoped embeddings/hybrid retrieval.** *(Depends on v1.0 Phase 8.)* <!-- deferred: v1.0 Phase 8 (embeddings) not yet built; ships as a follow-up per roadmap design — the feature does not block on it. The `rootIds` scope + allocation contract (T-MR05) is the seam it will reuse. --> The embeddings / hybrid path honours the same resolved `rootIds` filter and the same allocation rule as `T-MR05`. Ships as a follow-up once Phase 8 exists; the feature does not block on it.
- [x] **T-MR07 — Multi-root fixture + tests.** `packages/core/test/fixtures/multi-root/`: two sibling repos, one nested explicit root, one symlinked duplicate, per-root `.gitignore`, plus a `parent-ignores-child` case. Unit tests cover canonical dedup, per-root + precedence ignore, segment add/drop, and exact-set scoped retrieve. Verify with `pnpm --filter @event4u-agent/core test`.

### Exit gate — Phase A exit criteria

- [x] Walker over the sibling + nested + symlink fixture emits correct `(rootId, path)` pairs: per-root ignore honoured, parent ignore does not suppress the explicit child, symlink duplicate collapses to one canonical entry.
- [x] Dropping one root leaves the other root's index and query results bit-identical.
- [x] `retrieve(query, k, [rootA])` returns only `rootA`; omitted scope spans all enabled roots within budget; explicit empty scope returns nothing.

---

## Phase B — Protocol + both clients: auto-detect & sync open projects (≈ 2 weeks)

> **Goal.** Each client **automatically** tells the Core which projects the IDE window currently has open — on connect and on every change. No manual registration. The Core reconciles: spins up / tears down walker + index segments per delta. Proven by opening a multi-project window in each IDE and watching all roots reach the Core with no user action.

- [ ] **T-MR08 — Protocol: workspace folders.** Extend `packages/protocol/src/schema.ts`: a `WorkspaceFolder` Zod schema (`{ uri, stableId, displayName, kind }`), carried as `workspaceFolders: WorkspaceFolder[]` in the connection handshake, plus a `workspaceFoldersChanged` notification (`{ added: WorkspaceFolder[]; removed: string[] /* stableIds */ }`). The per-turn payload distinguishes three scopes: default (all enabled), explicit root-ID set, and explicit empty ("no code context"). Legacy fallback: a client that sends no folder list defaults to single-root behaviour. Regenerate Kotlin DTOs via `task codegen`. Verify with `pnpm --filter @event4u-agent/protocol test` + schema round-trip.
- [ ] **T-MR09 — VS Code client: auto-enumerate + watch.** On init, send `vscode.workspace.workspaceFolders` mapped to `WorkspaceFolder[]` — handle `.code-workspace` multi-folder, no-folder, folder rename, folder-order change, duplicate basenames, and virtual / remote URIs (untrusted-workspace → degrade gracefully). Subscribe to `onDidChangeWorkspaceFolders` and push a delta. `stableId` = `workspaceFolder.uri.toString()` (stable across casing / relocation).
- [ ] **T-MR10 — JetBrains client: auto-enumerate + watch.** Enumerate the **active** `Project`'s modules via `ModuleManager` → `ModuleRootManager` content roots; honour excluded folders, drop SDK / library roots. Subscribe to a roots-changed listener (`ModuleRootListener`) to push deltas. **Do not** use `ProjectManager.getOpenProjects()` — that leaks roots across separate IDE windows. Compiles + lints green on the JDK-17 CI gate (`task jetbrains:check`); IDE-runtime smoke (open a 2-module PhpStorm project, confirm both content roots reach the Core with no user action) recorded in `docs/MANUAL_VERIFICATION.md`.
- [ ] **T-MR11 — Core reconciliation + lifecycle.** On handshake + every `workspaceFoldersChanged`: diff against the `RootRegistry`, create walker+index segments for added roots (debounced 2s, reusing v1.0 `T-604` incremental path), cancel + drop segments for removed roots. Surface per-root index status (`indexing N/M` / `ready · k files` / `error`) on a query method the UI polls. Kept lean — no generation-ID engine.

### Exit gate — Phase B exit criteria

- [ ] Open a VS Code `.code-workspace` with two folders → Core auto-logs two roots with no user action; add a third folder live → Core indexes it without restart.
- [ ] Open a PhpStorm project with two modules → Core auto-logs both content roots; excluded / library roots are absent.
- [ ] Removing a folder/module in either IDE cancels in-flight indexing and tears down only that root's segment.

---

## Phase C — Chat UI: multiselect picker + scope persistence (≈ 2 weeks)

> **Goal.** The chat exposes an Augment-style multiselect over the auto-detected roots; the selection scopes retrieval + context injection per turn; the selection persists per workspace in IDE-native storage. Single-root windows show no picker.

- [ ] **T-MR12 — Multiselect picker (shared Preact).** Add the picker to `packages/shared/ui/` so JBCef-webview + VS Code webview share one component. Hierarchical list: each root with a checkbox, file count, and index-status dot (from `T-MR11`); nested explicit roots rendered **indented** under their container. Parent is **tri-state** — checking a parent checks its nested children by default, each child stays individually deselectable. `Select all` / `Select none`. Label disambiguation: when two roots share a basename (`src`, `api`, `web`), show the parent or workspace-relative path to distinguish them; preserve user-renamed VS Code folder names. Compact composer chip that expands to the list (Augment parity).
- [ ] **T-MR13 — Per-turn scoping.** The picker selection resolves to an **explicit root-ID set** snapshotted onto each outgoing turn (not a mutable "all" alias). The Core's context-injection + `retrieve()` use exactly that set; default = all enabled roots; explicit empty = the "no code context" flag from `T-MR08`. Changing the selection mid-conversation affects only subsequent turns; past turns keep their recorded scope snapshot (`{ rootId, displayName, path-snapshot }`) for replay fidelity. UI rule: selecting a parent scopes only that parent's segment **unless** its nested children are also checked (consistent with `T-MR05` — no hidden filesystem-containment expansion).
- [ ] **T-MR14 — Persisted selection (IDE-native).** Store the last selection in IDE-native storage keyed by workspace identity — VS Code `workspaceState` (anchored to the `.code-workspace` / workspace id), JetBrains project-level `PersistentStateComponent`. **Not** a repo-local file (avoids the multi-root anchor ambiguity; `.event4u-agent/` is already gitignored but is not a reliable anchor across unrelated repos). Persist `stableId`s, never absolute paths. New roots default to selected; removed roots are pruned; a restored selection referencing an unknown root is dropped silently.
- [ ] **T-MR15 — Degenerate / lifecycle states.** Single-root window → picker hidden entirely. Zero selected roots → composer shows an inline warning and disables send until ≥1 root is selected or "send without code context" is explicitly chosen (sends the explicit empty scope). Handle: selected root removed before send, selected root still indexing, root indexing failed, restored selection references unknown roots, selection edited while a request streams. The symlink-duplicate from `T-MR03` is not shown as a separate selectable root; explicit nested roots **are**.
- [ ] **T-MR16 — (Optional, deferred) Active-file affinity.** An opt-in "Auto" mode that biases the selection toward the root containing the file active in the editor. Explicitly **not** required for the first pass (council: nice-to-have, not must-have); listed here so it is not lost. Punt to v1.x polish unless the first dogfood round demands it.

### Exit gate — Phase C exit criteria

- [ ] Two-project workspace: picker lists both with file counts; deselecting one removes its snippets from the next turn's injected context (verified against the step-footer / context block).
- [ ] Selection survives an IDE restart (IDE-native storage, no repo file written).
- [ ] Single-project workspace renders no picker; behaviour identical to pre-feature.

---

## Acceptance criteria — Multi-Project overall

- [ ] All phase exit criteria met (A, B, C).
- [ ] In both PhpStorm and VS Code, opening a multi-project window **auto-detects** every open project and surfaces it to the agent; the chat multiselect scopes context per turn — matching the Augment-style UX the user asked for.
- [ ] Cross-client parity verified on the same matrix in both IDEs: two sibling roots · nested explicit root · symlink duplicate · removed root · persisted-selection restore · indexing-failure display · two roots with the same basename.
- [ ] Single-root workspaces are behaviourally unchanged (no regression in walker, index, retrieval, or UI).
- [x] An ADR records the `WorkspaceRoot` identity model (`uri` / `stableId` / `canonicalKey`) and the nested-root / dedup rule (created via the `adr-create` flow). <!-- ADR-005-workspace-root-identity.md -->

## Notes

- **Council convergence (inlined per `no-roadmap-references`).** AI Council (OpenAI codex/gpt-5 + Google gemini-2.5-pro, 2026-05-29, analysis lens, 2 rounds) reviewed the first draft and converged on: URI-based root identity over bare `absPath`; a root-discovery contract spike before the core model (`T-MR01`); explicit nested roots must stay selectable while indexing stays single-owner; split the Phase-8 dependency so BM25 scoping ships after Phase 6 (`T-MR05`) and embeddings scoping follows (`T-MR06`); IDE-native persistence instead of a repo-local file; tightened JetBrains enumeration (active `Project` + module content roots, not `ProjectManager.getOpenProjects()`); relevance-weighted retrieval allocation with budget reclamation; explicit empty-scope protocol semantics.
- **Resolved divergence — nested-root scope.** The two members split on whether selecting a parent implicitly includes a nested child. Resolution adopted: expansion is a **UI-selection** convenience (tri-state parent checks children by default, `T-MR12`), but `retrieve()` always honours the **explicit resolved root-ID set** (`T-MR05` / `T-MR13`) — no filesystem-containment expansion at retrieval time. This gives Augment-style convenience without breaking deliberate deselection.
- **Rejected as over-engineered for a solo-dev plugin.** Multi-membership indexing (a file owned by every containing root), generation-ID deterministic-replay metadata, and mandatory auto-scoping — all dropped or deferred (`T-MR16`).
- **No release/version pins by design** (per `scope-control`): this roadmap plans work, not a release. Where it lands in the v1.x line is a separate sequencing decision.
