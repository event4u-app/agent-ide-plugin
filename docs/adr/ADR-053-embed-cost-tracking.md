---
adr: 053
title: Embed Cost-Tracking — Pricing Remote Embeddings Via An onUsage Callback Seam, Not An Embedder-Interface Change (T-806 follow-up)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council — codex-cli 0.134.0 + gemini-cli 0.41.2 (2026-06-02), run serially per the documented stdin gotcha. UNANIMOUS Q0–Q4/Q6 = A across both members; Q2/Q5 refinements folded into the Decision.
related: the cost half of T-806 (remote embedder wiring, ADR-044), explicitly named as a deferred follow-up there and in the `remote-embedder.ts` class comment. Mirrors the priced-step pattern of `createTrackedReviewObserver` (ADR-042). Writes to the TrackingDb (ADR-035) on the same trail the chat/agent turns use.
date: 2026-06-02
---

# ADR-053 — Embed Cost-Tracking (T-806 follow-up)

## Status

**Proposed** — awaits sign-off. One branch / one PR, committed in logical
chunks (core enum+transport+tracker → pricing data → sidecar wiring → tests →
docs), preserving minimal-safe-diff.

CI-verified locally before PR: `task ci` (lint, format, build, typecheck, test)
and `task jetbrains:check` (no protocol/Kotlin change → build unaffected).
**No checkbox flip** — T-806 stays `[x]`; this makes the `[x]` true on the
cost-accounting path the class comment promised. The Cost Dashboard render that
surfaces these rows remains an IDE surface.

## Context

T-806 (ADR-044) wired a real `RemoteEmbedder` (voyage / openai over `fetch`)
into the live hybrid-retrieval path, but left cost-tracking explicitly deferred.
The `remote-embedder.ts` class comment records the intended seam verbatim:

> "when the engine is wired to the token-tracking layer, each remote embed is a
> step event with `activity: "context-compression"`. That accounting lives in
> the tracking layer; this class is the transport."

The supporting facts (verified against the code):

- `Embedder.embed(texts): Promise<Float32Array[]>` returns **only vectors**.
  Three impls: `FakeEmbedder` + `TransformersEmbedder` (local ONNX) are **free**;
  only `RemoteEmbedder` bills — and it parsed `json.data` for vectors while
  **discarding `json.usage.total_tokens`**.
- `embed()` runs at two live sites: `ContextEngine.indexFile` (bulk, batched
  per file, through the dedup `EmbeddingCache`) and `vectorChunkList` (per query
  and per expanded sub-query, bypassing the cache). Both are real remote spend.
- `TrackingDb.writeStep` requires a `StepEvent` whose `ActivitySchema` lacked
  `context-compression`. `PricingBook.costFor` uses `requireModel`, which
  **throws** on an unknown model — and `prices.yml` had no embedding models.
- Embedding APIs return **input tokens only** (no output, no stop reason).

## Decision

Wire embed cost-tracking via an **optional `onUsage` callback**, leaving the
`Embedder` interface untouched (council Q1 = A).

1. **Transport (`remote-embedder.ts`).** A new `EmbedUsage { tokens, model,
   batch }` + `EmbedUsageCallback`. `RemoteEmbedder` reads `json.usage`
   (`total_tokens ?? prompt_tokens ?? 0`) and fires `onUsage` inside a
   try/catch — a throwing tracker must **never** break the embed (Q6). The
   callback is threaded through `createEmbedder` and `resolveActiveEmbedder` as
   an optional third arg; the `local` branch ignores it (free embeds emit
   nothing). `FakeEmbedder`, `TransformersEmbedder`, `EmbeddingCache`,
   `ContextEngine`, and every existing test are **unchanged**.
2. **Accounting (`tracking/embed-tracker.ts`).** `createEmbedTracker({db,
   pricing, cwd})` returns the `EmbedUsageCallback`. Each call writes one priced
   `activity: "context-compression"` step: `mode:'api'`, `stop_reason:
   'completed'`, synthetic `conversation_id: context-compression:<cwd>` (Q5,
   mirroring `review:<cwd>`), `input_tokens = usage.tokens`, `output_tokens: 0`,
   monotonic `step_index`, `meta: {provider, batch, priced}`. Pricing uses
   `getModel` (not `requireModel`): a known embedding model is priced at its
   input rate; an **unknown** one is recorded at `usd:0` with `meta.priced =
   false` — never a throw, never a silent global price (Q2 = A-, codex).
   Fire-and-forget + fail-soft: the sync callback issues `void writeStep(...)
   .catch(...)`.
3. **Pricing data (`prices.yml`).** Add the two default remote embedding models
   (`openai:text-embedding-3-small` $0.02/Mtok, `voyage:voyage-code-3`
   $0.18/Mtok), `output_per_mtok: 0`. id == `RemoteEmbedder.modelId`.
4. **Composition root (`sidecar.ts`).** When `options.pricing` is present, build
   the tracker over the existing `tracking` trail and pass its callback into
   `resolveActiveEmbedder`. No pricing book ⇒ no tracker; the embed still runs,
   just untracked (the step's `usd` needs the book).

**Track-only, never gate (Q4 = A).** The usage signal fires *after* the call
returns, so it cannot pre-gate; and gating background indexing would break it.
The pre-send `CapsEvaluator` (ADR-041) remains the spend guard for chat/agent
turns. Both index and query embeds are tracked (Q3 = A) — all real remote spend.

## Consequences

- A dogfooding session on a keyed remote embedder now produces a per-call cost
  trail (`context-compression` rows) the Cost Dashboard can aggregate — the
  retrieval subsystem stops being a spend blind-spot.
- The `Embedder` interface stays a pure vectors-only contract; the free local /
  fake paths carry zero tracking code.
- An embedding model absent from `prices.yml` is tracked at `usd:0`
  (`meta.priced=false`) rather than crashing the embed — tokens are still
  counted, the cost is visibly flagged unpriced.
- The `source` (index vs query) is **not** in `meta`: `RemoteEmbedder` has no
  call-site context, and threading it would ripple the interface this ADR
  deliberately avoids. `batch` (texts per call) is the available proxy.

## Alternatives considered

- **Change `Embedder.embed` to return `{vectors, usage?}` (Q1 = B).** Rejected —
  ripples all three impls + `EmbeddingCache` + `ContextEngine` + every test for
  a signal only one impl can ever produce. The callback isolates the cost to the
  one billing transport.
- **Record `usd:0` always, track tokens only (Q2 = B).** Rejected — drops the
  cost signal, which is the point. Known models are priced.
- **Require every embedding model in the book, throw if missing (Q2 = C).**
  Rejected — a custom endpoint or a new model would crash retrieval; embeddings
  are an optional enhancement and must fail soft.
- **Cap-gate embeds (Q4 = B).** Rejected — post-call signal cannot pre-gate;
  blocking a cold index would defeat hybrid retrieval.

## References

- `packages/core/src/context/remote-embedder.ts` — `EmbedUsage`, `onUsage` seam.
- `packages/core/src/tracking/embed-tracker.ts` — the priced-step factory.
- `packages/core/src/tracking/db.ts` — `ActivitySchema` + `context-compression`.
- `packages/core/src/pricing/prices.yml` — embedding model entries.
- `packages/core/src/sidecar.ts` — composition-root wiring.
- ADR-044 (T-806 remote embedder) · ADR-042 (tracked review observer) · ADR-041
  (caps) · ADR-035 (TrackingDb).
