---
adr: 003
title: UI Stack — JetBrains (Kotlin + JCEF) + VS Code (webview)
status: Proposed (drafted 2026-05-28 — awaits user sign-off; modified per Spike 0.3a-d outcomes)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (claude-sonnet-4-5 + gpt-4o, 2026-05-28)
related: ADR-001 (Build-vs-Fork), ADR-004 (Permission Model)
date: 2026-05-28
source_spikes: 0.3a (JBCef), 0.3b (JSON-RPC), 0.3c (CLI-pipe), 0.3d (PTY-bridge)
---

# ADR-003 — UI Stack

## Status

**Proposed** — drafted from Phase 3 spike outcomes (research-grade pre-verdicts; runtime spikes 0.3a/b/d not yet executed). Awaits user sign-off + Phase 3 runtime confirmation before flip to **Accepted**.

> **Phase-1 implementation note (2026-05-29).** MVP Sprint-1 (`road-to-mvp.md` T-101–T-107) was implemented against this Proposed decision: single Node sidecar + NDJSON `{ messageId, messageType, data, done }` over stdio for both IDEs; VS Code `WebviewViewProvider`; JetBrains tool window with a **Swing placeholder** (JBCef chat UI deferred to Sprint 2 / T-202). The AI Council (gemini + codex/gpt-5, 2026-05-29) reconfirmed NDJSON over `vscode-jsonrpc` for the **request/response** layer too (not only streaming), with the caveat to keep the envelope JSON-RPC-shaped for a future migration. Status stays **Proposed** — sign-off + runtime spikes 0.3a/0.3b remain the gate to **Accepted**.

## Context

The plugin needs a UI surface in two IDEs. Each has different APIs:

- **JetBrains:** Java/Kotlin, JCEF for webview, Swing/Compose for native UI.
- **VS Code:** TypeScript, standard `WebviewViewProvider` for webview.

Plus a Node sidecar (JSON-RPC over stdio) hosts the LLM transport and agent-config tree-walker.

Three sub-questions resolved by Phase 3 spikes:

1. Is JBCef viable for the JetBrains Cost Dashboard + Settings UI?  (Spike 0.3a)
2. Can a Node sidecar stream 5000 tokens to JetBrains in <3s?  (Spike 0.3b)
3. Can `claude` CLI be the MVP backend transport?  (Spike 0.3c)
4. Can the JetBrains PTY bridge ship in v1.5?  (Spike 0.3d)

## Decision

### JetBrains side

- **Host language:** Kotlin (JVM 17), `intellijIdeaCommunity` platform, `sinceBuild = "242"` default (lowered to "241" if IDE survey finds an event4u team member on 2024.1).
- **Tool window UI:** **JBCef webview** (`JBCefBrowser` with `setOffScreenRendering(true)`) for the chat + cost dashboard + settings.
  - Conditional on Spike 0.3a runtime pass (out-of-process JCEF + Disposer discipline + LafManager-CSS pattern).
  - Fallback: Compose-Multiplatform via Jewel + `ToolWindow.addComposeTab()` if 0.3a fails the memory-stability check (accepting "Compose-in-plugin not officially supported by JetBrains" trade-off).
- **Theme sync:** subscribe to `LafManager.TOPIC`, push CSS variables to webview via `executeJavaScript`. No webview reload on theme switch.
- **Disposer discipline mandatory:** every `JBCefBrowser` / `JBCefClient` / `JBCefJSQuery` registered with IDE Disposer, paired with explicit `Disposer.dispose` on tool-window close.

### VS Code side

- **Host:** TypeScript via standard `WebviewViewProvider` API.
- **Same shared React `gui/`** as JetBrains' JCEF webview. Single React bundle, two host shells.

### Sidecar

- **Single Node sidecar** hosting LLM transport + agent-config tree-walker.
- **Wire format:** newline-delimited JSON (NDJSON) over stdin/stdout. `{ messageId, messageType, data, done }` envelopes.
- **Packaging:** esbuild + `pkg` into platform-native binaries (per Continue.dev's pattern, lifted per ADR-001 Hybrid).
- **Spike 0.3b runtime gate:** 5000 tokens <3s, p99 latency <100ms inter-event, <20MB heap delta. Provisional pass on research-grade evidence (Continue ships this pattern at 33k user scale).

### Provider transports

- **Dual-mode (API + CLI) per provider** is a first-class concept in our `BaseProvider` interface.
- **MVP launch transport: Claude CLI** via `claude --print --output-format=stream-json` (Spike 0.3c live evidence).
- **Pivot from original plan:** CLI is **reply-stream, not token-stream** (Spike 0.3c). MVP UX shows spinner during TTFT (~3s), then full reply at once. Token-stream is API-mode only; deferred to v1.0 Sprint 5 catch-up.
- Session lifecycle: first turn uses fresh `claude --print`, follow-ups use `claude --resume <session_id>`.

### Terminal (v1.0 → v1.5)

- **v1.0:** read-only mirror via `script -F /tmp/event4u-agent-mirror.log` + file tail. Survives IDE close/reopen (file persists). ~1-2 days to ship.
- **v1.5:** read-write PTY via **pty4j** (NOT node-pty) + our own `JBTerminalWidget` instance. Works on Classic terminal regardless of user's 2025.2 Reworked Terminal default. ~1 week to ship.
- **v1.5 survival across IDE restart: NOT promised.** Requires VS Code-class persistent-pty daemon (1-2 weeks). Defer to v1.5+ or rely on Claude `--resume` for session continuity (the underlying Claude Code session survives; the IDE-side PTY does not).

## Consequences

### Positive

- One React `gui/` bundle, two hosts. Reduces UI work surface ~40%.
- JCEF + Node-sidecar is a proven pattern (Continue 33k users).
- pty4j removes Windows ConPTY edge cases that node-pty would force us to own.
- Reply-stream UX is simpler to implement than token-stream (no per-token marshalling).

### Negative

- Reply-stream UX shows 3s spinner during TTFT — "feels slower" than API-mode token-stream. Documented in Phase 8 Demo Script.
- JBCef has documented in-process memory leaks (IJPL-120558 etc.); we mitigate via out-of-process default but bind to a JetBrains-team-managed migration.
- Compose-in-plugin fallback is "not officially supported by JetBrains for 3rd-party plugins" — if 0.3a runtime fails, we accept that compatibility tax.
- Reworked Terminal default in 2025.2 means our own widget looks visually different from user's main terminal. UX wart.
- pty4j ABI binds us to JetBrains' bundled version per IDE release.

### Negative — risks not mitigated

- Spike 0.3a runtime not yet executed; verdict provisional.
- Spike 0.3b runtime not yet executed; verdict provisional.
- Persistent-PTY daemon is a v1.5+ stretch; if a user expects "close laptop, reopen, terminal still there," they will be disappointed.

## Alternatives considered

- **All-Kotlin UI (Compose-Multiplatform, no webview).** Rejected: shared React `gui/` between VS Code and JetBrains is the largest UI-cost saving; can't be reused in Compose.
- **node-pty for the PTY.** Rejected: pty4j is JetBrains-native, removes Windows ConPTY ownership tax.
- **API mode as MVP transport.** Rejected for MVP (council finding: differentiator #2 is dual-mode; ship CLI first), but API mode lands in v1.0 Sprint 5.
- **Reworked Terminal (`TerminalWidget` interface) for our v1.5 PTY.** Rejected: API is still in flux as of 2025.2; Classic widget works regardless of user's engine setting per JetBrains escape-hatch.

## References

- Spike 0.3a — `agents/analysis/spike-reports/spike-0-3a-jbcef.md`
- Spike 0.3b — `agents/analysis/spike-reports/spike-0-3b-jsonrpc.md`
- Spike 0.3c — `agents/analysis/spike-reports/spike-0-3c-cli-pipe.md`
- Spike 0.3d — `agents/analysis/spike-reports/spike-0-3d-pty-bridge.md`
- JetBrains 2025.2 Terminal platform announcement — `https://platform.jetbrains.com/t/terminal-implementation-changes-from-v2025-2-of-intellij-based-ides/2264`
- Continue.dev `binary/src/IpcMessenger.ts` + `extensions/intellij/src/main/kotlin/.../continue/CoreMessenger.kt`

## Sign-off

Awaits user sign-off + Spike 0.3a/b runtime confirmation. On sign-off:
- Flip Status to **Accepted (YYYY-MM-DD)**.
- MVP T-101 + T-102 in `road-to-mvp.md` use the Kotlin / Node-sidecar / React `gui/` shape from this ADR.
- MVP Sprint-4 T-411b (pre-flight cost estimate) reflects the reply-stream UX.
- v1.0 Sprint-5 reflects the deferred token-stream + API-mode catch-up.
