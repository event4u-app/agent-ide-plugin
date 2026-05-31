---
adr: 011
title: Provider Registry + Sidecar Composition Root — Eager Build, Env-Default, Throw-on-Unconfigured, Env Model Override
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 provider-registry design round — UNANIMOUS on all five forks)
related: road-to-product-readiness Phase 2 (T-PRD17, core half) + road-to-vertical-slice Phase 1 (closes the main.ts `chat_not_configured` gap)
date: 2026-05-31
---

# ADR-011 — Provider Registry + Sidecar Composition Root

## Status

**Proposed** — drafted alongside the road-to-product-readiness T-PRD17 core
slice (`packages/core/src/llm/provider-registry.ts`,
`packages/core/src/sidecar.ts`, `packages/core/src/main.ts`). Awaits explicit
user sign-off before flip to **Accepted**.

## Context

The vertical slice (ADR-010) shipped a streaming `chatSend` dispatch and a
fully-tested `ChatHandler`, but the **real sidecar never answered chat**:
`main.ts` constructed `new Dispatcher()` with no `ChatHandler`, so a live
`chatSend` returned the clean `chat_not_configured` error. The handler's
`ChatHandlerDeps` need a `resolveBackend(providerId?)` / `resolveModel(providerId?)`
seam, and five LLM backends already exist (`AnthropicApiBackend`,
`OpenAiApiBackend`, `ClaudeCliBackend`, `CodexCliBackend`, `GeminiCliBackend`),
but there was **no central registry** mapping a per-request `providerId` to a
backend + model. This is also the core half of T-PRD17 (the IDE-side
provider/model selector): the selector UI is meaningless without a sidecar that
can resolve the chosen provider.

The OpenAI-compat layer (`createCompatBackends`) had already set a precedent:
build every configured backend eagerly and **isolate** per-provider config
errors rather than letting one missing key block the rest.

## Decision

A new pure-core `ProviderRegistry` plus a `buildCoreDispatcher` composition
root, wired into `main.ts`. Five design forks, all ratified **UNANIMOUS** by the
AI council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31):

1. **Eager construction, isolated errors.** The registry builds every provider
   spec at construction; a spec that throws (missing API key) is recorded in a
   per-provider `errors` map, never propagated. Mirrors `createCompatBackends`.
   CLI backends always construct (the binary probe happens at stream time), so
   the registry is **never empty** — the "no providers → UI hangs" trap cannot
   occur.
2. **Env-configured default provider.** `EVENT4U_DEFAULT_PROVIDER` selects the
   provider used when a request omits `providerId`; it falls back to
   `anthropic`. No provider is hard-coded as product policy and resolution never
   depends on map iteration order.
3. **Throw `provider_not_configured`, never silently fall back.** An unknown or
   unconfigured `providerId` (or default) throws `ProviderNotConfiguredError`
   (`code: 'provider_not_configured'`), which the dispatcher wraps into the
   `chatSend` error envelope. Silent fallback to a different provider would be a
   privacy + cost surprise.
4. **Env model override, hard-coded default.** `resolveModel` reads
   `EVENT4U_<PROVIDER>_MODEL` then the spec default (`claude-sonnet-4-6`,
   `gpt-5`, `gpt-5-codex`, `gemini-3-pro` — the ids already used in
   `tracking/fixtures.ts`). Routing stays decoupled from the pricing book.
5. **Extract `buildCoreDispatcher(opts)`.** The composition root is a pure
   function with injectable `env` / `cwd` / `pricing` / `registry` / `store`, so
   a unit test constructs the exact production wiring with a fake registry +
   in-memory store and drives `chatSend` end-to-end without spawning a process.
   `main.ts` is now a thin stdio shell over it.

Provider ids are **canonicalised** (trimmed + lower-cased) on the way in, so the
future selector UI cannot drift on casing.

## Consequences

- The shipped sidecar answers `chatSend` for any configured provider; with no
  API keys present, the three CLI providers are still available and an
  operator selects one via `EVENT4U_DEFAULT_PROVIDER=claude-cli`.
- T-PRD17 reduces to a client-side concern: the settings UI lists
  `registry.available()` and sets `chatSend.providerId` — no further core work.
- Conversation persistence now lands on disk under
  `<workspace>/.event4u-agent/chats/` (the established `PLUGIN_STATE_DIR`).
- Pricing is left injectable but unset in `main()` for this slice → the turn
  cost is the existing `$0` estimate until a pricing book is wired (follow-up).
- New surface: `ProviderRegistry`, `buildCoreDispatcher`, `ProviderSpec`,
  `builtinProviderSpecs`, `ProviderNotConfiguredError`, `canonicalProviderId`.

## Alternatives considered

- **Lazy resolution** (construct on first request) — rejected: hides config
  errors until the user's first chat; eager surfaces them deterministically.
- **Hard-coded default provider** — rejected: encodes Anthropic as product
  policy and couples to iteration order.
- **Silent fallback to default on unknown provider** — rejected: privacy/cost
  surprise; explicit selection must be deterministic.
- **Derive model from the pricing book** — rejected for v0: couples routing to
  pricing data; env override + sane default is simpler and operator-tunable.
- **Inline wiring in `main()`** — rejected: only testable via a spawned
  process; the extracted composition root is unit-testable.

## References

- `packages/core/src/llm/provider-registry.ts` — the registry.
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` composition root.
- `packages/core/src/main.ts` — thin stdio shell over `buildCoreDispatcher`.
- `packages/core/src/chat/handler.ts` (ADR-010) — the consumer of the seam.
- `packages/core/src/llm/openai-compat.ts` — the eager-build / isolated-error precedent.
- road-to-product-readiness Phase 2 (T-PRD17); road-to-vertical-slice Phase 1.

## Sign-off

On flip to **Accepted**: T-PRD17's remaining (client selector UI) stays
`[~]` IDE-runtime; no further core changes implied. Pricing-book wiring in
`main()` is tracked as a follow-up, not part of this ADR.
