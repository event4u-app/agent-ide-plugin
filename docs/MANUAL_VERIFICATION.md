# Manual verification checklist

> Why this file exists: GitHub Actions runners have no GUI. The JetBrains plugin lifecycle (load `plugin.xml`, register `ToolWindow`, spawn sidecar, survive IDE restart) can only be verified in a running PhpStorm / IntelliJ IDEA. CI green is necessary, not sufficient — see `agents/evidence/analysis/mvp-scope-decision-2026-05-29.md` § "Compile green, runtime red trap".
>
> Roadmap tasks `[~]` waiting on this file:
>
> | Task | What stays unverified until you walk this list |
> |---|---|
> | T-103 (JetBrains plugin skeleton) | Plugin installs, tool-window appears |
> | T-105 (Core↔Client RPC, JetBrains half) | Ping round-trip in a real IDE, IDE-restart leaves no zombie sidecar |
> | T-MR09 (VS Code auto-enumerate) | Open roots reach the Core on activation + on change, with no user action |
> | T-MR10 (JetBrains auto-enumerate) | Module content roots reach the Core; excluded/library roots absent |

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

## Phase B (multi-project) — auto-detect open roots

> Code + unit tests land in CI (`mapWorkspaceFolders`, `WorkspaceCoordinator`
> reconciliation). What needs a running IDE: that the client's enumeration
> actually reaches the Core on connect and on every change, with no user action.

### T-MR09 — VS Code auto-enumerate + watch

1. `task vscode:build`, launch the Extension Host (F5 / `code --extensionDevelopmentPath`).
2. Open a `.code-workspace` with **two** folders.

- [ ] Core stderr (or a `rootStatus` poll) shows two roots logged on activation, no chat opened.
- [ ] Add a third folder live → Core indexes it without a restart.
- [ ] Remove a folder → Core tears down only that root's segment.
- [ ] No-folder window and a single-folder window both behave (no crash; single-root legacy path).

### T-MR10 — JetBrains auto-enumerate + watch

1. `task jetbrains:runIde` (needs JDK 17 + GUI).
2. Open a PhpStorm project with **two** modules (distinct content roots).

- [ ] Both module content roots reach the Core on startup; excluded / library / SDK roots are absent.
- [ ] A second IDE window's project does **not** leak its roots into the first (active-`Project` scoping, not `getOpenProjects()`).
- [ ] Adding / removing a module pushes a delta; the Core reconciles.

### Record the result

```
- 2026-MM-DD · Phase B verified by <name> · IDE <vscode|phpstorm> · roots auto-detected: <n>
```

## Vertical slice (chat → send → stream → stop → cost)

> Phase 1 (the `chatSend` / `chatCancel` dispatch + streaming handler + cost) is
> pure-core and lands fully unit-tested in CI (`packages/core/src/chat/handler.test.ts`,
> `packages/protocol/src/schema.test.ts`). What needs a running IDE: that the
> streamed tokens actually render live, the Stop button aborts mid-stream, and
> the cost footer fills in. See ADR-010 for the design. `main.ts` wires a real
> `ChatHandler` (backend resolver + store + pricing) as part of Phase 2 — until
> then a real-sidecar `chatSend` returns `chat_not_configured`.

### Phase 2 — VS Code: stream + stop end-to-end (T-VS05–T-VS08)

1. Wire a real `ChatHandler` into the sidecar `main.ts` (backend resolver +
   `ConversationStore` + `PricingBook`); add a streaming `stream()` method to
   `clients/vscode/src/sidecar-client.ts` (the current `request()` is
   request/response only — it resolves on the first envelope).
2. `task vscode:build`, launch the Extension-Development-Host (F5).

- [ ] Open chat → type a prompt → send → assistant tokens stream into the active card live (spinner while streaming).
- [ ] The Stop control fires `chatCancel`; the partial answer is kept, the spinner clears, the card marks "stopped".
- [ ] The cost footer shows a live token counter during the stream and the final cost figure from the `done` payload after.
- [ ] Reopen the conversation → the streamed turn (and a stopped partial) survived (persisted via the `chat/` store).

### Phase 3 — JetBrains: stream + stop end-to-end (T-VS09–T-VS11)

1. `task jetbrains:runIde` (needs JDK 17 + GUI). `SidecarClient.kt` holds the
   connection for the tool-window lifetime; `ChatPanel.kt` sends `chatSend`.
2. Open the tool window.

- [ ] Send → tokens stream into the active message; a Stop action fires `chatCancel` (partial kept, status "stopped").
- [ ] The cost footer wires `CostFooterFormatter.kt` to the live counter + the final `done` cost (pin `Locale.US` for number formatting — known JetBrains gotcha).

### Phase 4 — cost consistent across both surfaces (T-VS12 client half)

- [ ] The same streamed turn shows the same final `totalUsd` in VS Code and JetBrains (within the documented live-vs-final estimate delta — see ADR-010 §5: the live counter is an estimate, the `done` payload's `totalUsd` is authoritative; a jumpy counter is not a bug).

### Record the result

```
- 2026-MM-DD · Vertical slice verified by <name> · IDE <vscode|phpstorm> · stream ✓ stop ✓ cost ✓
```

## Product readiness Phase 1 — tool-call / diff / terminal cards (IDE render)

> The pure-core foundation shipped under unit tests + CI: the `ToolCallEvent`
> union + `ToolReview` diff payload (`packages/protocol/src/schema.ts`), the
> `runToolCallWithApproval` orchestrator (`packages/core/src/agent/approval.ts`),
> the `planToReview` diff mapper (`packages/core/src/tools/review.ts`), and the
> Kotlin sealed classes for `TerminalEvent` + `ToolCallEvent`
> (`scripts/codegen.ts` → `Protocol.kt`). ADR-013 records the design. The items
> below are the **deferred render halves** — they need a running IDE and a wired
> agent turn (the transport is intentionally not built yet, ADR-013 fork 5), so
> they stay `[~]` until both land and a human signs the row.

### T-PRD01 — tool-call action cards

- [ ] A `started` event renders a card with the tool name + `argsPreview`; an `approvalRequested` renders `allow once / allow always / deny` wired to the orchestrator's injected `decide`; `approvalResolved` / `result` / `error` update the card. VS Code webview + JetBrains Swing.
- [ ] A hard-floor command surfaces the `error` event ("blocked by hard floor") with no approve control.

### T-PRD02 — multi-file diff review

- [ ] An `approvalRequested` carrying `review.kind === 'diff'` renders a per-file diff (from `planToReview`) the user accepts/rejects before the write applies; rejection rolls back atomically (core `WriteFilesTool.apply` already does).

### T-PRD04 — streamed event union → client renderers

- [ ] The Kotlin client decodes `ToolCallEvent` / `TerminalEvent` polymorphically (`Json { ignoreUnknownKeys = true }` + `@JsonClassDiscriminator("kind")`) and the VS Code render switch handles every `kind` exhaustively.

### T-PRD03 — terminal card render (xterm.js)

- [ ] The shipped `terminal/` core (ring-buffer replay, waiting-for-input, first-write-wins) renders via xterm.js in both surfaces (completes road-to-v1-0 T-904/906/907/908). Core done since Phase 9; this is pure render.

### Record the result

```
- 2026-MM-DD · Product-readiness Phase 1 cards verified by <name> · IDE <vscode|phpstorm> · approval ✓ diff ✓ terminal ✓
```

## Verification log

> Append entries below. Newest at the top. One line per verification, signed by the human who walked the list.

(no entries yet — Phase 1 exit gate stays open until a human signs the first row)
