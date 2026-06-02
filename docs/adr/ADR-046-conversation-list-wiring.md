---
adr: 046
title: Conversation List — Wiring ConversationStore.list As The conversationList Protocol Method (T-1301)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 — Q0=A UNANIMOUS (wire conversationList; complementary to search), Q2=A UNANIMOUS (reuse the ConversationSummary DTO); Q1 SPLIT (codex A return all / gemini B optional limit + hard ceiling) → RESOLVED B for sibling-consistency with conversationSearch's MAX ceiling; Q3 SPLIT (codex C n/a / gemini B truncated signal) → RESOLVED to carry `total` so the sidebar can show "showing N of M"; Q4 traps — keep Methods sorted, hand-maintained codegen descriptors, Kotlin doc ≤112 chars, EOPT-safe projection)
related: discharges the read transport of T-1301 "conversation list in left sidebar" (road-to-v1-0 Phase 13). The core ConversationStore.list shipped engine-complete in ADR-008/2026-05-31 with ZERO production callers. This slice exposes it over the wire; the sidebar render + click-to-open remain the IDE last-mile, so T-1301 stays `[~]`. Direct sibling of ADR-045 (conversationSearch), reusing its ConversationSummary DTO.
date: 2026-06-02
---

# ADR-046 — Conversation List (wiring ConversationStore.list as the conversationList protocol method, T-1301)

## Status

**Proposed** — awaits sign-off. One branch / one PR, three commit chunks
(protocol + codegen → core → docs), preserving minimal-safe-diff.

CI-verified locally: lint clean, build clean, typecheck clean, format clean;
protocol 53 pass (+1), core 1095 pass / 1 skip (+4); `jetbrains:check` BUILD
SUCCESSFUL; codegen idempotent at 59 DTOs (+2); sidecar startup smoke clean
(`agent core ready`). **No checkbox flip** — T-1301 stays `[~]`.

## Context

With `conversationSearch` shipped (ADR-045), the Explore seam-hunt confirmed the
named next slice is the cleanest remaining pure-core seam:
`ConversationStore.list` (`chat/store.ts`). It is built + unit-tested and
returns `ConversationSummary[]` (id, title, parentId?, messageCount,
checkpointCount, createdAt, updatedAt) sorted newest-`updatedAt`-first, with no
message bodies — but NOTHING calls `store.list` in the production path (ZERO
live callers). The `ConversationStore` is ALREADY live (wired into `ChatHandler`
for `conversationRewind`/`conversationSearch`, ADR-040/045), so the data is
available; only the transport is missing.

`conversationList` is the IDE history sidebar's **default-state** data path:
search needs a query and returns `[]` for an empty one (ADR-045 Q2), so it
cannot populate the "all conversations" view. The two methods are
complementary, not redundant. The next-cleanest alternative (`commands/picker.ts`)
remains entangled — its sibling `loadCommandProcedure` is also dead, so the whole
command-palette pipeline is unwired.

## Decision

Add a non-streaming `conversationList` protocol method
(`ConversationListRequest {limit?}` → `ConversationListResponse {conversations:
ConversationSummary[], total}`) backed by a new `ChatHandler.list` that delegates
to `store.list`, clamps the count, projects lightweight summaries onto the wire,
and reports the full count. Registered in the dispatcher `handlers` map behind
the existing `requireChat()` guard (`chat_not_configured` when no chat handler is
wired). A near-exact mirror of `ChatHandler.search` (ADR-045).

**Wire shape (AI council 2026-06-02):**

- **Reuse `ConversationSummary` (Q2=A, UNANIMOUS).** The history sidebar wants
  exactly these fields; the DTO already exists from ADR-045 — no list-specific
  item type. Less DTO drift.
- **Hard result ceiling (Q1 SPLIT → resolved B).** codex argued summaries are
  lightweight metadata — just return all (A); gemini argued capping protects the
  single NDJSON line from a workspace with thousands of conversations (B).
  Resolved **B** against the code: the immediate sibling `conversationSearch`
  this PR mirrors already bounds its output with
  `MAX_CONVERSATION_SEARCH_RESULTS=100` for exactly this reason — bounding only
  search but not list (which returns *everything*, not a filtered subset) would
  be inconsistent and leave the larger response unbounded. Core clamps to
  `MAX_CONVERSATION_LIST_RESULTS` (100): `min(limit ?? MAX, MAX)`. A smaller
  `limit` rides through unchanged; the schema rejects a non-positive /
  non-integer `limit` at the boundary.
- **Carry `total` (Q3 SPLIT → resolved to carry it).** codex said no signal is
  needed (C); gemini said the sidebar must know whether it sees the full history
  (B). Resolved to carry `total` — the full count before the cap — for a reason
  specific to `list`: it means "show everything", so a silent truncation would
  *hide history* (a real UX bug that does not apply to search's filtered
  subset). `total` is free because the store already loads every conversation to
  build the summaries; the IDE derives `truncated = conversations.length <
  total` and can show "showing N of M". This is the one deliberate divergence
  from search's response shape, justified by list's distinct semantics.

**Traps guarded (council Q4):**

- **`Methods` stays sorted** — `conversationList` is inserted before
  `conversationRewind`/`conversationSearch` (alphabetical `L < R < S`); the
  registry test asserts the exact sorted key list.
- **Hand-maintained codegen descriptors** — `scripts/codegen.ts` is a manual
  DTO descriptor list (not Zod-traversal), so the two new request/response
  descriptors were added by hand; `task codegen` regenerated `Protocol.kt`
  (57 → 59 DTOs).
- **Kotlin doc ≤112 chars** — both generated DTO `doc:` strings stay well under
  the detekt `MaxLineLength(120)` ceiling (longest 84).
- **exactOptionalPropertyTypes-safe projection** — the handler maps each summary
  with a conditional spread (`...(parentId !== undefined ? {parentId} : {})`),
  never emitting explicit `undefined` into the optional wire field.
- **Empty request** — `ConversationListRequestSchema.parse(data ?? {})` accepts
  a missing/empty payload; the IDE lists everything by default.

## Consequences

**Positive.** The "conversation list in left sidebar" capability (T-1301) has
its first wire transport, completing the read pair (list + search) the history
sidebar consumes. No native deps, no new IDE surface needed at the transport
level, the `ConversationSummary` DTO is reused unchanged. The hard ceiling
bounds the response regardless of caller behaviour; `total` keeps truncation
honest.

**Negative / limits.** The sidebar render + click-to-open remain IDE last-mile,
so the transport is live but unexercised end-to-end until the IDE calls it.
Cursor-based pagination (load older conversations past the ceiling) is a
documented follow-up if a workspace ever exceeds 100 conversations and the user
needs the tail before searching — `total` already gives the IDE the signal to
ask for it.

**No checkbox flip.** T-1301 stays `[~]` — the conversation list render,
click-to-open, and search box are IDE surfaces. Dashboard counts unchanged.

## Alternatives considered

- **Return all summaries, no cap (Q1=A, codex).** Rejected for
  sibling-consistency — the search method this PR mirrors caps its output for
  NDJSON-line safety; the unfiltered list is the *more* likely to be large, so
  capping it is the consistent choice.
- **Optional limit, no ceiling (Q1=C).** Rejected — trusts the client to bound
  the line; the same NDJSON-bloat risk search's Q3=B guarded against.
- **Silent cap, no `total` (Q3=A/C).** Rejected — for a "show everything"
  listing, silent truncation hides history with no signal; `total` is free and
  honest.
- **Distinct list-item DTO (Q2=B).** Rejected — identical shape to
  `ConversationSummary`; a second DTO is pure drift.
- **`commands/picker.ts` wiring.** Rejected — its sibling `loadCommandProcedure`
  is also dead, so the command-palette pipeline is unwired; more entangled.

## References

- `packages/core/src/chat/store.ts` — `ConversationStore.list` (the reused live store method).
- `packages/core/src/chat/handler.ts` — `ChatHandler.list` + `MAX_CONVERSATION_LIST_RESULTS`.
- `packages/core/src/server.ts` — `conversationList` handler + `requireChat()`.
- `packages/protocol/src/schema.ts` — `ConversationListRequest/Response` (reusing
  `ConversationSummary`) + `Methods.conversationList`.
- `scripts/codegen.ts` — the two new Kotlin DTO descriptors.
- `packages/core/src/chat/handler-list.test.ts` (4 tests),
  `packages/protocol/src/schema.test.ts` (round-trip + sorted registry).
- ADR-008 — persisted history, forking, checkpoints + the list/search store methods.
- ADR-045 — the sibling `conversationSearch` wiring; same store, same pattern, shared `ConversationSummary` DTO.
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2).

## Sign-off

On flip to **Accepted**: the list + search read pair is complete on the wire;
the sidebar render, click-to-open, and search box land with the IDE tool-window
work that closes T-1301. Cursor-based pagination past the 100-conversation
ceiling is the documented follow-up if needed.
