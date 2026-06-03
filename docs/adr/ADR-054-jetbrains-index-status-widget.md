---
adr: 054
title: JetBrains Index-Status Statusbar Widget — Capturing The Discarded connect Reply + Polling rootStatus, Display-Only (T-1304 / T-PRD07)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council — codex-cli 0.134.0 + gemini-cli 0.41.2 (2026-06-02), run serially. Q0/Q2/Q3/Q4 UNANIMOUS = A; Q1 split (codex A own-the-lifecycle / gemini B dedicated-service-for-SRP) synthesised; Q5 traps folded in. Live-verified by the maintainer in a running IDE.
related: consumes the `rootStatus` method + `RootIndexStatus` DTO + `WorkspaceCoordinator.status()` shipped by multi-project Phase B (ADR-026 era). Sibling of the cost statusbar widget (`AgentStatusBarWidget`, T-207). First IDE-side surface after the pure-core seam run (ADR-044..053).
date: 2026-06-02
---

# ADR-054 — JetBrains Index-Status Statusbar Widget (T-1304 / T-PRD07)

## Status

**Proposed** — awaits sign-off. Own branch `feat/v1-0-index-status-widget`
off `main` (separate from the embed-cost-tracking PR / ADR-053), committed in
logical chunks (JetBrains client → docs).

CI-verified locally: `task jetbrains:check` BUILD SUCCESSFUL (detekt + ktlint +
compile + the pure-formatter unit tests). **No checkbox flip** — T-PRD07 /
T-1304 also call for a "last update" timestamp + a Reindex action + the VS Code
twin, none of which ship here; the boxes carry a progress note instead (per
`verify-before-complete`).

## Context

The index status is the first IDE-gated surface attempted after the pure-core
runway was exhausted. The data path already existed end-to-end:
`connect` / `workspaceFoldersChanged` / `rootStatus` all return
`RootIndexStatus[]` (`{stableId, state: 'indexing'|'ready'|'error', fileCount,
totalFiles, message}`). The gap was purely client-side: `WorkspaceFolderService`
sent `connect` via a fire-and-forget thread that **discarded the reply**, and
the only statusbar widget (`AgentStatusBarWidget`) showed cost, not index state.

`connect` calls `scheduleIndex()` (async, NOT awaited) then returns `status()`
immediately → the reply shows `state:'indexing'`; the index finishes in the
background. The schema comment is explicit: "Per-root index status the UI polls
(T-MR11)."

## Decision

A display-only statusbar widget fed by a thin observable state holder.

1. **`IndexStatusFormatter`** — a pure function (no IDE types, unit-tested)
   aggregating `RootIndexStatus[]` into one line: error (any) > indexing (any) >
   ready (all); per-root detail in the tooltip (Q2 = A).
2. **`IndexStatusService`** — a project service holding the latest snapshot +
   a listener list. Deliberately NOT an RPC owner: the Q1 split (codex "own the
   lifecycle" / gemini "dedicated service for SRP") is resolved by making it a
   pure state holder whose SOLE writer is `WorkspaceFolderService` — single
   writer (no split state, codex) + UI concern separated (SRP, gemini).
3. **`WorkspaceFolderService` extended** — captures the previously-discarded
   `connect` / `workspaceFoldersChanged` replies into the service AND, while any
   root is `indexing`, polls `rootStatus` on its OWN already-open sidecar
   (no new connection, no extra `.event4u-agent` lock — gemini's Q5 trap),
   stopping when every root settles or on dispose (Q0/Q4 = A).
4. **`AgentIndexStatusWidget`** + factory, registered in `plugin.xml`. Reads the
   service, re-renders on the EDT via `invokeLater` on each push.

**Display-only.** The initial draft had a click → one-shot re-poll as a cheap
"refresh"; the maintainer rejected it. The widget now updates purely from the
response capture + the background poll — no click action. The Reindex action
(T-PRD07) is deferred: no `reindex` RPC exists, and adding one crosses
core+protocol (Q3 = A).

## Consequences

- The index status is now visible while indexing and after it settles — the
  first user-facing IDE surface beyond chat.
- Single-writer state keeps the two services from drifting; the poll reuses the
  existing sidecar, so no second connection contends for the index lock.
- **Not yet done** (boxes stay `[ ]`): the "last update Nm ago" timestamp, the
  Reindex action, and the VS Code twin (immediate follow-up, same effort).
- `WorkspaceFolderService` still opens its OWN sidecar (Phase-B intentional);
  consolidating with the chat sidecar remains host-integration work.

## Alternatives considered

- **Dedicated service owns polling + RPC (gemini Q1 = B).** Rejected as the
  sole owner — it would duplicate the sidecar handle and risk split state; kept
  only as the pure state-holder half.
- **Response-only, no poll (Q0 = B).** Rejected — `connect` returns mid-indexing,
  so the widget would freeze on "indexing".
- **Click → re-poll refresh.** Built, then removed at the maintainer's request.
- **Ship a Reindex action now (Q3 = B).** Rejected — no RPC; separate slice.

## References

- `clients/jetbrains/.../statusbar/IndexStatusFormatter.kt` (+ test),
  `IndexStatusService.kt`, `AgentIndexStatusWidget.kt`.
- `clients/jetbrains/.../workspace/WorkspaceFolderService.kt` — capture + poll.
- `clients/jetbrains/.../resources/META-INF/plugin.xml` — registration.
- ADR-044 (embedder wiring) · multi-project Phase B (`rootStatus`).
