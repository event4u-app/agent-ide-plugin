---
adr: 029
title: Live-Terminal Handler Wiring — Answer terminalSubscribe / terminalInput / terminalResize from the Sidecar (Exit Is the Terminal Envelope, Replay-First, Resolve-on-Exit, Synthesised Already-Done Exit, No-Session Error, Spawn Out of Scope)
status: Proposed (drafted 2026-06-04 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-04 terminal-handler design round — UNANIMOUS A1/B1/C1/D1/E-agree/F-yes/G-confirm; both flagged the same traps — double-exit emission, already-done hang, error-to-exit mapping, backpressure drop-off, sync-resolve ordering)
related: advances T-PRD03 (terminal card render) and road-to-v1-0 T-904/906/907/908 (the terminal core shipped Phase 9 with ZERO dispatcher callers); builds on ADR-003 (NDJSON streaming-as-request) and the chatSend/agentTurn streaming-handler pattern; the xterm.js renderers in both IDEs + the spawn path that populates the manager stay IDE/native work
date: 2026-06-04
---

# ADR-029 — Live-Terminal Handler Wiring

## Status

**Proposed** — awaits sign-off. The live-terminal CORE shipped in Phase 9
(`TerminalSessionManager`, the `Terminal` interface + `FakeTerminal`, the
dual-capped ring buffer, the waiting-for-input state machine) and the three
terminal protocol methods (`terminalSubscribe` / `terminalInput` /
`terminalResize`) plus their Kotlin DTOs were ALL already shipped — but **no
dispatcher handler ever wired them together**, so the sidecar answered all three
with `handler_error`. This slice adds the missing `TerminalHandler` (the mirror
of `ChatHandler` / `GitHandler` / `AgentTurnHandler`). Pure core, CI-verified
with the deterministic `FakeTerminal`; the real `node-pty` factory, the spawn
path that POPULATES the manager (a future `run_shell` agent tool), and the
xterm.js renderers in both IDEs stay native-/IDE-gated — T-PRD03 flips to `[~]`.

## Context

The terminal protocol is a server→client push modelled (ADR-003) as a long-lived
`terminalSubscribe` STREAMING request — one `messageId`, N `done:false` payloads,
a terminal `done:true` — exactly the contract `chatSend` and `agentTurn` later
adopted. The `TerminalSessionManager` already exposes everything a handler needs:
`subscribe()` (atomic replay-snapshot + subscriber registration), `write()`
(FIFO + first-write-wins arbitration), `resize()`, `dispose()` / `disposeAll()`,
and a `TerminalEvent` broadcast union whose `exit` member is the absolute final
lifecycle signal. The three methods were in `MethodNameSchema`/`Methods` (pinned
by the schema keys test) and the DTOs were codegen'd — so **no protocol or
codegen change is needed**; the gap was purely the handler + its dispatcher
registration.

## Decision

Additive, pure-core + handler wiring. No protocol method change (the
`Methods`-keys pin and `Protocol.kt` are untouched — codegen is idempotent); no
IDE render.

1. **Fork A1 — `exit` IS the terminal `done:true` envelope.** The `exit`
   `TerminalEvent` is the protocol's universal session-EOF (`dispose()` →
   `terminal.kill()` → `onExit`, and the real node-pty `kill` → `onExit`, both
   produce it), so it closes the subscribe stream as the single terminal
   envelope. It is NEVER also emitted as a `done:false` event (trap:
   double-exit). No new wire payload — reusing the existing union beats adding a
   `TerminalSubscribeEnd` DTO. (UNANIMOUS.)

2. **Fork C1 — replay response first, synchronously.** `manager.subscribe()`
   registers the `deliver` callback AND snapshots the replay in one synchronous
   call (no gap). The handler emits the `TerminalSubscribeResponse` (replay +
   current state) as the first `done:false` envelope SYNCHRONOUSLY right after,
   before yielding — single-threaded JS guarantees it precedes any live
   `deliver` event. (UNANIMOUS.)

3. **Fork B1 — resolve on the `exit` event; already-done resolves immediately.**
   The returned Promise resolves when `exit` is delivered. A session that already
   exited before this subscriber attached will never see a future `exit` through
   `deliver`, so after emitting the replay response the handler SYNTHESISES the
   terminal `exit` from the session (`exitCode` / `signal`, duration derived from
   the two ISO stamps on one clock) and resolves immediately — otherwise the
   stream would hang forever (trap: already-done hang). (UNANIMOUS.)

4. **Fork D1 — unknown `commandId` is a request error.** `subscribe()` returning
   `undefined` throws `TerminalRequestError('terminal_no_session')`, which the
   dispatcher maps to a single error envelope (mirrors `git_not_configured`) — a
   missing session is a request error, not a lifecycle event. (UNANIMOUS.)

5. **Fork E — spawn stays out of scope (agree).** There is no terminal-spawn
   protocol method; sessions are created server-side by a future `run_shell`
   agent tool. This slice wires ONLY subscribe/input/resize over an injected
   shared manager that something else populates. (UNANIMOUS.)

6. **Fork F — dispatcher shutdown releases sessions (yes).** `Dispatcher.dispose()`
   now also calls `terminalHandler.dispose()` → `manager.disposeAll()` so live
   PTYs/file descriptors are released on shutdown. (UNANIMOUS.)

7. **Fork G — registration (confirm).** `terminalSubscribe` joins the streaming
   branch in `dispatch` (uses `emit`, like `chatSend`/`agentTurn`);
   `terminalInput`/`terminalResize` are plain request/response handlers in the
   `handlers` map. (UNANIMOUS.)

## Consequences

- The sidecar now answers all three terminal methods instead of `handler_error`.
  The xterm.js render in both IDEs and the spawn path that creates sessions are
  the remaining work — T-PRD03 flips `[ ]` → `[~]` (core/transport half done),
  advancing road-to-v1-0 T-904/906/907/908; overall done count unchanged (a
  `[~]` is deferred, not done).
- **Correctness traps guarded** (both reviewers): the `exit` event resolves the
  Promise and is never also streamed as `done:false`; an already-done session
  synthesises its terminal exit so the stream cannot hang; only `exit`
  terminates (`error`/`status`/`inputRequested` stream through and keep the
  stream open); `deliver` swallows a throwing sink so the manager's
  backpressure floor never drops the subscriber before its `exit`; an
  idempotent `settled` finaliser makes resolution exactly-once across the
  dispose/exit races.
- A future mutating `run_shell` tool can create sessions on the same shared
  manager and every surface subscribes to one ordered stream (tmux model).
- The manager defaults to the `FakeTerminal` factory in this wiring; the real
  env-gated `node-pty` adapter (`EVENT4U_ENABLE_PTY`) + its prebuild matrix stay
  the deferred T-901 native follow-up. No session is spawned in production until
  `run_shell` lands, so the default factory is inert there.

## Alternatives

- **A2 — add a `TerminalSubscribeEnd` payload as the terminal envelope.**
  Rejected: needs a new protocol DTO + Kotlin codegen for no behavioural gain;
  the `exit` event already is the universal session-EOF.
- **C2 — emit the subscribe response as the terminal `done:true`.** Rejected:
  contradicts the schema doc ("first envelope of the subscribe stream") and
  leaves no envelope to carry the live events.
- **D2 — resolve `done:true` with an `error` TerminalEvent for a no-session
  subscribe.** Rejected: a missing session is a request error, not a session
  lifecycle event; the coded error envelope matches the rest of the dispatcher.
- **Wire the real node-pty factory now.** Rejected: native, off the default
  graph (no-native-deps law, CI runs node 20); the async `loadNodePtyTerminal`
  does not even fit the sync `TerminalFactory` signature — that is the T-901
  follow-up.

## References

- ADR-003 — NDJSON envelope, streaming-as-long-lived-request
- ADR-013 — tool approval flow (the agentTurn/run_shell that will spawn sessions)
- ADR-023 — agent-turn tool loop (the streaming-handler pattern mirrored here)
- road-to-product-readiness T-PRD03 (terminal card render) · Phase 1
- road-to-v1-0 T-904 / T-906 / T-907 / T-908 (terminal surface)
