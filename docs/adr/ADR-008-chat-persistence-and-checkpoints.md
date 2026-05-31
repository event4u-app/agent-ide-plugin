---
adr: 008
title: Chat Persistence (append-only JSONL event log) + Copy-on-Write Forking + Metadata-only Checkpoints
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-31 Phase 13 design round)
related: road-to-v1-0 Phase 13 (T-1301, T-1302, T-1303, T-1307)
date: 2026-05-31
---

# ADR-008 — Chat Persistence + Forking + Checkpoints + Workspace Guidelines

## Status

**Proposed** — drafted alongside the road-to-v1-0 Phase 13 core implementation
(`packages/core/src/chat/`, `packages/core/src/guidelines/`). Awaits explicit
user sign-off before flip to **Accepted**.

## Context

Phase 13 lands UX-polish state plumbing. Most of the phase is IDE-gated
(renderers, statusbar widget, abortable streaming), but four tickets have a
meaningful pure-core seam that can ship and be unit-tested ahead of the IDE
surfaces. Three forks needed a decision and all were put to the AI Council
(codex/gpt-5.5 + gemini-2.5-pro):

1. **On-disk conversation format (T-1301).** History must list, open, and
   search; on top of that, forking (T-1302) and checkpoints (T-1303) mutate the
   record. One rewritten JSON document per conversation, or an append-only
   JSONL event log? The no-native-deps law already forbids sqlite/FTS.
2. **Fork model (T-1302).** A branch tree inside one file, or copy-on-write to
   a new conversation with lineage pointers?
3. **Checkpoint + rewind (T-1303).** "Rewind to checkpoint" is specified to
   restore *conversation + file* state. Core has no file-write authority for a
   rewind. What is the minimal core contract that lets the IDE do the restore?

## Decision

### 1. Append-only JSONL event log per conversation

Each conversation is one `<workspace>/.event4u-agent/chats/<id>.jsonl`, one
zod-validated `ConversationEvent` per line (`created` / `message` /
`checkpoint` / `meta`). Reads **fold** the events into a `Conversation`. This
mirrors the established `tracking/db.ts` append-only precedent and is safer
than rewriting a growing JSON document on every turn.

The fold is **tolerant by construction**: blank lines, non-JSON lines, and
schema-invalid records are skipped, never thrown — a torn trailing line from a
crash mid-append degrades gracefully instead of corrupting the conversation.
A log with no valid `created` event folds to `undefined` ("not a
conversation"). `ConversationStore` ships as an `InMemory` + `File` pair behind
one `BaseConversationStore`, so the two cannot diverge in behaviour; `now` and
`idFactory` are injected for deterministic tests.

### 2. Fork is copy-on-write, never an in-file branch tree

`fork(sourceId, atTurnIndex, { editedUserMessage })` creates a **new
conversation id** whose `created` event records `parentId` +
`forkedFromTurnIndex`, then replays the kept prefix (`messages[0..cut)`) as
fresh message events and appends the edited turn. The parent log is never
touched. The turn index is clamped to the available prefix, so a fork can never
invent turns the parent lacks. A branch tree inside one file was rejected — it
couples independent conversations and makes open/search/fail-open harder.

### 3. Checkpoints are metadata + a non-mutating rewind plan

`recordCheckpoint` appends a **metadata-only** checkpoint event: phase,
`turnIndex` (message count at capture), a `changedFiles` manifest, and an
opaque `workState` snapshot passed through verbatim. Core stores **no file
blobs** in this slice (blob bloat is a named risk); a future `SnapshotStore`
seam can. Folds retain only the most-recent N checkpoints (default 50) so a
long run cannot blow up memory or the rewind picker.

`planRewind(conversation, checkpointId)` is **pure and non-mutating**: it
returns `{ targetTurnIndex, messagesToKeep, messagesToDrop, changedFiles,
workState, warnings }`. Core describes what a rewind would do; it does not do
it. The division of labour (council): **AgentDriver decides *when*** (the
phase-boundary trigger, IDE-wired), **CheckpointStore records *what***, **the
IDE decides *how* to restore files** (using its own VCS / undo-buffer
authority). Soft problems — a missing file manifest, a `turnIndex` past the
message count — are surfaced in `warnings`, never thrown; an unknown checkpoint
id returns `undefined`.

### 4. Search is a token-AND scan, not BM25 (first slice)

`searchConversations` is a dependency-light, case-insensitive token-AND scan
over title + message bodies, ranked recency-then-hit-count. The council split
here (codex: a substring/token scan is enough; gemini: reuse the context
engine's BM25) resolved to the simpler scan for the first slice: deterministic,
self-contained, trivially unit-testable, no index lifecycle. `minisearch`
(already in the dependency graph) is the documented enhancement path if ranking
quality ever outweighs simplicity.

### 5. Workspace guidelines compose into the system prompt (T-1307)

`packages/core/src/guidelines/` owns load/save of `.event4u-agent/guidelines.md`
(fail-open: missing/unreadable → `''`) and `composeSystemPrompt(base,
guidelines)`, which prepends a clearly delimited `<workspace-guidelines>` block
ahead of the base system text. The block is **size-capped** (16 KB) with a
truncation marker, so an accidental multi-MB paste cannot blow up every
request's token budget.

## Consequences

- **Positive.** Zero new dependencies; CI matrix stays green by construction.
  Append-only writes survive a crash mid-append. Forking never mutates the
  parent. Checkpoints are bounded and never give core file-write authority it
  shouldn't have. Guidelines can never silently bloat a prompt. All five
  surfaces are fully unit-testable behind injected `now`/`idFactory` (53 new
  tests; full core suite 642 pass / 1 skipped).
- **Negative / accepted.** Listing/search fold every conversation file on each
  call — fine for the expected conversation counts, but a per-workspace index
  (gemini's `history-index.jsonl` + flat sharding) is the documented scale path.
  Checkpoints carry no file content, so a rewind depends on the IDE's VCS/undo
  being able to reach the checkpoint state; core surfaces this as a `warning`
  rather than guaranteeing it.
- **Follow-up.** The IDE surfaces remain `[~]`: the sidebar conversation list +
  click-to-open + search box (T-1301), the edit-a-past-message fork affordance
  (T-1302), the auto-checkpoint AgentDriver wiring + rewind button (T-1303), and
  the guidelines editor + wiring `composeSystemPrompt` into the live request
  builder (T-1307). Core landed ahead of surfacing, consistent with Phases
  7/11/12/14.

## Alternatives considered

- **One rewritten JSON document per conversation.** Rejected: a full rewrite on
  every turn is both slower and more corruption-prone than an append; a torn
  write loses the whole conversation rather than one trailing line.
- **In-file branch tree for forks.** Rejected: couples independent
  conversations, complicates fail-open reads and search.
- **Blob-backed checkpoints from day one.** Rejected for the first slice:
  storage blowup risk; metadata-only + an optional future `SnapshotStore` is
  the conservative path.
- **Core performs the file restore on rewind.** Rejected: core has no VCS/undo
  authority and must not write workspace files speculatively; it emits a plan.
- **BM25 search now.** Deferred: couples the chat module to the context engine
  for marginal ranking gain on a small corpus; revisit via `minisearch`.

## Sign-off

On flip to **Accepted**: no code change required (the implementation already
embodies the decision). The IDE-wiring tickets (T-1301/1302/1303/1307 surfaces)
consume this contract unchanged; update `agents/analysis/PLAN.md` §13 if it
references the chat-history storage mechanism.
