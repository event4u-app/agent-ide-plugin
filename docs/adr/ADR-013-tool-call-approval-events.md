---
adr: 013
title: Tool-Call Lifecycle Events — One Union, Diff-in-Approval, Sealed-Class Codegen, Injected-Decide Orchestrator, Transport Deferred
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 Phase-1 surface-wiring design round — UNANIMOUS on forks 1–4, converged on fork 5)
related: road-to-product-readiness Phase 1 (T-PRD01 tool-call cards, T-PRD02 multi-file diff review, T-PRD04 event-union → Kotlin sealed class); completes the sealed-class half deferred from ADR-009; reuses ADR-004 permission gate
date: 2026-05-31
---

# ADR-013 — Tool-Call Lifecycle Events

## Status

**Proposed** — drafted alongside the road-to-product-readiness Phase 1 core
slice (`packages/protocol/src/schema.ts` `ToolCallEvent`/`ToolReview`,
`packages/core/src/agent/approval.ts`, `packages/core/src/tools/review.ts`,
`scripts/codegen.ts` sealed-union support). The IDE render halves (VS Code
webview cards, JetBrains Swing cards, xterm wiring) stay deferred; their
in-IDE visual smoke signs the verification log
(`docs/MANUAL_VERIFICATION.md § Product readiness Phase 1`).

## Context

The engine substrate for Phase 1 already shipped: the permission gate
(ADR-004), the atomic multi-file `WriteFilesTool`, the tool-call normalizer,
and the live terminal core (ADR-009). What was missing is the **wire vocabulary
and the core orchestration** that turn one tool-call into the ordered stream an
IDE renders as approval / diff / result cards — without baking approval
semantics into ad-hoc per-client code later. Two shipped precedents set the
shape: the terminal seam (`TerminalEvent` union + core manager shipped before
any xterm render) and the chat seam (`chatSend` streaming protocol + handler
shipped before the cost UI). This ADR does the same, protocol-first.

## Decision

Ship the union, the core orchestrator, and the Kotlin codegen now; defer the
transport. Five forks, ratified by the AI council (codex-cli 0.134.0 + gemini
0.41.2, 2026-05-31 — UNANIMOUS on 1–4, converged on 5):

1. **Ship protocol events now, minimal vocabulary (UNANIMOUS).** Define the
   stable observable contract before renderer work, exactly like terminal and
   chat. Risk: event fields reflecting imagined UI — mitigated by carrying only
   preview / diff / decision / result, no renderer-specific fields.

2. **One `ToolCallEvent` union; diff rides inside `approvalRequested` (UNANIMOUS).**
   Kinds `started` / `approvalRequested` / `approvalResolved` / `result` /
   `error`. A multi-file diff is an optional `review: { kind:'diff', files:[…] }`
   on `approvalRequested`, **not** a parallel `DiffReviewEvent`. Approval is part
   of a tool-call's lifecycle, so the whole card story stays keyed to one
   tool-call `id` — no cross-event correlation for the client. Risk:
   `approvalRequested` becoming a grab-bag — bounded by keeping `review` a typed,
   optional, extensible-by-kind payload.

3. **Sealed-class codegen for unions (UNANIMOUS).** `scripts/codegen.ts` gains
   a narrow sealed-union emitter: a `@Serializable @JsonClassDiscriminator("kind")`
   sealed interface + one `@SerialName(<kind>)` `data class` per variant, for
   **both** `TerminalEvent` (the sealed class deferred from ADR-009) and
   `ToolCallEvent`. `@JsonClassDiscriminator` pins the wire discriminator to
   `kind` for these hierarchies only, so the clients' existing
   `Json { ignoreUnknownKeys = true }` decodes them with no module-wide
   override. Kotlin consumers get exhaustive `when`. Risk: codegen drifting into
   a generic Zod→Kotlin compiler — bounded to `kind`-discriminated unions of
   flat serializable subclasses; not a general schema compiler.

4. **Injected-`decide` + `AsyncIterable` orchestrator (UNANIMOUS).**
   `agent/approval.ts` exposes
   `async function* runToolCallWithApproval(call, { gate, decide, exec, review?, signal? })`
   yielding the lifecycle in order. The human decision (`decide`) and the tool
   execution (`exec`) are injected, so the flow is unit-testable with plain
   promises and knows nothing about the wire. Cancellation is an explicit
   `AbortSignal` (checked before evaluation and before exec); a thrown `decide`
   produces a deterministic `error` event, never a hang. Provider-direct — **not**
   wired into the multi-step `AgentDriver` yet (mirrors the vertical-slice
   "provider-direct now, driver folds later" decision). Risk: hiding
   cancellation / error policy inside the generator — mitigated by the explicit
   signal + deterministic error events, both covered by tests.

5. **Transport deferred this slice (converged).** Tool-call events are **not**
   multiplexed onto `chatSend` (that would make the protocol lie — tool
   lifecycle is not subordinate to chat token streaming), and no speculative
   `agentTurn` method is created while the agent loop that emits these events is
   not yet wired. The union, the orchestrator, and the Kotlin codegen ship under
   unit tests; a transport method lands only when a real turn emits mixed
   chat / tool / approval events. Risk: a future method freezing a
   half-imagined lifecycle — avoided by not creating it now.

### Incidental fix

`PermissionGate` initialised `this.file` from a **shared module-level
`EMPTY_FILE` constant**, and `grantAlways` mutates `this.file.always` in place —
so an in-memory gate (no `filePath`) leaked "always" grants across every
instance that started from the shared object. The approval orchestrator is the
first caller to exercise `grantAlways` on independent in-memory gates, which
surfaced it. Replaced the shared constant with an `emptyFile()` factory so each
gate owns its array. Behaviour-preserving for the file-backed production gate;
fixes the latent cross-instance leak.

## Consequences

- **Positive.** The approval / diff / result contract is now stable, typed on
  both sides (Zod + Kotlin sealed classes), and fully unit-tested
  (`approval.test.ts`, `review.test.ts`, `schema.test.ts`) with no IDE
  dependency. The IDE work becomes pure rendering against a fixed union.
  `TerminalEvent` finally has its sealed class (ADR-009 follow-through).
- **Negative / deferred.** No client renders these yet — the events have no
  transport and no consumer until a later slice wires them into a turn and the
  IDEs grow the cards. `write_files` (the multi-file tool) is classified
  `requires_approval`, not `requires_diff_approval` (only `write_file` singular
  is) — a gate-classification gap left untouched here; the diff `review` payload
  is plumbed regardless, ready for whichever tool name the turn wiring settles on.
- **Neutral.** Codegen now emits 29 flat DTOs + 13 sealed types.

## Alternatives considered

- **Separate `DiffReviewEvent` channel** — rejected (fork 2): forces the client
  to correlate two event streams by id for one user action.
- **Flat data classes + manual `when(kind)` decode in Kotlin** — rejected
  (fork 3): spreads protocol logic into consumers, no exhaustiveness.
- **State-machine object instead of a generator** — rejected (fork 4):
  unnecessary before persistence / replay / restart-recovery exist.
- **Multiplex over `chatSend` / create `agentTurn` now** — rejected (fork 5):
  dishonest protocol / speculative breadth before a real emitter exists.

## References

- AI council design round: codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31
  (Phase-1 surface-wiring, UNANIMOUS on forks 1–4, converged on 5).
- ADR-004 (permission model) · ADR-009 (terminal core; sealed class deferred
  there, completed here) · ADR-010 / ADR-011 / ADR-012 (chat + provider seams,
  same protocol-first pattern).
- road-to-product-readiness Phase 1 — T-PRD01, T-PRD02, T-PRD04.

## Sign-off

On flip to **Accepted**: the deferred IDE render work (T-PRD01/02/04 client
halves) builds against this frozen union; the transport method (fork 5) is
specified in a follow-up ADR when the agent turn that emits these events is
wired into the dispatcher.
