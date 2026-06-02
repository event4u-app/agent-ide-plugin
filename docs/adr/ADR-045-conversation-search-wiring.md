---
adr: 045
title: Conversation Search — Wiring searchConversations As The conversationSearch Protocol Method (T-1301)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 — Q0=A UNANIMOUS (wire conversationSearch over the command-palette seam), Q1=A UNANIMOUS (nested ConversationSummary + ConversationSearchResult DTOs for IDE history reuse), Q2=A UNANIMOUS (empty query is valid → []), Q3=B UNANIMOUS (clamp the result count to a hard ceiling so a missing/huge limit cannot bloat the NDJSON line), Q4=A UNANIMOUS (global scope across all conversations), Q5=A UNANIMOUS (conversationSearch only this PR — defer conversationList), Q6 traps — keep Methods sorted, Kotlin doc ≤112 chars, snippet is intentionally IDE-visible content)
related: discharges the read transport of T-1301 "search across history" (road-to-v1-0 Phase 13). The core searchConversations + ConversationStore.search shipped engine-complete in ADR-008/2026-05-31 with ZERO production callers. This slice exposes searchConversations over the wire; the search box + history sidebar render remain the IDE last-mile, so T-1301 stays `[~]`.
date: 2026-06-02
---

# ADR-045 — Conversation Search (wiring searchConversations as the conversationSearch protocol method, T-1301)

## Status

**Proposed** — awaits sign-off. One branch / one PR, three commit chunks
(protocol + codegen → core → docs), preserving minimal-safe-diff.

CI-verified locally: lint clean, build clean, typecheck clean; protocol 52 pass
(+1), core 1091 pass / 1 skip (+4); `jetbrains:check` BUILD SUCCESSFUL; codegen
idempotent at 57 DTOs (+4); sidecar startup smoke clean (`agent core ready`).
**No checkbox flip** — T-1301 stays `[~]`.

## Context

The Explore seam-hunt for the next pure-core seam re-ranked `phaseRunsInMode`
#1; verified against the code it is the same artificial pick prior cycles
rejected — its only consumer is the unwired AgentDriver and the live
`AgentTurnHandler` loop is iteration-based, so wiring it into the handler would
be a no-op gate. Two genuine zero-caller seams remained:

- **`commands/picker.ts`** (`commandsToPickerItems` + `pickCommands`,
  command-palette fuzzy filtering) — dead, but its sibling
  `loadCommandProcedure` (`commands/loader.ts`) is ALSO dead, so the whole
  command-palette pipeline is unwired. Wiring the picker alone needs a
  command-node source on the wire too → more entangled, larger surface.
- **`searchConversations`** (`chat/search.ts`, T-1301) — a pure,
  dependency-light, case-insensitive token-AND scan over conversation title +
  message bodies, ranked recency-then-hit-count, optional `limit`. Fully
  unit-tested. Exposed via `ConversationStore.search(query, options)` — but
  NOTHING calls `store.search`. The `ConversationStore` is ALREADY live (wired
  into `ChatHandler` for `conversationRewind`, ADR-040), so the data is
  available; only the transport is missing.

`searchConversations` is the substantive, genuinely-clean seam and the direct
sibling of `conversationRewind`: same "core returns data, the IDE renders it"
shape, same live `ConversationStore`, no new IDE surface required at the
transport level, no entangled dead collaborator.

## Decision

Add a non-streaming `conversationSearch` protocol method
(`ConversationSearchRequest {query, limit?}` → `ConversationSearchResponse
{results: ConversationSearchResult[]}`) backed by a new `ChatHandler.search`
that delegates to `store.search`, clamps the count, and projects ranked hits
onto the wire. Registered in the dispatcher `handlers` map behind the existing
`requireChat()` guard (`chat_not_configured` when no chat handler is wired).

**Wire shape (AI council 2026-06-02):**

- **Nested DTOs (Q1=A, UNANIMOUS).** A new `ConversationSummary` DTO
  (id, title, parentId?, messageCount, checkpointCount, createdAt, updatedAt)
  rides inside `ConversationSearchResult {summary, hitCount, snippet?}`. Unlike
  `conversationRewind` (which stayed minimal), search NEEDS the title +
  timestamps for the history sidebar, and the reusable summary DTO is the
  natural shape `conversationList` will reuse later.
- **Empty query is valid → `[]` (Q2=A, UNANIMOUS).** `query: z.string()` (NOT
  `.min(1)`). The pure scan already yields `[]` for an empty/whitespace query,
  so the IDE round-trips a cleared search box without an error boundary — the
  `.min(1)` analogy from rewind's ids does not fit a search box.
- **Hard result ceiling (Q3=B, UNANIMOUS).** Core clamps to
  `MAX_CONVERSATION_SEARCH_RESULTS` (100) independently of the request `limit`:
  `min(limit ?? MAX, MAX)`. A missing or oversized `limit` therefore cannot
  produce an oversized NDJSON line; a smaller `limit` rides through unchanged.
  The schema still rejects a non-positive / non-integer `limit` at the boundary.
- **Global scope (Q4=A, UNANIMOUS).** T-1301 is "search across history" — every
  conversation on record, no per-conversationId filter. A scoped search would be
  a separate feature.

**Traps guarded (council Q6):**

- **`Methods` stays sorted** — `conversationSearch` is inserted directly after
  `conversationRewind`; the registry test asserts the exact sorted key list.
- **Kotlin doc ≤112 chars** — every generated DTO `doc:` string stays under the
  detekt `MaxLineLength(120)` ceiling once wrapped to a single-line `/** */`.
- **`snippet` is intentionally IDE-visible content** — it is a ~80-char excerpt
  of a matched message body, by design (the sidebar preview); treated as
  intentional, not a leak.
- **exactOptionalPropertyTypes-safe projection** — the handler maps each hit
  with conditional spreads (`...(x !== undefined ? {x} : {})`) for `parentId`
  and `snippet`, never emitting explicit `undefined` into the optional wire
  fields.

## Consequences

**Positive.** The "search across history" capability (T-1301) has its first
wire transport, following the proven plan/data-return pattern. No native deps,
no new IDE surface needed at the transport level, the reusable
`ConversationSummary` DTO is in place for a future `conversationList`. The hard
ceiling bounds the response regardless of caller behaviour.

**Negative / limits.** The search box + history sidebar render remain IDE
last-mile, so the transport is live but unexercised end-to-end until the IDE
calls it. Ranking is a deterministic recency-then-hit-count scan, not BM25 —
`minisearch` (already in the dependency graph) is the documented enhancement
path if ranking quality ever matters more than simplicity.

**No checkbox flip.** T-1301 stays `[~]` — the conversation list, click-to-open,
and search box are IDE surfaces. Dashboard counts unchanged.

## Alternatives considered

- **`commands/picker.ts` wiring (Q0=B).** Rejected — its sibling
  `loadCommandProcedure` is also dead, so the whole command-palette pipeline is
  unwired; wiring the picker alone is more entangled and larger surface.
- **`phaseRunsInMode` (the seam-hunt #1).** Rejected — artificial; its only
  consumer is the unwired AgentDriver and the live loop is iteration-based.
- **Flat result DTO (Q1=B).** Rejected — the nested `ConversationSummary` is
  reused by the IDE history view and matches the core object model.
- **Reject empty query with `.min(1)` (Q2=B).** Rejected — a cleared search box
  should round-trip to `[]`, not an error.
- **Bundle `conversationList` in this PR (Q5=B).** Rejected for minimal-safe-diff
  — `conversationList` (`store.list`, also dead) reuses the same new
  `ConversationSummary` DTO and is the obvious next slice, but one seam per PR
  keeps the diff surgical.
- **No result ceiling.** Rejected — a missing/huge `limit` could bloat the
  NDJSON line (council Q3=B).

## References

- `packages/core/src/chat/search.ts` — `searchConversations` (the reused pure scan).
- `packages/core/src/chat/store.ts` — `ConversationStore.search` (the live store method).
- `packages/core/src/chat/handler.ts` — `ChatHandler.search` + `MAX_CONVERSATION_SEARCH_RESULTS`.
- `packages/core/src/server.ts` — `conversationSearch` handler + `requireChat()`.
- `packages/protocol/src/schema.ts` — `ConversationSearchRequest/Response`,
  `ConversationSummary`, `ConversationSearchResult` + `Methods.conversationSearch`.
- `scripts/codegen.ts` — the four new Kotlin DTO descriptors.
- `packages/core/src/chat/handler-search.test.ts` (4 tests),
  `packages/protocol/src/schema.test.ts` (round-trip + sorted registry).
- ADR-008 — persisted history, forking, checkpoints + the search scan.
- ADR-040 — the sibling `conversationRewind` wiring; same store, same pattern.
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2).

## Sign-off

On flip to **Accepted**: the obvious next slice is `conversationList`
(`store.list` → a `conversationList` protocol method, reusing
`ConversationSummary`); the search box + history sidebar render land with the
IDE tool-window work that closes T-1301.
