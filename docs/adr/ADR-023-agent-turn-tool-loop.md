---
adr: 023
title: Agent Turn — Agentic Tool-Loop in Chat (Dedicated agentTurn Method, Standalone Handler, Injectable Tool Registry, Bounded Sequential Loop, String-Only Persistence, Errors Fed Back)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-06-01 agent-turn design round — UNANIMOUS on all 8 forks 1A/2A/3A/4A/5A/6A/7A/8A; both reviewers independently flagged the exactly-once-terminal, cost double-count, runaway-loop, and cancel-mid-tool traps)
related: road-to-product-readiness (the "multi-step agent turn that edits 2+ files" acceptance item, Phase 4 exit gate); threads the shipped approval/tool pieces — `agent/approval.ts` (ADR-013), `tools/read-tools.ts`, `tools/write-files.ts`, `tools/normalizer.ts`; extends the chat-RPC handler (ADR-010) + its cost/budget wiring (ADR-022); the AgentDriver phase machine (ADR-… T-701) is deliberately NOT folded in here
date: 2026-06-01
---

# ADR-023 — Agent Turn: Agentic Tool-Loop in Chat

## Status

**Proposed** — the next pure-core seam after the cost/budget wiring (ADR-022),
which named Seam A ("expose the agent/tool loop to chat") as the natural next
slice. Where `chatSend` (ADR-010) runs ONE provider-direct turn and ignores the
backend's `tool_use_*` events, this slice ships `agentTurn`: the bounded LLM↔tool
loop that lets chat actually read and edit files. The IDE render — the approval /
diff / result cards and the inbound approval round-trip that drives the human
decision — stays the IDE last-mile, so the relevant tasks stay `[~]`.

## Context

Every building block the agent turn needs had shipped and was unit-tested, but
nothing wired them into a loop:

- `LlmBackend.stream` already emits `tool_use_start/input_delta/end`;
  `LlmRequest.tools` and `ChatMessage.content = string | ContentPart[]` (with
  `tool_use` / `tool_result` parts) already exist; the Anthropic + OpenAI
  backends already map them.
- `agent/approval.ts` `runToolCallWithApproval` (ADR-013) turns ONE
  `NormalizedToolCall` into the ordered `ToolCallEvent` lifecycle (started →
  approvalRequested → approvalResolved → result/error), with injected
  `decide` + `exec`, an `AbortSignal`, hard-floor → error, and an optional audit
  trail.
- `tools/read-tools.ts` (read_file/list_dir/glob/grep) and `tools/write-files.ts`
  (atomic multi-file edits with a per-file diff plan) are the executable tools;
  `tools/normalizer.ts` `toToolResultPart` builds the `tool_result` content part.

A protocol pin test even asserted `agentTurn` was deliberately *absent* until the
approval/tool pieces landed. They have. This ADR removes that gate.

## Decision

1. **Dedicated `agentTurn` method + standalone `AgentTurnHandler` (forks 1A + 2A).**
   A new protocol method and a handler that mirror the `ChatHandler` / `GitHandler`
   dedicated-handler precedent — not a `chatSend` tool-mode flag (state pollution)
   and not folded into `AgentDriver.implement` (couples this slice to the larger
   refine→plan→verify phase machine). The bounded LLM↔tool loop is a primitive
   that should exist on its own first; the AgentDriver can consume it later.

2. **Injectable tool registry seeded with read + write tools (fork 3A).**
   `ToolRegistry` (`definitions()` + `get(name)`) is injected; `RegisteredTool`
   splits `prepare(input)` (parse args, compute the optional approval-review diff)
   from `execute(signal)` (run the work) so a `write_files` diff renders at
   approval time and the write happens only after approval. `buildDefaultToolRegistry`
   wires the four read tools (gate level `low` → auto-allowed) + `write_files`
   (gate level `requires_approval` → gated).

3. **Mirror the `ChatHandler` streaming/terminal contract (fork 5A).** The handler
   emits only `done:false` envelopes — a `ChatTokenEvent` `{token}` per text delta
   (reused, no new token event) and an `AgentToolEvent` `{toolEvent}` per lifecycle
   event (the existing `ToolCallEvent` union is bubbled) — and RETURNS the terminal
   `done:true` carrying `AgentTurnResponse`. The dispatcher owns exactly-once
   terminal emission; the handler never emits `done:true`.

4. **String-only persistence — no store migration (fork 4A).** The full
   `ContentPart` tool-use / tool-result messages live only in the in-memory working
   history. The `ConversationStore` stays string-based: the user turn plus ONE
   final assistant message (the model's final text + a compact `[edited N file(s)]`
   summary) are persisted. The rich tool turns are never written to disk.

5. **Bounded sequential loop + cancel (forks 6A + 7A).** Tool calls run
   sequentially (ordered approval/audit, no conflicting parallel writes). A
   `maxIterations` cap (request override → handler default 10) stops a runaway loop
   with `stopReason: 'max_iterations'`. The turn's `AbortSignal` is checked each
   iteration and threaded into both the LLM stream and `runToolCallWithApproval`;
   cancellation reuses `chatCancel` keyed by `conversationId` (one cancel surface —
   the dispatcher tries both the chat and agent handlers).

6. **Feed every tool result back, including denials (fork 8A).** After approval +
   exec, the structured output becomes a `tool_result` for the next turn. A denied
   or blocked call, an unknown tool, or invalid input each feed an `is_error`
   `tool_result` so the model can recover or explain rather than failing silently.

7. **Composition-root wiring with a conservative default `decide`.** Until the IDE
   approval round-trip (approvalRequested out → approvalResolved in) is wired, the
   `buildCoreDispatcher` default `decide` DENIES every `ask`: the production agent
   can read freely (low tools auto-allow) but never writes unattended. The gate
   persists "always" grants under the plugin state dir alongside the audit/cost
   stores.

## Consequences

- Protocol gains the `agentTurn` method + `AgentTurnRequest`, `AgentToolEvent`,
  `AgentTurnResponse` schemas and their Kotlin DTOs (flat codegen; `ToolCallEvent`
  /`ChatUsage`/`ChatCost`/`ChatBudgetStatus` are reused). The `Methods`-keys pin
  test now includes `agentTurn`; the negative pin is flipped.
- Correctness guards from the council traps are explicit in `turn-handler.ts`:
  usage is aggregated once per iteration and cost computed once at the end; an
  errored backend turn throws before any spend is recorded (never debits the
  budget); a mid-tool cancel never feeds a "successful" tool_result; `changedFiles`
  aggregate deduped first-seen across iterations.
- No existing caller changes: `chatSend` is untouched; the new dispatcher
  constructor arg is optional; absent the handler, `agentTurn` returns a clean
  `agent_not_configured` error.
- The IDE render half (approval/diff/result cards + the inbound decision channel)
  stays deferred — this slice ships the engine + protocol + Kotlin codegen + tests,
  exactly like every prior product-readiness seam.

## Alternatives considered

- **1B — overload `chatSend` with a tool-mode flag.** Rejected: distinct lifecycles
  (single turn vs multi-iteration) would pollute the chat handler's state.
- **2B — wire the loop into `AgentDriver.implement` now.** Rejected: couples a
  bounded tool-loop slice to the larger phase-machine architecture too early; the
  primitive should stand alone and be consumed later.
- **3B/3C — write-only or read-only tool set.** Rejected: read-only fails the
  "chat that edits files" value proposition; the tools are already shipped and
  tested, so restricting them adds churn with no safety gain (the gate + the
  default-deny `decide` already bound write risk).
- **4B — extend the store to persist `ContentPart[]` now.** Rejected: a schema
  migration the slice does not need; the human-readable transcript + summary is
  enough and keeps the existing fold/rewind/search paths string-based.
- **7B — a separate `agentCancel` method.** Rejected: cancellation is a
  conversation-level intent; the IDE should not distinguish "cancel a chat" from
  "cancel an agent" for the same thread.
- **6B — no iteration cap.** Rejected: a model-controlled loop needs a deterministic
  escape hatch; repeated denied calls would otherwise spin.

## References

- `packages/core/src/agent/turn-handler.ts` — `AgentTurnHandler`, the bounded loop,
  the per-iteration stream assembly, `runOneTool` approval delegation.
- `packages/core/src/agent/tool-registry.ts` — `ToolRegistry`, `RegisteredTool`
  prepare/execute split, `buildDefaultToolRegistry`.
- `packages/core/src/server.ts` — `agentTurn` streaming dispatch + the dual
  `chatCancel` surface.
- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` agent-turn wiring +
  default-deny `decide`.
- `packages/protocol/src/schema.ts` — `AgentTurnRequestSchema`, `AgentToolEventSchema`,
  `AgentTurnResponseSchema`, the `Methods.agentTurn` entry.
- `scripts/codegen.ts` — `AgentTurnRequest` / `AgentToolEvent` / `AgentTurnResponse`
  Kotlin DTOs.
- ADR-010 (chat-RPC handler) · ADR-013 (tool-call approval) · ADR-022 (cost/budget
  wiring, which named this seam as next).
- road-to-product-readiness — the multi-step agent-turn acceptance item.
