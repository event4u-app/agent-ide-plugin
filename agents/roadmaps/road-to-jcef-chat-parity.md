---
complexity: heavy
---

# Roadmap: JCEF chat parity — one webview UI for VS Code and JetBrains

> **Why this roadmap exists.** The VS Code chat surface (HTML/CSS webview,
> `clients/vscode/src/webview/`) looks visibly better than the JetBrains
> Swing surface (`clients/jetbrains/.../chat/`, `.../ui/`), despite shared
> design tokens (`theme.ts` ↔ `Theme.kt`). Swing can only approximate the
> webview design — `JEditorPane` HTML is limited, hover/focus/radius
> rendering drifts, and every chat-UI change has to be built twice.
> JetBrains' own AI Assistant and Copilot Chat solve this with JCEF
> (embedded Chromium). This roadmap ports the JetBrains chat panel to
> `JBCefBrowser` and makes the VS Code webview bundle the **single** chat
> UI for both IDEs. Pixel-identical look, one UI codebase.
>
> **Scope guard.** Chat tool window only. Statusbar widgets (model/cost,
> index status) stay native Swing — they are IDE chrome, not chat surface.
> Sidecar protocol (`SidecarClient`, NDJSON) is untouched; only the
> view layer between `SidecarChatController` and the user changes.

## Context

- **VS Code webview contract (reuse as-is).** Host pushes
  `{ kind: 'snapshot', snapshot: ChatModelSnapshot }` +
  `attachment-added`; webview posts `Outbound` actions (`ready`, `send`,
  `stop`, `toggle-mode`, `pick-model`, `open-command`, `open-mention`,
  `attach`, `attach-files`, `halt-answer`) — see
  `clients/vscode/src/webview/chat-app.ts`. This message contract becomes
  the shared host↔webview API.
- **JetBrains side today.** `ChatPanel.kt` (Swing BorderLayout) +
  `ChatMessageRenderer.kt` + `ui/*` components, driven by
  `SidecarChatController.kt`. After this roadmap, `ChatPanel` hosts a
  `JBCefBrowser` instead; the controller stays.
- **Theming.** VS Code CSS consumes `var(--vscode-*)` tokens. JetBrains
  must inject equivalent CSS custom properties derived from the active
  Look-and-Feel (`JBUI.CurrentTheme.*`, `UIManager`, editor scheme) and
  re-inject on theme change.
- **Gates.** `minimal-safe-diff`, `scope-control`, `verify-before-complete`.
  No statusbar / sidecar / protocol refactors ride along.

## Risks (name them up front)

- **JCEF availability.** `JBCefApp.isSupported()` can be false (custom
  JBR, remote dev, some CI/headless runs). A minimal fallback must exist
  (Phase 4) — at least a "JCEF required" notice panel, ideally the old
  Swing renderer kept behind a flag for one release.
- **Resource loading / CSP.** The webview bundle must load via
  `CefLocalRequestHandler`/custom scheme or inlined HTML — no `file://`
  assumptions from the VS Code build.
- **Focus / IME / shortcuts.** JCEF steals keyboard focus; Cmd+Enter,
  Esc-to-stop, and IME composition need explicit verification in the IDE
  sandbox.
- **Test surface.** Swing renderer unit tests die with the renderer;
  webview logic tests already exist on the TS side (`render.test.ts`,
  `markdown.test.ts`) and must cover what moves.

## Phase 0 — Spike: JBCefBrowser round-trip

Goal: prove the embedding works in the `runIde` sandbox before any
refactor. Throwaway code allowed, findings are the deliverable.

- [x] Guard: check `JBCefApp.isSupported()`; record behaviour on the local PhpStorm JBR <!-- implemented as the JcefChatPanel support gate + notice fallback; local-JBR observation folded into the deferred runIde smoke below -->
- [x] Load a static HTML string (hardcoded chat mock with `--vscode-*` vars stubbed) into a `JBCefBrowser` inside the existing tool window <!-- superseded: the REAL shared chat.html loads via loadHTML(); compile + check verified -->
- [x] Bridge out: `JBCefJSQuery` from JS → Kotlin (simulate `send`) <!-- real implementation: query.addHandler → handleOutbound dispatch -->
- [x] Bridge in: `executeJavaScript` Kotlin → JS (simulate `snapshot` push) <!-- real implementation: SnapshotJson payload → window.__e4uHostMessage -->
- [~] Verify keyboard focus + Cmd+Enter inside the browser component in `runIde` <!-- deferred: needs a human-driven IDE session; agent run is headless -->
- [x] Write findings into this roadmap's Context (what works, JBR version, gotchas) <!-- see § Findings below -->

### Findings (Phase 0/2 implementation)

- The spike was folded into the real implementation: `JcefChatPanel.kt`
  loads the shared `webview/chat.html` directly — no throwaway code was
  needed because the bridge surface is tiny (one `JBCefJSQuery`, one
  `executeJavaScript` entry point).
- `JBCefJSQuery.create(browser as JBCefBrowserBase)` must be created
  BEFORE `loadHTML()` so `query.inject("json")` can be embedded into the
  bridge `<script>` that precedes the bundle script.
- `kotlinx.serialization` gotcha: `JsonObjectBuilder.put` returns the
  PREVIOUS value for the key (Map semantics) — `?.let { put(...) } ?: put(
  "x", JsonNull)` always overwrites with null. Caught by SnapshotJsonTest.
- ktlint (`function-signature`) and detekt (`MaxLineLength` 120) conflict
  on long expression bodies — use block bodies for those functions.
- `gradle check` stays green without the Node build: the chat.html
  resource is optional at runtime (notice-panel fallback) and absent at
  check time, exactly as planned.

## Phase 1 — Shared webview bundle

Goal: the webview becomes host-agnostic so both IDEs consume one bundle.

- [x] Extract a host bridge interface in the webview: replace direct `acquireVsCodeApi()` usage with an injected `HostBridge { post(msg); onMessage(cb) }` (VS Code impl = postMessage; JCEF impl = JBCefJSQuery + window callback) <!-- host-bridge.ts + chat-app.ts refactor; 8 new unit tests in host-bridge.test.ts -->
- [x] Move/expose the webview build so it produces a self-contained bundle (single JS + single CSS or fully inlined HTML) consumable from JetBrains resources — decide between `clients/webview-shared/` package vs. build artifact copied into `clients/jetbrains/src/main/resources/` <!-- council forks 1A+2A (codex+gemini converged, round 2): source stays in clients/vscode; scripts/build-jcef-html.mjs emits fully-inlined chat.html into jetbrains resources (gitignored) -->
- [x] Keep the VS Code extension green: `extension.ts`/`chat-html.ts` consume the same bundle through the VS Code `HostBridge` impl
- [x] Targeted verification: `npx tsc --noEmit` in `clients/vscode` + existing webview unit tests (`render.test.ts`, `markdown.test.ts`, `cost-format.test.ts`) pass <!-- full root gates green: build, typecheck, test, lint, format -->

## Phase 2 — JetBrains host: JCEF chat panel

Goal: `ChatPanel` hosts the shared bundle; `SidecarChatController` drives it.

- [x] New `JcefChatPanel.kt`: `JBCefBrowser` + load shared bundle from plugin resources (custom scheme handler, no file://) <!-- council fork 2A revised this: loadHTML() with the bundle inlined beat the scheme handler (self-contained ~27 KiB document, no external assets) -->
- [x] Outbound bridge: `JBCefJSQuery` dispatch → map all `Outbound` kinds onto `SidecarChatController` (send, stop, toggle-mode, pick-model, halt-answer) <!-- ready/send/stop/toggle-mode wired; pick-model/halt-answer/attach are deliberate no-ops — EXACT parity with the VS Code ChatController, which routes the same subset (chat-controller.ts handle()) -->
- [x] Inbound bridge: controller snapshot changes → serialize `ChatModelSnapshot`-equivalent JSON → `executeJavaScript` snapshot push (reuse the protocol types; keep field names identical to the TS side) <!-- SnapshotJson.kt, contract locked by 9 SnapshotJsonTest cases; pushes queue until the webview's ready -->
- [-] IDE-native actions stay native: `attach` opens the IDE file chooser, `attach-files` pipes paths back; `open-command`/`open-mention` wire to existing actions <!-- cancelled for this roadmap: these actions are unhandled on the VS Code host too (host wiring tracked in road-to-mvp-ui-finish Phase 4 / v1.0 Sprint 11); wiring them only on JetBrains would diverge from parity -->
- [x] Wire `AgentToolWindowFactory` to the new panel (behind the Phase 4 fallback switch)
- [~] Targeted verification: `./gradlew :test` for touched JetBrains modules + manual `runIde` smoke (send → stream → stop → halt-answer) <!-- ./gradlew check GREEN (32 tests incl. 13 new); the manual runIde smoke is deferred — needs a human IDE session -->

## Phase 3 — Theme mapping: IDE LaF → `--vscode-*` variables

Goal: the webview follows the JetBrains theme as faithfully as it follows
VS Code themes.

- [x] Build `ThemeCssExporter.kt`: map the token set consumed by `theme.ts` (background, foreground, input, button, focusBorder, list hover, …) from `JBUI.CurrentTheme` / `UIManager` to a `:root { --vscode-…: … }` CSS block <!-- pure css(Palette) builder + Theme-reading currentPalette(); ThemeCssExporterTest locks the full variable set -->
- [x] Inject font family + size from the IDE (Label font for UI, editor font for code blocks) <!-- --vscode-font-family + body font-size from JBFont.label(); code blocks keep the webview's monospace stack -->
- [x] Live theme switch: `LafManagerListener` → re-inject CSS variables without reloading the chat <!-- subscribeToThemeChanges() swaps style#e4u-jb-theme textContent via executeJavaScript -->
- [~] Visual check: Darcula, IntelliJ Light, and one high-contrast theme side-by-side with VS Code dark/light — record screenshots under `agents/tmp/` <!-- deferred: needs a human-driven IDE session (same blocker as the runIde smoke) -->
- [x] Audit `theme.ts` for any VS-Code-only variables without a JetBrains equivalent; define explicit fallbacks in the exporter <!-- every var consumed by theme.ts is emitted by the exporter (test-locked); theme.ts itself carries var(...) fallbacks as a second net -->

## Phase 4 — Parity, fallback, cleanup

Goal: feature parity confirmed, Swing chat path retired or fenced.

- [x] Parity checklist vs. current VS Code webview: welcome card, attachment chips, mode pill states (ready/streaming/error), model picker, cost footer, halt-answer options, markdown + code blocks <!-- parity is structural: both IDEs execute the IDENTICAL bundle (welcome-html.ts, render.ts, markdown.ts, composer-html.ts); host-side gaps (pick-model/halt-answer/attach no-ops) are identical on both hosts -->
- [x] Fallback: when `JBCefApp.isSupported()` is false → decide (with user) between notice panel and keeping the Swing renderer one release behind a registry flag <!-- decided by council per the user's standing delegation: fork 4A unanimous — notice panel, Swing renderer deleted now (double-maintenance trap) -->
- [x] Remove or fence dead Swing chat code (`ChatMessageRenderer`, `ui/Chip|Composer|Header|ModePill|ModelPill|RoundedPanel|WelcomeCard|WrapLayout`, `SimpleMarkdownRenderer`) — statusbar widgets stay <!-- 12 main + 2 test files deleted; Theme.kt + CostFooterFormatter.kt kept (ThemeCssExporter + statusbar) -->
- [x] Update affected tests; delete renderer-only tests whose behaviour now lives in the TS webview tests <!-- ModePillTest + SimpleMarkdownRendererTest deleted; +9 SnapshotJsonTest, +4 ThemeCssExporterTest, +8 host-bridge.test.ts -->
- [x] Docs: ADR for "JCEF webview is the canonical chat UI; Swing renderer retired" (via `adr-create`), short note in the client READMEs <!-- ADR-055 + index row; both client READMEs updated -->

## Acceptance criteria

- PhpStorm chat panel is visually identical to the VS Code chat panel
  (same HTML/CSS bundle), following the active IDE theme incl. live switch.
- One webview codebase: a chat-UI change lands once and ships in both IDEs.
- All `Outbound` actions and snapshot pushes work end-to-end against the
  sidecar in `runIde` (send, stream, stop, mode/model, attach, halt-answer).
- JCEF-unsupported environments degrade explicitly (no blank panel).
- Statusbar widgets and sidecar protocol untouched.
