---
adr: 044
title: Wiring The Hybrid-Retrieval Embedder Onto The Live Context Engine (T-806)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02, serial per the stdin gotcha). UNANIMOUS Q0=A (wire `createEmbedder` — it activates the dead vector half of live retrieval), Q1=B (genuinely-live: add a `context.embeddings` schema AND make `main.ts` the first live `loadSettings` caller, in one tightly-scoped PR), Q2=A (never wire a `FakeEmbedder` in production — gate on a real embedder, else stay BM25-only), Q4=A (`embedder?` on `WorkspaceCoordinatorOptions`, keep the engine inside the coordinator). SPLIT Q3 (codex B remote-only / gemini A allow local) → RESOLVED A against the code: `createEmbedder` already supports `local`, the Q2 "real-embedder" gate includes it for free (excluding it is more code → minimal-safe-diff), and the unanimous Q5(d) fail-soft wrapper turns codex's only objection (a confusing missing-dep crash) into a logged soft-fallback to BM25. Both flagged Q5(d) fail-soft as the must-fix and Q5(b) apiKey-off-the-wire as mandatory.
related: completes the LIVE data path behind road-to-v1-0 Phase 8 (T-806 "optional remote embedding") and Phase 8 hybrid retrieval (T-802 VectorStore, T-805 EmbeddingCache). The whole vector subsystem shipped + unit-tested but `WorkspaceCoordinator` always built `new ContextEngine(new CodeIndexer(...))` with no embedder, so `ContextEngine.vectorChunkList` returned `[]` on every live turn — retrieval was lexical-only. Same shipped-tested-but-dead shape as PRs #45–55. The Context Side Bar render + embed cost-tracking stay IDE/follow-up, so no checkbox flips.
date: 2026-06-02
---

# ADR-044 — Wiring the hybrid-retrieval embedder (T-806)

## Status

**Proposed** — awaits sign-off. One branch / one PR, two commit chunks
(core → docs), preserving minimal-safe-diff.

CI-verified locally: `task ci` green (lint clean, `prettier --check` clean,
build + typecheck clean); core **1087 pass / 1 skip** (+ the new embedder-gate,
fail-soft, settings-mapping, and coordinator-threading tests);
`jetbrains:check` BUILD SUCCESSFUL (no Kotlin/protocol change — `Protocol.kt`
untouched, codegen idempotent); the bundled sidecar starts cleanly
(`node packages/core/dist/server.js < /dev/null` → `agent core ready`), proving
the new `main.ts` settings read + `yaml` path does not crash the ESM bundle
(the PR #55 `createRequire` banner holds — `yaml` was already bundled by the
rules loader). **No checkbox flip** — T-806 was already `[x]` (engine-tested);
this slice makes that `[x]` true on the live dispatch path.

## Context

The Explore seam-hunt's standing candidates were rejected again as
verified-artificial / dead-writer / IDE-gated (`EditLoop`, status-rows,
`createEngagementRecorder`, `injectContext`, `phaseRunsInMode`, `AgentDriver`,
`planToReview`, the memory/checkpoint backends). The genuinely-clean substantive
seam is the **hybrid-retrieval embedder (T-806)**.

The context-retrieval path is LIVE: both `ChatHandler` and `AgentTurnHandler`
call `coordinator.retrieveContextSnippets(...)` every turn →
`ContextEngine.hybridRetrieveScored` (`engine.ts`), which fuses lexical (BM25)
+ vector via RRF. But the vector half was DEAD in production:

- `createEmbedder(config)` / `RemoteEmbedder` (`context/remote-embedder.ts`,
  T-806) — ZERO live callers.
- `WorkspaceCoordinator` (`workspace-coordinator.ts`) builds
  `new ContextEngine(new CodeIndexer(...))` with **no** embedder, so
  `ContextEngine` constructs no `VectorStore` / `EmbeddingCache`, and
  `vectorChunkList` returns `[]` on every query.

Net effect: every chat/agent turn's grounding ran lexical-only — the entire
vector subsystem (`VectorStore` T-802, `EmbeddingCache` T-805, embed-on-index)
was shipped + tested but unreachable. T-806 was `[x]` purely on its unit tests;
the live wiring was never done — the exact shape of PRs #45–55.

A second dead seam fed the first: `parseSettings` / `loadSettings`
(`config/agent-settings.ts`) had ZERO live callers — `main.ts` called
`buildCoreDispatcher()` with no options, so nothing ever read
`.agent-settings.yml`. Wiring the embedder option without a live config reader
would have left it as dead as before.

## Decision

1. **Gate (`resolveActiveEmbedder`, Q2=A + Q3=A).** A new factory in
   `remote-embedder.ts` returns an embedder ONLY for a real provider — a keyed
   `voyage`/`openai`, or `local`. `fake`, a keyless remote, or an absent config
   yield `undefined` so `ContextEngine` stays BM25-only. `createEmbedder` always
   falls back to `FakeEmbedder`; fusing its meaningless hash-vectors into the
   live RRF is worse than clean lexical-only, so the composition root never
   wires a `FakeEmbedder`.

2. **Threading (Q4=A).** `WorkspaceCoordinatorOptions` gains `embedder?`, used in
   the default `new ContextEngine(new CodeIndexer(...), { embedder })`. An
   injected test `engine` ignores it (tests own that wiring).

3. **Composition root.** `BuildCoreOptions.embeddings?` is resolved via
   `resolveActiveEmbedder` and passed to the single shared
   `WorkspaceCoordinator`. With no config (the default) → no embedder → behaviour
   unchanged.

4. **Genuinely-live (Q1=B).** `agent-settings.ts` gains a `context.embeddings`
   schema (snake_case YAML → camelCase `EmbeddingsConfig` via `toEmbeddingsConfig`,
   so `api_key` → `apiKey`). `main.ts` becomes the FIRST live `loadSettings`
   caller: it reads `<cwd>/.agent-settings.yml :: context.embeddings` before
   attaching the stdin reader (Node keeps stdin paused, so no request bytes are
   lost during the await) and passes it to `buildCoreDispatcher`. Fully
   fail-soft: a missing file returns defaults, a malformed file is caught +
   logged, both degrading to BM25-only — never a boot failure.

5. **Fail-soft embed (Q5(d), must-fix).** A real remote embedder can throw on a
   network error / 401. `ContextEngine.indexFile` and `vectorChunkList` now wrap
   the embed in try/catch: an embed failure drops only the vector contribution
   (the file stays lexically indexed; the query falls back to lexical), so the
   turn never breaks. An abort (Stop) is user intent, not a failure, and is
   re-thrown via `isAbortError` — swallowing it would make Stop a no-op.

## Consequences

- **Positive.** Semantic vector+lexical hybrid retrieval goes live for any user
  who sets a `voyage`/`openai` key (or `local`) under `context.embeddings` —
  better grounding on every chat/agent turn. The vector subsystem is no longer
  dead code. The settings reader is now exercised by a real path.
- **No protocol/wire change.** The embedder is internal; `apiKey` lives only in
  this in-process embedder, never crosses the protocol wire, and is never logged
  (Q5(b)). `Protocol.kt` untouched, no codegen.
- **Known limitations (deferred, documented).**
  - *Embed cost/latency (Q5(c)):* each retrieval query and each (re)indexed
    chunk is a remote embed call. The `activity:"context-compression"`
    cost-tracking the embedder doc anticipates is a follow-up, not in this slice.
  - *Ephemeral vectors (gemini):* `VectorStore` is in-memory, rebuilt per session
    index, so a remote provider re-embeds on each sidecar start. Persistence is a
    later-phase follow-up.
  - *Dimensions (Q5(a)):* moot per session — the embedder is fixed at
    construction and `VectorStore` is built with its `dimensions`; a config
    change takes effect on the next sidecar start with a fresh index.
  - *`local` provider:* requires the optional `@huggingface/transformers`
    package (dynamic-imported only on first embed). Absent → the fail-soft path
    degrades to BM25 with a logged warning, never a crash.

## Alternatives considered

- **Q1=A (minimal, option-only).** Mirror `cost`/`caps`: add the
  `BuildCoreOptions` field, leave `main.ts` untouched, defer the config read.
  Rejected (council UNANIMOUS B): a wired option no live path can set is still
  effectively dead — the whole point of the seam is to make semantic retrieval
  reachable.
- **Q2=B (trust the factory fallback).** Pass whatever `createEmbedder` returns.
  Rejected: silently fusing `FakeEmbedder` noise into live RRF degrades
  retrieval below clean BM25.
- **Q3=B (remote-only MVP).** Exclude `local` from the sidecar. Rejected on
  minimal-safe-diff + the fail-soft mitigation (see consulted).
- **Fail-soft via a decorator embedder.** Rejected: returning `[]` on error
  corrupts the index path's length-matched `embeddings[i]` store; the correct
  degradation lives at the two engine call sites.

## References

- road-to-v1-0 Phase 8 — T-806 (remote embedding), T-802 (VectorStore),
  T-805 (EmbeddingCache), T-1308 (scored hybrid retrieval).
- ADR-043 (rules-system-prompt wiring) — the `createRequire` esbuild banner that
  keeps `yaml` bundle-safe, relied on by the new `main.ts` settings read.
- ADR-024 / PR #36 — the guidelines wiring whose composition-root injection
  pattern this mirrors.
- `context/remote-embedder.ts`, `context/engine.ts`,
  `context/workspace-coordinator.ts`, `config/agent-settings.ts`, `main.ts`,
  `sidecar.ts`.
