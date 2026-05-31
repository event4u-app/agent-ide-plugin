---
adr: 009
title: Live PTY Terminal Core — Interface+Fake PTY, Streaming-Subscribe Push, Dual-Cap Ring Buffer, First-Write-Wins Input
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-31 Phase 9 design round)
related: road-to-v1-0 Phase 9 (T-901, T-902, T-903, T-905, T-906)
date: 2026-05-31
---

# ADR-009 — Live PTY Terminal Core

## Status

**Proposed** — drafted alongside the road-to-v1-0 Phase 9 core implementation
(`packages/core/src/terminal/`, `packages/protocol/src/schema.ts`). Awaits
explicit user sign-off before flip to **Accepted**.

## Context

Phase 9 ships a real PTY-backed live terminal in the chat card with
dual-surface sync. Most of the phase is IDE-/native-gated (xterm.js renderers,
the VS Code Pseudoterminal bridge, the JetBrains read-only mirror, and the
`node-pty` native binding itself). But the session model, the output buffering
and replay, the waiting-for-input detection, the input arbitration, and the
wire schema are a substantial pure-core seam that can ship and be unit-tested
ahead of those surfaces — the same shape Phase 8 (embeddings) used for the
native ONNX dependency.

Four forks needed a decision; all four were put to the AI Council
(codex/gpt-5.5 + gemini-2.5-pro, **UNANIMOUS on all four**):

1. **node-pty is native** — off the default dependency graph by project law
   (no-native-deps; the CI matrix runs node 20). Build the core slice now, or
   defer the whole phase until the native binding lands?
2. **Server→client push in a request/response-only protocol.** Terminal output
   is genuinely high-frequency server-initiated streaming — the first such case.
   Reuse the streaming envelope, add a notification concept, or poll?
3. **Output buffer + replay shape** for reconnect after an IDE restart.
4. **Input arbitration** when two surfaces answer the same prompt.

## Decision

### 1. Interface + Fake + gated dynamic import for node-pty (T-901)

`Terminal` is an interface (`onData`/`onExit`/`onReadIdle?`/`write`/`resize`/
`kill`); `FakeTerminal` is a deterministic, scriptable implementation that every
unit test drives; the real binding loads via a dynamic `import()` of a
**string-variable** specifier (`'node-pty'`) so `tsc` never resolves the absent
package, gated behind `EVENT4U_ENABLE_PTY`. Identical to the Phase-8 ONNX
playbook. The native binding + the 6-architecture prebuild matrix are the
deferred T-901 follow-up; the loader rejects with a clear, tested message until
then.

Council guard: the Fake is **chunk-based, never line-oriented** — tests emit
split ANSI, `\r` without `\n`, prompts without a trailing newline, and output
*after* exit (the real-PTY race). `onExit` is the absolute final signal.

### 2. Server→client push as a long-lived `terminalSubscribe` streaming request

No new notification concept (ADR-003 request/response uniformity stays intact).
The client subscribes with a `messageId`; the Core streams typed
`TerminalEvent` payloads (`output` / `status` / `inputRequested` /
`inputConflict` / `exit` / `error`) with `done:false` on that id until the
session exits or is disposed (`done:true`). Many subscribe `messageId`s map to
one session, so a reconnecting surface just re-subscribes with `replayFromSeq`.
Rejected: a fire-and-forget notification widens every transport assumption;
polling adds latency and backpressure immediately.

### 3. Dual-cap output ring buffer with explicit loss metadata (T-902)

Cap by **both** UTF-8 bytes (10 MiB — protects sidecar memory) and `\n`-counted
lines (5000 — keeps the buffer human-useful). `seq` is monotonic **per chunk**
(not per line — PTY output has partial lines and CR redraws, so a line count is
a soft heuristic, never an index). `since(seq)` returns
`{chunks, droppedChunks, droppedBytes, firstSeqAvailable, nextSeq,
restartRequired}`; a replay request below `firstSeqAvailable` sets
`restartRequired` so a reconnecting renderer cold-boots instead of appending.
The most-recent chunk is always retained even if it alone exceeds a cap.

### 4. First-write-wins input arbitration per `inputRequestId` (T-905/T-906)

Each confirmed waiting-for-input raises a stable `inputRequestId`. The first
surface to answer **that** request wins (its bytes go to the PTY); later answers
are rejected with the winner's `surfaceId` and the loser receives an
`inputConflict` event. Arbitration is scoped to the request, **not** the
session; raw writes (no active prompt) are accepted and serialised FIFO. The
PLAN's claim-duration exclusive write for multi-line REPL sessions is deferred —
`inputRequestId` is introduced now precisely so that deferral is not a migration
trap.

Waiting-for-input detection combines three strategies (PLAN.md §8.9.3): a
heuristic regex over the last ~200 ANSI-stripped bytes is a **tentative UI
hint**; the 800 ms idle timeout (or the PTY read-idle hook) is what **confirms**.
New output clears the state (no banner flicker). The ring buffer stores raw
output (xterm.js wants the ANSI) but the heuristic runs over a stripped view, so
a coloured `Password:` prompt still matches.

## Consequences

- **Positive.** The whole session/buffer/arbitration/protocol surface is
  unit-tested (54 core + 3 protocol terminal tests) with no native dependency;
  CI stays green on node 20. The IDE renderers consume a stable, typed wire
  contract. Reconnect-after-IDE-restart is designed in (replay + restartRequired)
  rather than bolted on.
- **Negative / deferred.** The Fake cannot prove real-PTY line discipline,
  SIGWINCH, or echo behaviour — those need the integration-gated T-901 binding
  and real-shell smoke tests. The streamed `TerminalEvent` union is not yet a
  Kotlin sealed class (lands with the renderers, T-904/908); only the
  request/response DTOs + `OutputChunk`/`PendingInput`/`ReplaySlice` are
  codegen'd today.
- **Risk.** A long-lived subscribe holds a `messageId` for the life of the
  process; the Core must clean up per-subscriber on disconnect without killing
  the PTY (implemented: `unsubscribe` ≠ `dispose`).

## Alternatives considered

- **Defer all of Phase 9** until node-pty is wired. Rejected: the pure-core
  seam is large, valuable, and verifiable now — the same call as Phase 8.
- **Fire-and-forget notifications** for terminal events. Rejected: widens
  ADR-003 and every client transport. Revisit only if a second server-push
  surface appears.
- **Byte-only buffer cap.** Simpler, but loses the line-count guard the renderer
  relies on to bound work. Kept dual-cap; renamed loss fields to avoid implying
  perfect line accounting.

## References

- `agents/analysis/PLAN.md` §8.9 (Live-Terminal-Execution & Dual-Surface-Sync),
  §8.10 (terminal event schema).
- `packages/core/src/terminal/` — `types.ts`, `pty.ts`, `ring-buffer.ts`,
  `waiting-input.ts`, `manager.ts`.
- `packages/protocol/src/schema.ts` — `terminalSubscribe` / `terminalInput` /
  `terminalResize` + `TerminalEventSchema`.
- ADR-003 (NDJSON envelope) — the request/response law this decision preserves.
- ADR-007 / ADR-008 — the Phase 8/13 precedents for "pure-core seam ahead of
  IDE surfaces" and the interface+Fake+gated-import pattern for native deps.

## Sign-off

On flip to **Accepted**: update PLAN.md §8.9.8 (MVP/v1.0/v1.5 staging table) to
reflect the core slice landed; the native binding (T-901), renderers (T-904),
and IDE bridges (T-907/908) remain the tracked Phase 9 follow-ups.
