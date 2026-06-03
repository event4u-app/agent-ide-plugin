# event4u Agent — JetBrains client

Kotlin / IntelliJ Platform plugin (PhpStorm 2024.2+ target). Talks to the Node
Agent Core sidecar over NDJSON/stdio (ADR-003).

## Prerequisites

On macOS the fastest path is the one-time bootstrap task — it installs JDK 17 +
Gradle via Homebrew and generates the wrapper jar:

```bash
task jetbrains:setup    # or `task setup` from the repo root for the full bootstrap
```

Manual / non-Homebrew setup:

- **JDK 17** (the plugin targets JVM 17 via `jvmToolchain(17)`).
- **Gradle wrapper jar.** This repo ships `gradle/wrapper/gradle-wrapper.properties`
  but not the binary `gradle-wrapper.jar`. Generate it once with a Gradle
  install present:

  ```bash
  cd clients/jetbrains
  gradle wrapper --gradle-version 8.11.1
  ```

## Build & run

```bash
task jetbrains:check    # ./gradlew check  — compile + detekt + ktlint
task jetbrains:runIde   # ./gradlew runIde — sandbox IDE with the plugin
```

> The CI Kotlin job (`.github/workflows/ci.yml`) runs `./gradlew check` on a
> JDK-17 runner. Local verification requires a JVM, which is why these steps
> are not exercised in environments without one.

## Chat UI — shared JCEF webview

The chat tool window renders the SAME webview bundle as the VS Code
extension (ADR-055): `clients/vscode/scripts/build-jcef-html.mjs` emits a
self-contained `src/main/resources/webview/chat.html` (gitignored build
output, produced by `task build` / `pnpm run build`), and
`chat/JcefChatPanel.kt` loads it into a `JBCefBrowser`. IDE-theme colors map
onto the webview's `--vscode-*` variables via `ui/ThemeCssExporter.kt`, with
live re-injection on theme switch. Without the Node build the panel shows a
notice instead — `./gradlew check` never needs the bundle.

## Layout

- `src/main/kotlin/de/event4u/agent/AgentToolWindowFactory.kt` — tool window
  factory; mounts the JCEF chat panel.
- `src/main/kotlin/de/event4u/agent/chat/JcefChatPanel.kt` — JCEF host for
  the shared chat webview (bridge + snapshot push + theme injection).
- `src/main/kotlin/de/event4u/agent/SidecarClient.kt` — NDJSON stdio client.
- `src/main/kotlin/de/event4u/agent/protocol/Protocol.kt` — **generated** by
  `scripts/codegen.ts` from `packages/protocol`. Do not edit by hand; run
  `task codegen`.
- `src/main/resources/META-INF/plugin.xml` — plugin manifest + tool window.
