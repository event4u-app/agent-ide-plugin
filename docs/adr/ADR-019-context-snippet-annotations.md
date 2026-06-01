---
adr: 019
title: Context-Snippet Annotations — SweepAI Message.annotations Wire Contract, Pure Builder over Scored Retrieval (Discriminated-Union Model, Additive Scored Retrieve, Core Path-Classification, Normalized Relevance, Bounded Preview)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini-cli, 2026-06-01 T-1308 design round — UNANIMOUS forks A1/C1/E1/F2; SPLIT fork B resolved to B1 on the additive-law precedent; SPLIT fork D resolved to D1 on the minimal-wire precedent)
related: road-to-v1-0 Phase 13 (T-1308); realizes the `Message.annotations` contract from road-to-mvp-ui-design § "Data + render contract"; consumes the Phase-8 hybrid retrieval seam (`ContextEngine.hybridRetrieve`)
date: 2026-06-01
---

# ADR-019 — Context-Snippet Annotations

## Status

**Proposed** — the pure-core seam of T-1308. The Context Side Bar / SnippetBadge
render (badge opacity, colour, hover-preview, search-add, click-to-open) is an
IDE surface and stays deferred; this ADR covers the wire data model + the
core builder that produces it, which is autonomous and CI-verified.

## Context

`road-to-mvp-ui-design.md` § "Data + render contract" makes the SweepAI
`Message.annotations` model the design authority: artifacts (context snippets,
code suggestions, status rows) ride on the turn that produced them rather than
living in ad-hoc UI channels. The first artifact the IDE needs is the
**context-snippet** badge T-1308 describes: score→opacity, type→colour
(source/test/docs/dependency), path basename + range, hover-preview, remove
affordance.

The data already exists: `ContextEngine.hybridRetrieve` (Phase 8) returns
RRF-reranked `ChunkRef[]`, and `snippetsForChunks` expands refs into ±context
windows. But the protocol had **no** annotation wire type, `hybridRetrieve`
**drops** the fusion score (maps `FusedResult.item` only), and `snippetsForChunks`
**merges** overlapping snippets — collapsing two scored refs into one window,
which would break a 1:1 score-to-badge mapping. So the seam is: a wire contract
+ a score-preserving builder, threaded onto the existing retrieval.

Project laws in play: no native deps; additive / minimal-diff (no caller breaks);
deterministic output (tests pin exact order); pure-core seam ships + is unit
tested ahead of the IDE render half (`[~]`).

## Decision

A `kind`-tagged annotation union on the wire + a pure builder in
`packages/core/src/context/annotations.ts`, fed by an additive scored-retrieval
method.

- **Fork A — annotation model shape → A1 (discriminated union now).** Ship an
  `Annotation` union with a single `context-snippet` member rather than a
  standalone object. The contract is explicitly `Message.annotations`
  (multi-artifact); modelling it as a `kind`-tagged union now mirrors the
  existing `ContextScope`/`TerminalEvent` pattern and codegen's
  `@JsonClassDiscriminator("kind")` sealed-class emitter, so code-suggestion /
  status members land later with no breaking reshuffle. UNANIMOUS (codex + gemini).
- **Fork B — score threading → B1 (additive `hybridRetrieveScored`).** Council
  split: B1 additive variant (codex) vs B2 change `hybridRetrieve`'s return type
  (gemini, "no production callers yet"). Resolved to **B1** on the established
  additive law (ADR-018 fork A precedent): `hybridRetrieve` keeps returning bare
  refs (the context-injection path wants snippets, not scores); a new
  `hybridRetrieveScored` returns `FusedResult<ChunkRef>[]`. Implemented by sharing
  the ranking and attaching the pre-rerank RRF score back to each reranked item
  by `chunkRefKey` (with the default `IdentityReranker`, order and scores align
  exactly).
- **Fork C — `kind` classification → C1 (core path heuristics).** Classify
  source/test/docs/dependency deterministically in core (`classifySnippet`:
  `node_modules`/`vendor`→dependency; `test`/`tests`/`__tests__`/`.test.`/`.spec.`
  →test; `docs`/`.md`/`.mdx`→docs; else source), so VS Code and JetBrains never
  drift on the colour rule. UNANIMOUS.
- **Fork D — opacity normalization → D1 (normalized `relevance` only).** Council
  split: D1 send 0..1 `relevance` only (gemini) vs D3 send raw score + relevance
  (codex). Resolved to **D1** on the minimal-wire precedent (ADR-016 "no
  confidence leak"): the raw RRF score has no defined wire consumer and would
  invite UI misuse. The builder min-max normalizes over the result set; a single
  result or an all-equal set → `1` (no divide-by-zero, and "nothing stands out"
  reads as fully relevant, not fully faded). The IDE maps `relevance`→opacity
  with its own floor, so the wire carries no render decision. Raw score is an
  additive field later if a debug need appears.
- **Fork E — preview text → E1 (bounded preview on the wire).** Include a bounded
  slice (≤ 8 lines, ≤ 400 chars) so hover-preview is instant and consistent with
  the indexed content — the builder already expands the snippet, so re-reading
  the file in each IDE would only risk drift. UNANIMOUS.
- **Fork F — builder home → F2 (pure free function).** `buildContextSnippets` is a
  pure function over already-scored refs + an injected per-ref snippet resolver,
  not a method baked into `ContextEngine`. Maximizes testability; the engine keeps
  a thin `retrieveContextSnippets` convenience wrapper that wires its own
  single-ref resolver (`snippetForChunk`, **no** cross-ref merge — the 1:1
  score-preserving path). UNANIMOUS.

## Consequences

- New protocol types `Annotation` / `ContextSnippetAnnotation` / `SnippetCategory`
  + codegen'd Kotlin sealed class `Annotation` (`ContextSnippetAnnotation` data
  class). 38 DTOs + 19 sealed types regenerated; `jetbrains:check` green.
- New core `context/annotations.ts` (`classifySnippet`, `buildContextSnippets`,
  preview bounds) + `ContextEngine.hybridRetrieveScored` / `snippetForChunk` /
  `retrieveContextSnippets`. `hybridRetrieve` is now a thin map over the scored
  variant — its external return type and all existing tests are unchanged.
- 19 new tests (15 core + 4 protocol); core 847 pass / 1 skip; `task ci` green.
- **Deferred (the render half):** the Context Side Bar panel, SnippetBadge
  (opacity/colour/range/hover/remove), the snippet-search add affordance, and
  click-to-open are IDE surfaces on both clients. Wiring `retrieveContextSnippets`
  into the live chat turn (attaching annotations to the assistant message) is the
  context-injection step that lands with the per-turn scope work — out of this
  slice. T-1308 → `[~]`.

## Alternatives

- **Standalone `ContextSnippet` object (no union):** rejected (fork A) — the
  contract is multi-artifact; the union avoids a later breaking reshape.
- **Builder on `ContextEngine`:** rejected (fork F) — couples the pure mapping to
  engine state and is harder to unit test.
- **`snippetsForChunks` (merging) as the resolver:** rejected — merging overlapping
  windows collapses two scored refs into one, breaking the 1:1 score→badge order.
- **Raw RRF score on the wire:** deferred (fork D) — additive later if a consumer
  appears.

## Sign-off

On flip to **Accepted**: update `agents/analysis/PLAN.md` § context-engine /
chat-render contract to point at the annotation model as the single artifact
source of truth, and reference this ADR from the Context Side Bar render task
when the IDE sprint picks it up.
