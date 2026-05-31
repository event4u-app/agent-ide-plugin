---
adr: 018
title: Abortable Streaming Refinements — Cooperative AbortSignal Through Embedding, MCP Tool Calls, and Session Scans (Trailing-Param, AbortError Reject, Request-Scoped MCP Cancel, Fail-Open Re-Throw)
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 T-1305 design round — UNANIMOUS forks B1/C1/D1/E1/F; SPLIT fork A resolved to A1 on the existing `stream(request, signal?)` precedent)
related: road-to-v1-0 Phase 13 (T-1305); extends the three-layer cancellation model of `llm/cancellation.ts` (T-412) past the LLM stream into the remaining long-running core operations
date: 2026-05-31
---

# ADR-018 — Abortable Streaming Refinements

## Status

**Proposed** — the pure-core seam of T-1305. The Stop **button** and ESC binding
are IDE surfaces and stay deferred; this ADR covers the core abort-propagation
that those surfaces drive, which is autonomous and CI-verified.

## Context

`CancellationToken` (`llm/cancellation.ts`, T-412) already owns an
`AbortController`, kills child processes, and its `.signal` is threaded through
every LLM streaming backend. But three other long-running core operations never
observed that signal, so a Stop could not interrupt them:

1. **Embedding** — `Embedder.embed(texts)` (Fake / Transformers / Remote), wrapped
   by `EmbeddingCache.embed` and called from `ContextEngine` at index time (batch)
   and query time (single vector).
2. **MCP tool calls** — `McpClient.callTool` / `listTools` over an id-correlated
   `request()` bounded only by a per-request timeout; wrapped by
   `McpToolRegistry` / `McpManager`.
3. **Session scans** — `SessionBrowser.listSummaries` / `loadMessages` fan out over
   five lossy, fail-open adapters doing JSONL fs walks.

Project laws in play: no native deps; additive / minimal-diff; the existing LLM
streams (async generators) signal abort by yielding `{kind:'error',
code:'aborted'}`. The three operations above are plain Promises, not generators,
so they need a Promise-shaped cancellation contract.

## Decision

A single cooperative-cancellation contract, applied uniformly. Helpers live in
`packages/core/src/abort.ts` (`throwIfAborted`, `isAbortError`).

- **Fork A — signature shape → A1 (trailing `signal?: AbortSignal`).** Council
  split A1 (gemini) vs A2 options-object (codex); resolved to **A1** because the
  shipped backend convention is already `stream(request, signal?)`, so a trailing
  optional signal matches the surrounding code and keeps every change additive
  (existing callers and inline test fakes compile unchanged).
- **Fork B — abort semantics → B1.** On abort the Promise **rejects** with the
  signal's reason (a standard `AbortError`) via `signal?.throwIfAborted()` at
  cooperative checkpoints, plus passing `signal` to `fetch` for `RemoteEmbedder`.
  No second cancellation contract layered on top of the Web/Node standard.
- **Fork C — MCP in-flight cancel → C1 (request-scoped).** An abort listener
  rejects **only that** pending request (clearing its timer, mirroring the
  existing timeout path) and leaves the client alive, so concurrent / later calls
  still work. A shared `settle(id)` helper clears the timer **and** detaches the
  abort listener at every resolution site (reply, timeout, send-failure,
  transport death) — no listener leak.
- **Fork D — embedder granularity → D1.** Entry-check + `fetch` signal only; an
  embedding batch (sync Fake, one ONNX call, one HTTP round-trip) is atomic, so
  chunk-level checks are over-engineering until there is evidence otherwise.
- **Fork E — session-scan granularity → E1.** Adapters check the signal **between
  files** (in the shared `scanJsonlSource` loop and the gemini/api per-file
  loops), so a Stop interrupts a long multi-file walk rather than only at entry.
- **Fork F — cache forwarding → yes.** `EmbeddingCache.embed` forwards the signal
  to the underlying embedder **on a cache miss** (where the network / model cost
  is); cache hits stay instant.

### Load-bearing correctness point — fail-open must not swallow aborts

`SessionBrowser.listSummaries` (and the adapter `loadMessages` paths) degrade
genuine parse / IO errors to a diagnostic. An abort is **user intent**, not a
failure, so swallowing it would make Stop a silent no-op. The fix:
`if (isAbortError(error)) throw error;` re-throws aborts out of every fail-open
catch while leaving the degrade-on-real-error behaviour intact (regression-tested
both ways).

## Consequences

- A Stop now aborts embedding, MCP tool calls, and session scans, not just the
  LLM stream — closing the T-1305 gap in core.
- Every change is additive: the `signal` parameter is optional everywhere, so no
  existing caller or inline-fake test breaks; the IDE render halves bind to these
  parameters later (the established "ship core ahead of the card" pattern).
- New rejection paths exist where callers previously assumed succeed-or-fail-open
  (codex's flagged risk). Handled by the fail-open re-throw rule above; callers at
  the cancellation boundary (the chat handler / agent loop) already treat an abort
  throw as a cancel, not an error.
- **Known limitation (gemini's flag):** rejecting the client-side MCP promise does
  **not** send a server-side cancellation (`notifications/cancelled`), so a remote
  MCP tool may keep running to completion server-side. Acceptable for v0; a
  cancellation notification is a deferred enhancement.

## Alternatives considered

- **A2 options-object / A3 pass the whole `CancellationToken`** — rejected: breaks
  the established trailing-`signal?` convention and couples callers to the token
  type instead of the standard `AbortSignal`.
- **B2 resolve to an empty sentinel on abort** — rejected: hides cancellation from
  callers and conflates "aborted" with "no results".
- **C2 mark the whole MCP client dead on abort** — rejected: an abort is
  request-scoped user intent, not transport breakage; killing the session would
  needlessly drop other in-flight and future calls.
- **D2 chunked batch checks** — deferred: changes batching behaviour for no
  demonstrated responsiveness win.

## Sign-off

On flip to **Accepted**: none beyond the merge — this is an internal core seam.
The Stop-button / ESC IDE surfaces that drive these signals remain tracked under
T-1305's IDE half and `docs/MANUAL_VERIFICATION.md`.

## References

- `packages/core/src/abort.ts` — the shared `throwIfAborted` / `isAbortError` helpers.
- `llm/cancellation.ts` (T-412) — the three-layer cancellation model this extends.
- road-to-v1-0 Phase 13 — T-1305.
