---
adr: 012
title: Streaming Client Integration — Separate Correlation Map, Session conversationId, Mode→Provider, Env-Key, Snapshot-per-Token
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 streaming-client design round — UNANIMOUS on all five forks)
related: road-to-vertical-slice Phase 2 (T-VS05–08, VS Code) + Phase 3 (T-VS09–11, JetBrains); builds on ADR-010 (streaming dispatch) + ADR-011 (provider registry + sidecar wiring)
date: 2026-05-31
---

# ADR-012 — Streaming Client Integration

## Status

**Proposed** — drafted alongside the road-to-vertical-slice Phase 2/3 client
wiring (`clients/vscode/src/sidecar-client.ts`, `chat-controller.ts`,
`extension.ts`; `clients/jetbrains/.../SidecarClient.kt`,
`chat/SidecarChatController.kt`, `AgentToolWindowFactory.kt`). Awaits explicit
user sign-off; the in-IDE visual smoke (EDH + `task jetbrains:runIde`) signs the
verification log.

## Context

ADR-010 made the sidecar stream `chatSend`; ADR-011 wired a real `ChatHandler`
so the sidecar answers it. But both clients were dead-ends: each sidecar client
was **request/response only** (a `pending` map keyed by `messageId`, deleted on
the *first* reply — so a streamed `done:false` token consumed the correlation
and the terminal envelope was dropped), the JetBrains chat was a hardcoded
`PlaceholderChatController` returning a stub string, and the VS Code
`webview.onDidReceiveMessage` was a no-op. Result: "I can't chat" in a running
IDE even though `ping` and `chatSend` both worked at the sidecar.

## Decision

Wire both clients to stream. Five forks, all ratified **UNANIMOUS** by the AI
council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31):

1. **Separate streaming-correlation map.** Add a `streaming` map (messageId →
   handler invoked for *every* envelope, self-deleting on terminal `done:true`)
   checked **before** the one-shot `pending` map. The boring request/response
   path stays untouched; only `chatSend` uses the new `requestStream`.
2. **One stable `conversationId` per chat session** (not per send) — enables
   multi-turn history, matches the persistence store, and lets `chatCancel`
   target the live turn.
3. **Mode → providerId.** The existing API/CLI pill maps to a provider:
   `API → undefined` (sidecar default) and `CLI → 'claude-cli'`. CLI mode then
   chats with **zero key config** — the immediate win in a running IDE.
4. **API key via IDE env, not relaunch.** The spawned sidecar inherits the
   IDE's env (so an exported `ANTHROPIC_API_KEY` flows); VS Code additionally
   reads an explicit `event4u.anthropicApiKey` setting and passes it into the
   spawn env. JetBrains relies on the keychain-set env var (its settings panel
   already deep-links there) — no key-storage code added.
5. **Full snapshot per token (v0).** The host re-pushes the whole
   `ChatModelSnapshot` per token; the webview / Swing panel already re-render
   from a snapshot. Incremental token frames are a later optimization.

**Threading (council trap).** The streamed read runs off the UI thread: a daemon
thread in JetBrains (`ChatPanel.renderModel` self-marshals to the EDT), a
promise in VS Code. Stop sends `chatCancel` on its own non-blocking path so the
blocked reader never deadlocks the UI; stale frames from a finished turn are
guarded by the active assistant-message id. The JetBrains streaming reader uses
a bounded `ArrayBlockingQueue(1)` so a timed-out poll never leaves the reader
blocked on a `put`.

## Consequences

- A real chat turn streams token-by-token into both surfaces, Stop aborts via
  `chatCancel` (partial kept, per ADR-010), and the cost footer fills from the
  terminal payload. CLI mode needs no key.
- `PlaceholderChatController` is deleted; the JetBrains controller is disposed
  with the tool-window content, so no orphan sidecar survives a close (MVP exit
  criterion).
- New surface: `SidecarClient.requestStream` (both clients), VS Code
  `ChatController`, JetBrains `SidecarChatController`.
- Unit-tested: VS Code `chat-controller.test.ts` (token stream → terminal text +
  cost, mode→provider, error render, stop→cancel) + `sidecar-client` streaming
  integration; JetBrains via `gradle check` (compile + ktlint + detekt + tests).
  **In-IDE visual render stays human-smoke-gated** (EDH + runIde).

## Alternatives considered

- **Refactor the single map to always-multi** — rejected: needless regression
  risk to the stable request/response path.
- **Fresh conversationId per send** — rejected: loses multi-turn history and
  complicates cancel targeting.
- **Ignore the mode pill, always default provider** — rejected: the pill is
  already in the UI; mapping it to a provider makes it real and unlocks keyless
  CLI chat.
- **Require the user to relaunch the IDE from a key-configured shell** —
  rejected: pass the key into the spawn env instead.
- **Incremental token frames to the webview** — deferred: snapshot re-render is
  correct and simple for v0.

## References

- `clients/vscode/src/sidecar-client.ts` / `chat-controller.ts` / `extension.ts`.
- `clients/jetbrains/.../SidecarClient.kt` / `chat/SidecarChatController.kt` / `AgentToolWindowFactory.kt`.
- ADR-010 (streaming dispatch), ADR-011 (provider registry + sidecar wiring).
- road-to-vertical-slice Phase 2/3; `docs/MANUAL_VERIFICATION.md § Vertical slice`.

## Sign-off

On flip to **Accepted**: the in-IDE smoke (EDH + `task jetbrains:runIde`) is run
and captured in `docs/MANUAL_VERIFICATION.md`; the Phase 2/3 render items
(T-VS06/07/08/10/11) and exit gates flip from `[~]` once the human smoke passes.
