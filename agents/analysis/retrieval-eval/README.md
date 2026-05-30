# Retrieval evaluation set (Phase 8)

Held-out queries for judging whether hybrid retrieval (BM25 + embeddings, fused
by RRF) measurably beats BM25-only — the Phase 8 exit-gate criterion. This is a
**manual / human-judged** gate: it needs the optional local embedder (or a
remote provider key) plus a real repository, neither of which runs in the
standard CI matrix.

## Method

1. Collect ~20 real queries from MVP + Phase 6 chat history. Drop them into
   `queries.json` (copy the shape from `queries.sample.json`), each with the
   file(s)/symbol(s) a human considers the correct answer (`relevant`).
2. Index a target repo with the engine twice: once BM25-only
   (`new ContextEngine(indexer)`), once hybrid
   (`new ContextEngine(indexer, { embedder: createEmbedder({ provider: 'local' }) })`).
3. For each query, compare `retrieve()` (BM25) vs `hybridRetrieve()` against the
   `relevant` set. Report MRR / Recall@10 for both.
4. Pass when hybrid's MRR/Recall@10 is **not worse** and improves on the
   queries that have no exact symbol-name match (the semantic wins).

## Files

- `queries.sample.json` — schema + two illustrative rows. Copy to
  `queries.json` (gitignored by convention; this set is corpus-specific) and
  fill from real history.

## Why not automated in CI

Embedding quality depends on a real model + a real corpus; the deterministic
`FakeEmbedder` used in unit tests exercises the *plumbing* (fusion, scoping,
cache, ranking determinism), not retrieval *quality*. Quality is judged here,
by a human, against a corpus — recorded in `docs/MANUAL_VERIFICATION.md`.
