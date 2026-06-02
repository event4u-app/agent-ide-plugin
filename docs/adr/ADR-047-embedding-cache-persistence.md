---
adr: 047
title: Embedding-Cache Persistence — Wiring The EmbeddingCache `store?` Seam To Disk So A Cold Start Skips Re-Embedding (T-805)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 — UNANIMOUS Q0=A (persist the content-hash EmbeddingCache, not the position-addressed VectorStore), Q1=A (header guard {cacheVersion, modelId, dimensions} → discard on mismatch), Q2=A (optional persistDir threaded WorkspaceCoordinatorOptions → ContextEngine, default-off), Q3=A (load-once, debounced/coalesced atomic write, fail-soft), Q5=A (cache persistence strictly better than VectorStore persistence for the skip-re-embed goal); Q4 — two traps: codex flagged torn/competing writes (→ atomic temp-file + rename), gemini flagged unbounded cache growth across branches (→ persist only the working set touched this session))
related: discharges the "VectorStore persistence (in-memory today → re-embed per session)" follow-up named in T-806/ADR-044 and closes the T-805 gap (the shipped EmbeddingCache was in-memory, not the "persistent content-hash cache" the roadmap promised). Engine + cache shipped tested but no composition root ever seeded the cache from disk, so re-embedding never survived a restart. The vector half goes live only with a real embedder (ADR-044), so this stays `[x]` on T-805 (makes the `[x]` true across restarts).
date: 2026-06-02
---

# ADR-047 — Embedding-Cache Persistence (wiring the EmbeddingCache `store?` seam to disk, T-805)

## Status

**Proposed** — awaits sign-off. One branch / one PR, two commit chunks
(core → docs), preserving minimal-safe-diff.

CI-verified locally: `task ci` exit 0 (lint clean, build clean, typecheck
clean, format clean); core 1111 pass / 1 skip (+16); sidecar startup smoke
clean (`agent core ready`). No protocol / Kotlin / codegen change → JetBrains
build unaffected. **No checkbox flip** — T-805 stays `[x]` (this makes the
`[x]` true on the live cross-session path); the vector subsystem is only active
with a real embedder configured (ADR-044).

## Context

The sidecar's `WorkspaceCoordinator.addRoot()` walks every file in the
workspace on every startup and calls `ContextEngine.indexFile()` for each, so
every restart re-chunks and **re-embeds the whole repo from scratch**. The embed
call is the expensive part (a remote Voyage/OpenAI fetch or a local ONNX model
run); rebuilding the in-memory index from already-computed vectors is cheap.

Two shipped-but-dead persistence seams existed:

1. **`EmbeddingCache`** keys vectors by `sha256(CACHE_VERSION + modelId +
   chunkText)` — content-addressed and edit-safe — and its constructor already
   accepts an optional `store?: Map<string, Float32Array>` for injection, but
   nothing ever passed a persisted map. It had no serializer.
2. **`VectorStore.toBuffer()` / `fromBuffer()`** — fully unit-tested, ZERO live
   callers — but the store is keyed by `(rootId, filePath, startLine, endLine)`,
   so a persisted vector goes **stale** if a file changes while the sidecar is
   off, and persisting it pays off only if the re-walk is *also* skipped.

Roadmap T-805 promised a "persistent content-hash cache"; the shipped cache was
in-memory. T-806/ADR-044 explicitly deferred "VectorStore persistence
(in-memory today → re-embed per session)". This slice picks the cache (not the
vector store) as the persistence target.

## Decision

Persist the **content-hash embedding cache** so the startup re-walk hits it
instead of re-embedding unchanged chunks. The position-addressed VectorStore
stays rebuilt-per-session (cheap, and always fresh — no staleness logic).

**Shape (AI council 2026-06-02, UNANIMOUS):**

- **Persist the cache, not the vector store (Q0=A / Q5=A).** Because the re-walk
  re-runs `indexFile` for every file every session regardless, a content-hash
  cache hit *skips the expensive embed* and is correctness-safe (a changed chunk
  gets a new key, so a stale entry simply never matches). Persisting the
  position-addressed VectorStore (B) would add offline-edit staleness detection
  and only help if the re-walk were also skipped — strictly worse for the goal.
- **`EmbeddingCacheStore` serializer (new).** Plain packed-Float32 `Buffer` (a
  4-byte header length, then a UTF-8 JSON header `{cacheVersion, modelId,
  dimensions, keys}`, then `keys.length * dimensions` Float32**LE** values) —
  NOT `node:sqlite`/`sqlite-vec` (the CI matrix includes Node 20; no native
  deps), matching the token-tracking JSONL and `VectorStore.toBuffer`
  precedents. Explicit little-endian read/write is cross-platform.
- **Header guard (Q1=A).** `load()` pins `{cacheVersion, modelId, dimensions}`;
  on any mismatch it discards the whole file rather than returning vectors from
  a different model. The content-hash key already embeds CACHE_VERSION+modelId,
  so a stale entry would never match — but the header guard makes a model /
  dimension swap a clean wipe rather than a silently-growing graveyard of
  incompatible vectors.
- **Default-off threading (Q2=A).** A new optional `cacheStore?` on
  `ContextEngineOptions` and `embeddingCacheDir?` on
  `WorkspaceCoordinatorOptions`; the sidecar passes
  `join(cwd, PLUGIN_STATE_DIR, 'embeddings')` only when a real embedder is
  resolved. Absent ⇒ in-memory cache (current behaviour); unit tests stay
  side-effect-free.
- **Load-once, post-walk flush, fail-soft (Q3=A).** `ContextEngine.loadCache()`
  seeds the cache once (idempotent), called at the head of every index pass;
  `persistCache()` saves at the tail of `runIndex` after the walk has embedded
  every current chunk — a coalesced single write per pass. Both are fail-soft:
  a missing / corrupt / mismatched file leaves the cache cold, and a save error
  is swallowed (persistence is an optimisation, never a turn dependency —
  mirrors the existing fail-soft embed path).

**Traps guarded (council Q4):**

- **Torn / competing writes (codex).** `save()` writes a pid-tagged temp file
  then `rename`s it over the target — atomic, so a crash or a second sidecar on
  the same workspace can never observe a half-written file (last writer wins).
- **Unbounded growth across branches (gemini).** The cache only persists the
  **working set touched this session** (`EmbeddingCache.snapshot()` returns
  keys looked up during the pass; `seed()` loads candidates but does not mark
  them touched). A key seeded from disk but never looked up — a deleted or
  off-branch chunk — is dropped on the next save, so the file stays bounded to
  the live workspace instead of accumulating across branch switches.
- **Seed never clobbers a fresh embed.** `seed()` only fills keys not already
  present, so an embedding produced this session always wins over an older
  on-disk vector for the same key.

## Consequences

**Positive.** A cold sidecar start no longer re-pays the embed cost for
unchanged code — the dominant cost (full-repo embed on launch) is captured by
the post-walk flush and served from disk on the next launch. No native deps, no
protocol / Kotlin / codegen change, no new IDE surface. The content-hash key
auto-invalidates on edit; the header guard handles model swaps; the working-set
snapshot bounds file growth; atomic writes survive crashes and concurrent
sidecars.

**Negative / limits.** Files edited *after* the startup walk in a given session
are not re-persisted until the next pass, so their embed cost is paid once on
the next launch (then cached) — acceptable, since the dominant cost is the
cold-start full-repo embed. Persistence is best-effort: a disk error degrades to
the current in-memory behaviour, never an error. The VectorStore is still
rebuilt per session (cheap, and always fresh).

**No checkbox flip.** T-805 stays `[x]` — the engine was already tested; this
makes the `[x]` true across restarts. The vector subsystem is live only with a
real embedder configured (ADR-044). Dashboard counts unchanged.

## Alternatives considered

- **Persist the VectorStore via the dead `toBuffer`/`fromBuffer` (Q0=B).**
  Rejected — position-addressed entries go stale on offline edits, and the value
  only materialises if the re-walk is also skipped (a larger, riskier change).
  The content-hash cache reaches the same "skip re-embed" goal with no staleness
  logic, leveraging the re-walk that already runs.
- **Persist both cache and vector store (Q0=C).** Rejected for minimal-safe-diff
  — the cache alone delivers the cost saving; the vector rebuild is cheap.
- **No header guard, trust the content-hash key (Q1=B).** Rejected — a model /
  dimension swap would leave the old vectors in the file forever (they never
  match, but they bloat it); a header guard wipes cleanly.
- **Synchronous write per `indexFile` (Q3=B).** Rejected — chatty disk I/O
  during the startup burst; the coalesced post-walk flush is one write.
- **Shutdown-only write (Q3=C).** Rejected — unreliable (a killed sidecar never
  flushes); the post-walk flush captures the cold-start cost deterministically.
- **Persist the full cache, not just the working set.** Rejected per gemini's
  Q4 — unbounded growth across branch switches; the working-set snapshot bounds
  it.

## References

- `packages/core/src/context/embedding-cache.ts` — the reused `store?` seam +
  new `seed()` / `snapshot()` (working-set persistence).
- `packages/core/src/context/embedding-cache-store.ts` — the new serializer +
  atomic file I/O + header guard.
- `packages/core/src/context/engine.ts` — `cacheStore?` option, `loadCache()` /
  `persistCache()` (idempotent load, fail-soft save).
- `packages/core/src/context/workspace-coordinator.ts` — `embeddingCacheDir?`
  option, cache-store construction, load-before / persist-after the index walk.
- `packages/core/src/sidecar.ts` — passes `<cwd>/<state>/embeddings` when a real
  embedder is resolved.
- `packages/core/src/context/embedding-cache-store.test.ts` (7),
  `embedding-cache.test.ts` (+3), `engine-cache-persistence.test.ts` (5),
  `workspace-coordinator.test.ts` (+1) — round-trip, header guards, fail-soft,
  cross-restart cache hit, working-set bounding, post-walk flush wiring.
- ADR-044 — the remote-embedder wiring that made the vector path live and named
  this persistence follow-up.
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2).

## Sign-off

On flip to **Accepted**: the embedding cache survives a sidecar restart, so a
cold start with a configured embedder no longer re-embeds unchanged code.
VectorStore persistence and embed cost-tracking (`activity:"context-compression"`
— a wide change: the Embedder interface returns no usage, and the activity enum
lacks the value) remain documented follow-ups, out of scope here.
