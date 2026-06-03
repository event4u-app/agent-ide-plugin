---
adr: 055
title: JCEF Shared Chat Webview — One Bundle for Both IDEs, Swing Chat Renderer Retired
status: Proposed (drafted 2026-06-03 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council — codex-cli + gemini-cli (2026-06-03), two rounds. Round 1 split on forks 1+2 (source location, loading strategy); round 2 tiebreak with the opposing arguments converged UNANIMOUS A/A/A/A.
related: ADR-003 (UI stack already named "JetBrains (Kotlin + JCEF)" — the Swing chat surface from road-to-mvp-ui-design was the interim); ADR-017 (packaging — the chat.html resource rides the same prepareSandbox/buildPlugin path as the sidecar).
date: 2026-06-03
---

# ADR-055 — JCEF Shared Chat Webview (road-to-jcef-chat-parity)

## Status

**Proposed** — awaits sign-off. One branch / one PR
(`feat/road-to-jcef-chat-parity`), committed in logical chunks (webview
host-bridge → JCEF build artifact → Kotlin panel + serializer + theme
exporter → Swing retirement → docs).

Verified locally: root gates green (lint, format, build, typecheck, test) and
`./gradlew check` BUILD SUCCESSFUL (32 tests, incl. 9 SnapshotJson contract
tests + 4 ThemeCssExporter tests). The interactive `runIde` smoke (focus,
Cmd+Enter, live theme switch) is deferred to a human IDE session — tracked as
`[~]` in the roadmap.

## Context

The VS Code chat panel (HTML/CSS webview, `clients/vscode/src/webview/`) and
the JetBrains chat panel (Swing, `ChatPanel.kt` + `ui/*`) shared design
tokens but not rendering: `JEditorPane` HTML, Swing hover/focus/radius
painting, and font rendering drift made the JetBrains surface visibly worse,
and every chat-UI change had to be built twice. ADR-003 had already picked
JCEF for the JetBrains side; the Swing surface was the MVP interim.

## Decision

Port the JetBrains chat surface to JCEF and make the VS Code webview bundle
the single chat UI for both IDEs. Four council-decided forks:

1. **Source location (fork 1A).** The webview source stays in
   `clients/vscode/src/webview/` — after the `HostBridge` refactor it has
   zero VS Code API imports (pure browser TS). A `packages/webview-ui`
   extraction stays mechanical if a third client ever lands.
2. **Loading (fork 2A).** `clients/vscode/scripts/build-jcef-html.mjs` emits
   a fully self-contained `chat.html` (theme CSS + chat-app bundle inlined,
   `</script` escaped) into `clients/jetbrains/src/main/resources/webview/`
   (gitignored build output). `JcefChatPanel` loads it via
   `JBCefBrowser.loadHTML()` — no scheme handler, no URLs. The resource is
   optional: `gradle check` runs without the Node build and the panel
   degrades to a notice.
3. **Bridge (fork 3A).** `host-bridge.ts` abstracts the host:
   `acquireVsCodeApi().postMessage` under VS Code; under JCEF, outbound goes
   through `window.__e4uJcefPost` (a `JBCefJSQuery` hook injected into the
   HTML before the bundle script) and inbound through
   `window.__e4uHostMessage(json)` invoked via `executeJavaScript`.
   `SnapshotJson.kt` serializes the Kotlin model field-for-field to the TS
   `ChatModelSnapshot` shape; snapshot pushes queue until the webview posts
   `ready`.
4. **Fallback (fork 4A).** The Swing chat renderer is deleted in the same
   change (`ChatPanel`, `ChatMessageRenderer`, `SimpleMarkdownRenderer`,
   `ui/{Chip,Composer,Header,IconButton,ModePill,ModelPill,RoundedPanel,
   WelcomeCard,WrapLayout}`). JCEF-unsupported runtimes get an explicit
   notice panel, not a stale parallel UI. Statusbar widgets stay native
   Swing (`CostFooterFormatter` survives for the statusbar).

Theming: `ThemeCssExporter.kt` maps the active LaF (via `Theme`) onto the
exact `--vscode-*` variable set `theme.ts` consumes and re-injects it on
`LafManagerListener` events — live theme switch without reload.

## Consequences

- Pixel-identical chat in PhpStorm and VS Code; chat-UI changes land once.
- The host↔webview message contract (`snapshot` in, `Outbound` kinds out) is
  now cross-IDE API — SnapshotJsonTest locks it; rename only in lockstep.
- The JetBrains plugin ZIP must be built after the Node build so
  `webview/chat.html` exists (`task package` order already guarantees this;
  the CI `package` job builds Node first per ADR-017).
- `pick-model` / `halt-answer` / `attach` remain host-side no-ops on BOTH
  IDEs (parity with `chat-controller.ts`); wiring them is host work tracked
  in road-to-mvp-ui-finish / v1.0.
- Manual verification debt: `runIde` smoke + theme screenshots are `[~]`
  deferred in the roadmap until a human IDE session.

## Alternatives

- **Swing polish to approximate the webview** — rejected: permanent double
  maintenance, approximation ceiling (JEditorPane), the gap that motivated
  this ADR.
- **`packages/webview-ui` workspace package (fork 1B)** — rejected for now
  (1-dev ownership overhead); revisit on a third client.
- **Custom scheme handler (fork 2B)** — rejected: machinery without need for
  a self-contained ~27 KiB document with no external assets.
- **Keep Swing behind a flag for one release (fork 4B)** — rejected
  unanimously by council round 1: double UI maintenance exactly when the
  goal is a single surface.

## References

- Roadmap: `agents/roadmaps/road-to-jcef-chat-parity.md` (incl. § Findings —
  the `JsonObjectBuilder.put` Map-semantics gotcha and the ktlint/detekt
  line-length conflict).
- ADR-003 (UI stack), ADR-017 (packaging path).
