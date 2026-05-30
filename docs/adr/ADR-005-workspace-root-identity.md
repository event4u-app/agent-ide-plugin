---
adr: 005
title: Workspace Root Identity — uri / stableId / canonicalKey + nested-root and symlink-dedup rules
status: Proposed (drafted 2026-05-30 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex/gpt-5 + gemini-2.5-pro, 2026-05-29 roadmap round + 2026-05-30 implementation round)
related: road-to-multi-project Phase A (T-MR01..T-MR07), road-to-v1-0 Phase 6 (Context Engine)
date: 2026-05-30
---

# ADR-005 — Workspace Root Identity

## Status

**Proposed** — drafted alongside the road-to-multi-project Phase A implementation,
which freezes this contract in code (`packages/core/src/context/roots.ts`). Awaits
explicit user sign-off before flip to **Accepted**. The multi-project roadmap's
overall acceptance criteria reference this ADR by slug.

## Context

The Context Engine (v1.0 Phase 6) assumed a single project root walked by one
`WorkspaceWalker` and indexed into one BM25 retriever. Multi-project support
requires the Core to identify, dedup, and scope **N** roots that the IDE has open.

A root cannot be identified by a bare absolute path. Paths break under:

- **Remote / WSL** — the same logical project has different paths host-side vs container-side.
- **Case-insensitive filesystems** — macOS (APFS default) and Windows (NTFS) treat `/Repo` and `/repo` as one directory; Linux does not.
- **Symlinks** — two registered roots can resolve to the same physical directory.
- **Relocation / casing drift** — a persisted selection must survive a folder move or a path-casing change.

## Decision

A root carries **three distinct identities**, never conflated:

| Field | Role | Source |
|---|---|---|
| `uri` | Primary identity the client speaks (`file://`, `vscode-remote://`, …) | Client |
| `stableId` | **Persistence key** — survives path-casing / relocation | Client |
| `canonicalKey` | **Dedup key** — `realpath`-derived, platform-aware | **Core** |

The Core model is `WorkspaceRoot = { uri, stableId, canonicalKey, displayName, kind, enabled }`.
A `RootRegistry` is keyed by `stableId` and dedups by `canonicalKey`.

Two decisions were corrected from the first draft after the 2026-05-30 council round
(both members flagged the same two defects independently):

1. **`canonicalKey` is Core-derived, never client-supplied.** A client-computed
   key drifts across WSL/host or differing `realpath` implementations. The client
   sends `uri` + `stableId`; the registry computes `canonicalKey` on `add` via the
   OS resolver (`fs.realpath.native`, callback-promisified — the promises API has
   no `.native`) plus a platform-aware normalizer.
2. **`canonicalKey` is platform/filesystem-aware, not blanket case-normalized.**
   Casing is folded on Windows + (pragmatically) macOS; **preserved on Linux**, so
   `/repo/Web` and `/repo/web` stay distinct on a case-sensitive volume.

**Symlink dedup.** When two roots resolve to the same `canonicalKey`, they collapse
to one walkable entry; the winner is the **lexicographically smallest `stableId`**
(deterministic across restarts because `stableId` is immutable). The loser is
retained as an alias so path-based client events still map to the primary. On
removal of the winner, the registry re-elects the next-smallest `stableId`.

**Nested explicit roots.** Files are attributed to the **most-specific** owning
root (deepest `canonicalKey` that contains the file). A parent walk **prunes** any
nested child-root subtree *before* ignore evaluation, so a parent `.gitignore`
cannot suppress an explicitly-registered child. The child remains a distinct
registry entry. Containment is **segment-aware** (`/repo/web2` is not inside
`/repo/web`).

**Retrieval scope.** `retrieve(query, k, rootIds?)` honours the **exact resolved
set** of root IDs by filesystem-ID, never by containment. Omitted scope = all
enabled roots; an explicit **empty** scope = "no code context" (returns nothing).
Allocation reserves a per-root minimum for roots with hits, fills the remaining
budget by global relevance, and reclaims zero-hit roots' budget.

**Index partitioning.** Each root owns its own BM25 segment (a dedicated
retriever). This is load-bearing: a shared index would shift IDF on every add/drop,
so dropping a root could not leave the other roots' scores bit-identical.

## Consequences

- **Positive.** Single-root windows are a registry of length 1 — behaviourally
  identical to today (proven by test). Dropping a root is O(segment) and leaves
  peers bit-identical. Remote/WSL/symlink/case edge cases have one well-defined home.
- **Cost.** One BM25 index per root trades a little memory for isolation. A symlink
  alias is kept in the registry (not freed) so path events still resolve.
- **Deferred.** Scoped **embeddings/hybrid** retrieval (`T-MR06`) reuses the same
  `rootIds` seam but waits on v1.0 Phase 8. Multi-membership indexing and
  generation-ID replay were rejected as over-engineered for a solo-dev plugin.

## Alternatives considered

- **Bare absolute path as identity** — rejected: breaks under Remote/WSL/symlinks/case.
- **Shared BM25 index with a `rootId` field per doc** — rejected: cannot guarantee
  bit-identical peer scores after a root drop (global IDF shifts).
- **Client-supplied `canonicalKey`** — rejected: drifts across host/container.
- **Blanket case-normalization of `canonicalKey`** — rejected: wrongly dedups
  distinct directories on case-sensitive Linux volumes.

## References

- `packages/core/src/context/roots.ts` — `WorkspaceRoot` + `RootRegistry`.
- `packages/core/src/context/multi-root-walker.ts` — nested-prune + attribution.
- `packages/core/src/context/engine.ts` — per-root segments + `allocate`.
- `docs/MANUAL_VERIFICATION.md` § T-MR01 — discovery-spike findings + frozen schema.
- `agents/roadmaps/road-to-multi-project.md` — Phase A.
