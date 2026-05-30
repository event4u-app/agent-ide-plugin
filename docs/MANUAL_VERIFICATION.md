# Manual verification checklist

> Why this file exists: GitHub Actions runners have no GUI. The JetBrains plugin lifecycle (load `plugin.xml`, register `ToolWindow`, spawn sidecar, survive IDE restart) can only be verified in a running PhpStorm / IntelliJ IDEA. CI green is necessary, not sufficient — see `agents/evidence/analysis/mvp-scope-decision-2026-05-29.md` § "Compile green, runtime red trap".
>
> Roadmap tasks `[~]` waiting on this file:
>
> | Task | What stays unverified until you walk this list |
> |---|---|
> | T-103 (JetBrains plugin skeleton) | Plugin installs, tool-window appears |
> | T-105 (Core↔Client RPC, JetBrains half) | Ping round-trip in a real IDE, IDE-restart leaves no zombie sidecar |

## Prerequisites

- PhpStorm 2024.2 or IntelliJ IDEA Ultimate 2024.2 (or newer, `sinceBuild=242`).
- JDK 17 on `PATH` (`java -version` reports 17.x).
- Node 20 or 22 (`node --version`).
- This repo checked out, `pnpm install` already run, `task build` green.

## T-103 — JetBrains plugin skeleton (smoke)

### Step 1 — Build the plugin distribution

```bash
task jetbrains:build
ls -la clients/jetbrains/build/distributions/
# Expected: one .zip under ~5 MB
```

If `task jetbrains:build` is not defined yet, use:

```bash
cd clients/jetbrains && ./gradlew buildPlugin
```

### Step 2 — Launch a sandboxed IDE with the plugin

```bash
cd clients/jetbrains && ./gradlew runIde
```

The first run downloads PhpStorm into `.gradle/caches/` (one-time, ~500 MB). A sandboxed IDE window appears.

### Step 3 — Verify the tool window appears

In the running IDE:

- Right-hand sidebar should show an `event4u-agent` tool-window button.
- Click it. The placeholder JPanel should render (currently a Swing placeholder until T-202 ships the Compose/Swing chat UI).
- Expected: no exception in `idea.log` (Help → Show Log in Finder/Explorer).

### Step 4 — Restart the sandbox IDE

- Close the sandbox window (File → Exit, OR just close the window).
- In a terminal: `ps aux | grep -i 'event4u-agent\|node.*server.js' | grep -v grep` — **must be empty**. A zombie sidecar here is a T-105 failure.
- Re-launch via `./gradlew runIde`. Tool-window should still be there (registered via `plugin.xml`, not session state).

### Step 5 — Record the result

If everything above passed, append to this file under `## Verification log`:

```
- 2026-MM-DD · T-103 verified by <name> · PhpStorm 2024.2.x · JDK <ver> · OS <macOS/Linux/Windows + arch>
```

Then flip `T-103` in `agents/roadmaps/road-to-mvp.md` from `[~]` to `[x]` in the **same commit** that updates this log, regenerate `agents/roadmaps-progress.md`, and PR.

## T-105 — Core↔Client RPC, JetBrains half

This depends on T-103 passing. The sandbox IDE must launch, and the tool-window must render.

### Step 1 — Ping the sidecar from the running IDE

The current `AgentToolWindowFactory.kt` already calls `SidecarClient.ping()` on tool-window open (see `clients/jetbrains/src/main/kotlin/`). In the running sandbox IDE:

- Open the tool-window.
- Watch the placeholder JPanel for a `Sidecar healthy: pong` line (or whatever the current code renders).
- If you see a stack trace instead, the sidecar didn't spawn — that's a packaging/path-resolution bug. Note it as a T-406 task.

### Step 2 — IDE-restart cycle

- Close the sandbox IDE.
- `ps aux | grep node | grep server.js` — must be empty.
- Re-launch sandbox. Tool-window opens, ping fires again, `pong` shows.

### Step 3 — Kill the IDE rough

- Launch sandbox.
- `kill -9` the IDE process (NOT graceful exit).
- `ps aux | grep node | grep server.js` — must be empty within 5 seconds (the sidecar should detect parent-process death via stdio EOF and self-exit; if it doesn't, this is a T-412 stop-button precursor bug).

### Step 4 — Record the result

```
- 2026-MM-DD · T-105 verified by <name> · 3-restart cycles + 1 kill-9 cycle · no zombies · ping <ms>
```

Then flip `T-105` from `[~]` to `[x]` and regenerate the dashboard.

## VS Code side

The VS Code half of T-104 and T-105 (extension activates, ping fires) is currently verified by an integration test (`packages/core` integration tests assert ping round-trip against the real built sidecar — see `task test`). The webview chat surface is T-203 work; no manual smoke required at MVP-skeleton level.

When the chat surface lands (Phase 2), add a parallel `## T-203 — VS Code chat UI` section here.

## T-MR01 — Multi-root discovery contract (spike findings)

> Time-boxed spike that froze the `WorkspaceRoot` schema for `T-MR02`. The
> client-enumeration realities below are what each IDE can actually surface; the
> runtime confirmation (open a real multi-folder window in each IDE) is deferred
> to the `T-MR09` / `T-MR10` smoke rows added later in this file.

### What each client can surface

- **VS Code.** `vscode.workspace.workspaceFolders` is the source of truth: a
  `.code-workspace` file yields one entry per folder; a single-folder window
  yields one entry; a no-folder window yields `undefined` (degrade to "no
  roots"). Folders carry a user-renamable `name` and a `uri` that may be
  `file://`, `vscode-remote://` (Remote-SSH / WSL / Dev Containers), or virtual.
  `onDidChangeWorkspaceFolders` fires on add / remove / reorder. `stableId` =
  `workspaceFolder.uri.toString()` (stable across casing / relocation).
- **JetBrains.** The **active** `Project`'s module content roots
  (`ModuleManager` → `ModuleRootManager.getContentRoots()`) are the roots.
  Excluded folders are dropped; SDK / library roots are **not** content roots
  and never appear. `ProjectManager.getOpenProjects()` is **wrong** — it leaks
  roots across separate IDE windows. A `ModuleRootListener` pushes change
  deltas. `stableId` = the content-root `VirtualFile` URL.

### Frozen `WorkspaceRoot` schema (input to T-MR02)

```ts
WorkspaceRoot = {
  uri: string;          // primary identity the client speaks (file://, vscode-remote://, …)
  stableId: string;     // client-supplied persistence key (survives path-casing / relocation)
  canonicalKey: string; // realpath-derived dedup key — CORE-DERIVED, not client-supplied (see below)
  displayName: string;
  kind: string;         // 'folder' | 'module' | …
  enabled: boolean;
}
```

### Council contract corrections (codex/gpt-5 + gemini-2.5-pro, 2026-05-30)

Both members independently flagged two defects in the first-draft contract:

1. **`canonicalKey` must be platform/filesystem-aware, not blanket
   case-normalized.** Lower-casing on a case-sensitive Linux volume would
   wrongly dedup `/repo/Web` and `/repo/web`. Rule adopted: lower-case on
   Windows + case-insensitive macOS volumes; **preserve case on Linux**.
2. **`canonicalKey` is derived inside the Core (`RootRegistry`), never supplied
   by the client.** A client-computed key drifts across WSL/host or differing
   `realpath` implementations. The client supplies `uri` + `stableId`; the
   registry computes `canonicalKey` via `fs.realpath.native` + the
   platform-aware normalizer on `add`.

Symlink-cycle safety: `fs.realpath` resolution terminates cycles (`ELOOP` →
the root is flagged `enabled: false`); the walker additionally tracks visited
real-dir keys so a symlinked subtree is not re-descended.

## Phase 8 — Embeddings + hybrid retrieval (real-model gate)

> The plumbing (fusion, scoping, cache, ranking determinism) is unit-tested with
> a deterministic `FakeEmbedder`. Retrieval **quality** and **perf** depend on a
> real model + a real corpus, which the standard CI matrix does not run — verify
> them here.

### Prerequisites — enable the local embedder

```bash
pnpm add @huggingface/transformers   # optional, native (onnxruntime + sharp)
```

The package is intentionally kept out of the default dependency graph (same
no-native-deps call as the token-tracking JSONL store). Without it, the engine
runs BM25-only; `RemoteEmbedder` (Voyage/OpenAI, fetch-based) is the no-native
alternative if a key is configured.

### T-801/T-805 — embedder smoke + incremental re-embed

```bash
RUN_EMBEDDING_INTEGRATION=1 pnpm --filter @event4u-agent/core test
# Expect: TransformersEmbedder (real model) suite passes — 384-dim, semantic ranking.
```

- [ ] Real model loads; semantically-related text scores higher than unrelated.
- [ ] Edit ~50 lines in a 2000-line file → re-embed completes < 2s (content-hash
      cache means only changed chunks miss). Record the timing.

### T-803/T-804 — quality eval (exit gate)

Follow `agents/analysis/retrieval-eval/README.md`: build `queries.json` from real
chat history, index a target repo BM25-only vs hybrid, compare MRR / Recall@10.

- [ ] 20 sample queries: hybrid retrieval is **not worse** than BM25-only and
      improves the no-exact-symbol-match (semantic) queries.
- [ ] First-time index of a ~20k-file repo completes < 8 min including embeddings.

### Record the result

```
- 2026-MM-DD · Phase 8 verified by <name> · model <id> · re-embed <ms> · MRR BM25 <x> → hybrid <y>
```

## Verification log

> Append entries below. Newest at the top. One line per verification, signed by the human who walked the list.

(no entries yet — Phase 1 exit gate stays open until a human signs the first row)
