---
adr: 010
title: Chat Streaming Dispatch — Additive emit-Callback, Cancellation by conversationId, Provider-Direct Slice, Single Cost Shape
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 vertical-slice Phase 1 design round)
related: road-to-vertical-slice Phase 1 (T-VS01, T-VS02, T-VS03, T-VS04), Phase 4 (T-VS12, T-VS13)
date: 2026-05-31
---

# ADR-010 — Chat Streaming Dispatch

## Status

**Proposed** — drafted alongside the road-to-vertical-slice Phase 1 core
implementation (`packages/core/src/chat/handler.ts`,
`packages/core/src/server.ts`, `packages/protocol/src/schema.ts`). Awaits
explicit user sign-off before flip to **Accepted**.

## Context

The engine slices (road-to-v1-0 Phases 5–14) shipped pure-core and unit-tested,
but the user-visible chat request path was never wired: there is a `chatSend`
need but no streaming dispatch. The dispatcher (`packages/core/src/server.ts`)
is **pure request/response** — `dispatch(envelope): Promise<Envelope>` returns
exactly one envelope, and four existing tests assert that. The streaming
`terminalSubscribe` method exists in the protocol registry (ADR-009) but was
never wired into the dispatcher, so `chatSend` is the **first** method to need a
streaming dispatch path.

Four forks needed a decision; all four were put to the AI Council (codex-cli
0.134.0 + gemini 0.41.2, **UNANIMOUS on all four**):

1. **How to make the dispatcher streaming-capable** without breaking the four
   request/response tests or the transport contract.
2. **How to key cancellation** given `chatCancel` carries `{conversationId}`.
3. **How much to put in the slice** — a single provider turn, or the full
   multi-step `AgentDriver` tool loop.
4. **What to do with partial output on a mid-stream cancel.**

## Decision

### 1. Additive optional `emit` callback (T-VS03)

`dispatch(envelope, emit?: (e: Envelope) => void): Promise<Envelope>`. Request/
response methods ignore `emit` and return their single envelope unchanged — the
four existing tests are untouched. The streaming `chatSend` pushes `done:false`
token envelopes through `emit` and **returns** the terminal `done:true`
envelope. `main.ts` writes each emitted envelope, then the returned terminal.

Rejected: changing `dispatch` to return `AsyncIterable<Envelope>` (breaks every
caller/test); making the dispatcher an `EventEmitter` (global, stateful,
re-entrancy hazard). The emit-callback is the minimal-safe-diff choice and
mirrors the `terminalSubscribe` streaming model (one `messageId`, N `done:false`,
terminal `done:true`).

**Council guard — exactly-once terminal (the single biggest risk).** The
streaming handler may emit **only** `done:false` envelopes; it never emits a
terminal. The dispatcher owns the one-and-only terminal: it wraps any thrown
error into a single terminal error envelope and **never rejects**. So a
streaming client always sees the stream close — a handler that throws after
emitting tokens cannot leave the client hanging.

### 2. Cancellation keyed by `conversationId` (T-VS02)

`chatCancel({conversationId})` aborts the in-flight turn for that conversation.
The handler holds a `Map<conversationId, CancellationToken>` and reuses the
shipped three-layer `CancellationToken` (AbortController → backend stream + tool
calls → CLI subprocess kill). One in-flight turn per conversation: a second
`chatSend` for a conversation already streaming is rejected with `ChatBusyError`
(`code: 'chat_busy'`) rather than silently cancelling the first or interleaving.

### 3. Provider-direct slice (T-VS03)

The slice runs a **single LLM turn** straight against the resolved `LlmBackend`
stream — no tool loop. The multi-step `AgentDriver` (road-to-v1-0 Phase 7) folds
in as a follow-up. This is the roadmap's stated Phase-1 fallback and the right
minimal scope: it proves the high-risk infrastructure (NDJSON streaming →
persistence → usage → cost → clean cancel) before the agent-loop logic layer
plugs into a verified transport.

### 4. Keep + persist partial text on cancel (T-VS02)

A mid-stream abort keeps the assistant text streamed so far, persists it to the
conversation store (the user saw it; the tokens were paid for), and returns the
terminal `done:true` with `{cancelled:true, usage(best-effort), cost,
stopReason:'cancelled'}`. Discarding the partial would desync the persisted
history from the user's visual history. A backend that throws on abort is
treated as a cancel, not an error.

### 5. Single cost shape both clients only format (T-VS12)

The terminal payload carries one `ChatCost` `{model, mode, totalUsd,
isEstimate}` — camelCase, decoupled from the Core-internal snake_case
`LlmUsage` so the Kotlin DTO codegen needs no `@SerialName`. There is **no
per-client cost math**: both VS Code and JetBrains only render this shape. A
protocol test pins the four fields as the contract. API mode (`mode:'api'`)
carries the real metered cost (`isEstimate:false`); CLI mode (`mode:'cli'`)
carries the would-have-cost-on-API shadow figure (`isEstimate:true`); an absent
or unknown pricing book yields `{totalUsd:0, isEstimate:true}` (fail-open).

**Live vs final reconciliation (T-VS13).** When the IDE renders a *live* token
counter during the stream it is an **estimate**; the `totalUsd` in the terminal
`done:true` payload is the **authoritative** figure. The two may differ (output
length and cache state are unknown until the turn ends), so a jumpy live counter
settling to a different final number is expected behaviour, **not** a bug. The
final payload always wins.

## Consequences

- **Positive.** The whole request path — streaming dispatch, turn persistence,
  usage, cost, and clean mid-stream cancel — is unit-tested end-to-end with a
  `FakeProvider` (no network) and an in-memory store; the four request/response
  tests stay green. The two IDE client surfaces consume a stable, typed wire
  contract with a single cost shape.
- **Negative / deferred.** `main.ts` constructs the dispatcher **without** a
  `ChatHandler` for now, so a real-sidecar `chatSend` returns a clean
  `chat_not_configured` error until the IDE phases wire real backends + store +
  pricing. The VS Code (`SidecarClient` is request/response only — needs a
  streaming method) and JetBrains streaming clients, the webview/Swing render,
  the Stop control, and the live cost footer are all IDE-runtime-gated
  (road-to-vertical-slice Phases 2–3) and verified by a human smoke run in
  `docs/MANUAL_VERIFICATION.md`.
- **Risk.** `chat_busy` rejects a concurrent send rather than queueing; if a
  real UI ever needs overlapping turns per conversation, the key widens to a
  per-turn id (the `conversationId` key is the deliberate v0 simplification).

## Alternatives considered

- **`AsyncIterable<Envelope>` return.** Cleanest in isolation but breaks every
  existing caller and the four tests — rejected on minimal-safe-diff.
- **Notification concept for tokens.** Widens ADR-003's request/response law (the
  same rejection ADR-009 made for terminal output). Rejected.
- **Fold the `AgentDriver` in now.** Couples the unproven transport to the
  multi-step loop; defeats the point of a vertical slice. Deferred to a
  follow-up against the verified transport.

## References

- `packages/core/src/chat/handler.ts` — the chat-RPC handler (stream, persist,
  cost, cancel).
- `packages/core/src/server.ts` — the `emit`-callback dispatch + `chatCancel`.
- `packages/protocol/src/schema.ts` — `chatSend` / `chatCancel` schemas,
  `ChatUsage` / `ChatCost` / `ChatTokenEvent` / `ChatSendResponse`.
- ADR-003 (NDJSON envelope) — the request/response law this decision preserves.
- ADR-009 — the `terminalSubscribe` streaming precedent this mirrors.
- `packages/core/src/llm/cancellation.ts` — the three-layer `CancellationToken`.

## Sign-off

On flip to **Accepted**: the IDE streaming clients (T-VS05–T-VS11) and the
`SidecarClient` streaming method remain the tracked road-to-vertical-slice
follow-ups; `main.ts` wires a real `ChatHandler` (backend resolver + store +
pricing) as part of Phase 2.
