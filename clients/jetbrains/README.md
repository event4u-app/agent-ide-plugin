# event4u Agent — JetBrains client

Kotlin / IntelliJ Platform plugin (PhpStorm 2024.2+ target). Talks to the Node
Agent Core sidecar over NDJSON/stdio (ADR-003).

## Prerequisites

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

## Layout

- `src/main/kotlin/de/event4u/agent/AgentToolWindowFactory.kt` — tool window
  skeleton; pings the sidecar and shows its health.
- `src/main/kotlin/de/event4u/agent/SidecarClient.kt` — NDJSON stdio client.
- `src/main/kotlin/de/event4u/agent/protocol/Protocol.kt` — **generated** by
  `scripts/codegen.ts` from `packages/protocol`. Do not edit by hand; run
  `task codegen`.
- `src/main/resources/META-INF/plugin.xml` — plugin manifest + tool window.
