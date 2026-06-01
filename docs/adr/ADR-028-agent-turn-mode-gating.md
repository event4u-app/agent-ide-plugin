---
adr: 028
title: Agent-Mode Gating on the Agent Turn — Wire DirectiveSet.mutates into AgentTurnHandler (Protocol Owns the Mode Enum, Advertise-Filter + Runtime Backstop, mutates Metadata on RegisteredTool, Surface Resolved Mode, Default Edit, Reject Unknown Modes)
status: Proposed (drafted 2026-06-03 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-03 agent-turn-mode-gating design round — codex A1/B3/C1/D2/E1, gemini A1/B3/C1/D1/E1; UNANIMOUS on A1 (protocol owns the enum), B3 (advertise-filter + runtime backstop), C1 (mutates metadata, no hard-coded name), E1 (default edit); Fork D (surface resolved mode) SPLIT and resolved to D1 — see Decision)
related: completes the agent-turn half of T-PRD08 (agent modes — the `modes.ts` directive map shipped standalone with zero callers in ADR-014); builds on ADR-023 (agent-turn tool loop) and ADR-013 (tool approval); the composer mode-selector UI + the phase-based AgentDriver wiring stay IDE/driver work
date: 2026-06-03
---

# ADR-028 — Agent-Mode Gating on the Agent Turn

## Status

**Proposed** — awaits sign-off. The `agentTurn` is the chat turn that EDITS
files (ADR-023). It ran every turn with full write capability: it advertised the
`write_files` tool to the model regardless of the user's selected mode and would
execute an approved write in any mode. The `agent/modes.ts` directive vocabulary
(`AgentMode`, `MODE_DIRECTIVES`, `DirectiveSet.mutates`, `resolveMode`) shipped
standalone in ADR-014 (T-PRD08) with **zero production callers** — the
`AgentDriver` it was meant for is itself unwired. This slice wires the `mutates`
flag into the agent turn so the read-only modes (`ask` / `explain` / `plan` /
`review` / `commit`) genuinely cannot edit files. The composer mode-selector UI
and the phase-based `AgentDriver` gating stay IDE/driver work — T-PRD08 stays
`[~]`, dashboard counts unchanged.

## Context

`DirectiveSet.mutates` is `true` only for `edit`; every read-only mode is
`false`. The agent turn previously called `registry.definitions()` (all tools)
and routed every tool call through gate + approval with no mode awareness. So a
user in `ask` or `plan` mode could still have the model propose — and, on an
`allow` decision, apply — a `write_files` edit. That defeats the entire point of
a read-only mode and the trust/control posture of product-readiness Phase 2.

The mode enum lived only in core (`modes.ts`), so the wire had no way to carry a
mode and no single source of truth. The tool registry exposed no notion of which
tools mutate, so the handler had no principled way to filter them.

## Decision

Additive, pure-core + handler wiring. No new protocol method (the `Methods`-keys
pin is untouched); the IDE render is untouched.

1. **Fork A1 — the protocol owns the mode enum.** `AgentModeSchema` moves to
   `packages/protocol/src/schema.ts` (the wire single-source-of-truth); core's
   `modes.ts` imports and re-exports it instead of defining its own zod enum, so
   the wire and the directive map can never drift. `AgentTurnRequest.mode` is
   added optional; `AgentTurnResponse.mode` is added required. (UNANIMOUS.)

2. **Fork B3 — advertise-filter AND runtime backstop (defense-in-depth).** The
   handler resolves the directive ONCE before the loop (same trap as
   guidelines/context: resolving per iteration could shift policy mid-loop). In a
   read-only mode it advertises only the non-mutating tools — the model never
   sees an editor to call (B1). As a backstop, `runOneTool` refuses any
   `tool.mutates` call when the directive is read-only BEFORE any prepare/exec,
   feeding back an `is_error` `tool_result` — so a `write_files` call the model
   emits from stale conversation context (it was advertised in an earlier `edit`
   turn) still writes nothing (B2). codex and gemini were UNANIMOUS that the
   backstop is materially safer than relying on the unknown-tool path alone.
   (UNANIMOUS.)

3. **Fork C1 — `mutates` is tool metadata, not handler knowledge.** A
   `readonly mutates: boolean` is added to `RegisteredTool` (read tools `false`,
   `write_files` `true`); `ToolRegistry.definitions(filter?)` gains a
   `{ mutating?: boolean }` filter that drops mutating tools when `false`. The
   handler never hard-codes the `write_files` name — a future mutating tool (e.g.
   `run_shell`) is gated automatically by setting `mutates: true`. (UNANIMOUS.)

4. **Fork D1 — surface the resolved mode (SPLIT resolution).** Fork D was split:
   codex picked D2 (minimal wire — the client already knows the mode it sent);
   gemini picked D1 (surface it for UI state sync). Resolved to **D1**: the
   handler always resolves a mode (defaulting to `edit` when omitted), so it can
   always set it; echoing it back resolves the omitted→`edit` ambiguity for the
   client and makes the read-only enforcement auditable on the wire, which aligns
   with the trust/control intent of the seam. The cost is one always-present
   string field.

5. **Fork E1 — default `edit` when the request omits `mode`.** Backward-compatible
   (existing clients keep full capability) and matches the existing
   `DEFAULT_MODE = 'edit'`. (UNANIMOUS.)

**Deliberate divergence from a council trap.** Gemini suggested `.catch(DEFAULT_MODE)`
on the request field so an unrecognised mode from a newer client degrades
gracefully. **Rejected on safety grounds:** the default is `edit` (write-enabled),
so silently coercing an unknown mode to `edit` would *grant* write access on a
mode the server does not understand — the opposite of fail-safe. Strict enum
validation rejects an unknown mode at the dispatcher boundary (a `bad_request`),
which is the safe failure for a capability gate.

## Consequences

- Read-only agent modes are now genuinely read-only: in `ask`/`explain`/`plan`/
  `review`/`commit` the model is never offered an editor, and a stale write call
  is refused before it touches disk. `edit` is unchanged (full capability).
- The mode is a first-class wire field both directions; the IDE composer
  mode-selector render and the phase-based `AgentDriver` gating (which consumes
  `DirectiveSet.phases`, unused by this iteration-based handler) stay the
  remaining IDE/driver work — T-PRD08 stays `[~]`, dashboard counts unchanged.
- **Correctness traps guarded** (both reviewers): resolve the directive once
  before the loop (never per iteration); the backstop checks `tool.mutates`, not
  whether the name survived the advertise-filter; the read-only refusal message
  names the mode as a *policy* ("edits are not allowed in 'plan' mode") so the
  model treats it as a hard constraint, not a fixable permission error; the
  empty-tools spread is already guarded (the read-only list still has the 4 read
  tools).
- A future mutating tool inherits the gate for free via its `mutates` flag.

## Alternatives

- **A2 — parallel mode enums in protocol and core.** Rejected: two sources of
  truth that must be hand-synced; drift is inevitable.
- **B1-only (advertise-filter, no backstop).** Rejected: a model can emit a
  `write_files` call from prior `edit`-turn context even when it is not
  advertised this turn; without the backstop that call would route to approval
  and could write.
- **B2-only (runtime refusal, still advertise).** Rejected: wastes tokens
  advertising a tool the model cannot use and invites repeated refused calls.
- **C2 — hard-code `'write_files'` in the handler.** Rejected: bakes one tool
  name into control flow; a second mutating tool would silently bypass the gate.
- **D2 — do not surface the resolved mode.** Viable (codex's pick); D1 chosen for
  the omitted→default disambiguation and wire-level auditability.

## References

- ADR-014 — agent modes → directive sets (the zero-caller `modes.ts` this wires)
- ADR-023 — agent-turn tool loop (the handler this extends)
- ADR-013 — tool approval flow (the gate the backstop precedes)
- road-to-product-readiness T-PRD08 (agent modes) · Phase 2 (Trust & Control)
