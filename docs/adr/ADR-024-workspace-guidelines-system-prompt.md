---
adr: 024
title: Workspace Guidelines in the System Prompt — Fold guidelines.md into Both Turn Paths (Shared Resolver, Both Handlers, Narrow Loader Callback, Fresh-Per-Turn Load, Guidelines-Ahead-of-Base, Fail-Open)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-06-01 guidelines-wiring design round — UNANIMOUS on all six forks A2/B1/C2/D1/E1/F1; both reviewers independently flagged the estimate-undercount, load-per-iteration, no-persist, and `system:undefined` spread traps)
related: road-to-v1-0 Phase 13 T-1307 (workspace guidelines — the core store + composeSystemPrompt shipped ahead of the wire in ADR-008); extends the chat-RPC handler (ADR-010) + its cost/budget wiring (ADR-022) and the agent-turn tool-loop (ADR-023); the guidelines EDITOR UI stays the IDE last-mile
date: 2026-06-01
---

# ADR-024 — Workspace Guidelines in the System Prompt

## Status

**Proposed** — discharges the wiring half of T-1307. The `GuidelinesStore`
(file-backed `<workspace>/.event4u-agent/guidelines.md`, fail-open) and
`composeSystemPrompt` (size-capped, delimited `<workspace-guidelines>` block)
shipped in ADR-008 (Phase 13) but had NO production caller — neither the chat
turn (ADR-010) nor the agent turn (ADR-023) set a system prompt from them. This
slice wires both turn paths so a user's `guidelines.md` actually reaches the
model. The guidelines **editor** (a webview/Swing surface) stays IDE-gated, so
T-1307's render half stays `[~]`.

## Context

Both turn handlers built their `LlmRequest` without folding in workspace
guidelines:

- `ChatHandler.handleSend` (ADR-010) built `{ model, messages, max_tokens }` —
  no `system`.
- `AgentTurnHandler` (ADR-023) accepted only a STATIC `system?: string` dep,
  spread verbatim into every iteration; it never derived it from guidelines.
- `LlmRequest.system?: string` already exists and every backend honours it.
- `composeSystemPrompt(base, guidelines)` already returns `base` unchanged for
  empty guidelines and prepends a 16 KB-capped block otherwise.

The pieces were all present; this is wiring, not new logic.

## Decision

Six forks, resolved UNANIMOUSLY by the AI council:

- **A2 — shared resolver.** A new `chat/system-prompt.ts` exposes
  `resolveSystemPrompt(base, load)`, the single source of the compose +
  fail-open rule. Both handlers call it, so chat and agent turns get identical
  guidelines semantics (no logic drift).
- **B1 — both handlers now.** Wire `ChatHandler` AND `AgentTurnHandler` in this
  slice. Otherwise the same workspace would have different instruction
  semantics depending on chat-vs-agent mode.
- **C2 — narrow loader callback.** Handlers depend on
  `LoadGuidelines = () => Promise<string>`, not the `GuidelinesStore` type.
  Trivial to fake (`async () => 'rules'`); the composition root closes over the
  real store (`loadGuidelines: () => guidelines.load()`).
- **D1 — fresh per turn.** Guidelines are read at the start of each turn so an
  edit to `guidelines.md` between turns takes effect without a sidecar restart.
  The read is a small fail-open file load.
- **E1 — guidelines ahead of base.** `composeSystemPrompt(base, guidelines)`
  prepends the guidelines block before the base `system` (workspace context is
  the leading constraint), matching the already-shipped contract.
- **F1 — fail-open.** The injected loader is wrapped in `resolveSystemPrompt`'s
  own `try/catch`, so a load error degrades to the base prompt and never breaks
  the model turn — fail-open does not rely on a particular store returning `''`.

### Correctness traps both reviewers flagged + guarded

- **Estimate must count the system prompt exactly once.** `ChatHandler`
  composes `system` BEFORE building the request, so the pre-send
  `countInputTokens` estimate (ADR-022) includes the guidelines block — no
  undercount.
- **Load ONCE per agent turn, not per iteration.** `AgentTurnHandler` resolves
  the composed `system` once before the loop and reuses it across every
  iteration; loading per iteration could shift instructions mid-loop.
- **Never persist the composed prompt.** The guidelines block is request-local;
  it is never appended to `messages` or written to the conversation store, so it
  cannot accumulate or double-count across turns.
- **Omit `system` when falsy.** Both handlers spread `...(system ? { system } :
  {})`, so a `composeSystemPrompt` return of `undefined`/`''` omits the key
  rather than sending `{ system: undefined }` (some backends reject the latter).

## Consequences

- A user's `.event4u-agent/guidelines.md` now reaches the model on every chat
  and agent turn, fresh per turn, capped at 16 KB.
- Backward-compatible: with no `loadGuidelines` dep wired (e.g. existing tests),
  both handlers behave exactly as before (no `system`).
- 15 new core tests (6 resolver + 5 chat-handler + 4 agent-turn), full core
  suite 918 pass / 1 skip. No protocol/codegen change → `Protocol.kt` and the
  JetBrains side are untouched.
- The guidelines editor UI (create/edit `guidelines.md` from the IDE) remains
  the last-mile; T-1307 stays `[~]`.

## Alternatives considered

- **A1 — compose inline in each handler.** Rejected: duplicates the
  size-cap/delimiter/fail-open rule in two places, inviting drift.
- **B2 — chat only, defer agent turn.** Rejected: leaves the agentic path (the
  one that edits files) ignoring the user's workspace rules — the highest-risk
  path to leave un-guided.
- **C1 — inject the `GuidelinesStore` interface.** Rejected: couples the
  handlers to the storage abstraction for no benefit; the callback is narrower
  and easier to fake.
- **D2 — load once at construction + cache.** Rejected: a guidelines edit would
  require a sidecar restart, breaking the tune-in-real-time workflow.

## References

- ADR-008 — Phase 13 chat persistence + guidelines (shipped the store + `composeSystemPrompt`).
- ADR-010 — chat-RPC handler (the `chatSend` turn this wires).
- ADR-022 — chat cost/budget wiring (the estimate that must count the system prompt once).
- ADR-023 — agent-turn tool-loop (the `agentTurn` path this also wires).
- `packages/core/src/chat/system-prompt.ts` — the shared resolver.
- `packages/core/src/guidelines/guidelines.ts` — `GuidelinesStore` + `composeSystemPrompt`.
- road-to-v1-0 Phase 13 T-1307.

## Sign-off

On flip to **Accepted**: no PLAN section change required (T-1307's core was
already recorded in ADR-008); this ADR records the wiring decision. The
guidelines-editor UI remains tracked as the T-1307 render half.
