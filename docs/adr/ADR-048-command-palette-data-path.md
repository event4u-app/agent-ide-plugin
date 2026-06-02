---
adr: 048
title: Command-Palette Data Path — Wiring The Dead Picker + Loader As commandList / commandRead Protocol Methods (T-402 / T-1103)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 — UNANIMOUS Q0=A (wire the command-palette data path over the dead picker/loader, not just retire dead code or stop), Q1=B (ship BOTH commandList + commandRead — a palette that lists but cannot load a body is half a contract), Q2=A (one commandList{query?} method: empty query → all alphabetical, query → ranked — the picker already treats empty as the full list), Q3=A (CommandSummary {name,description,path} DTO = the PickerItem shape; new CommandHandler over walk-once-cached walkAgentConfig, mirroring createRulesLoader), Q4=A (keep the absolute path — local sidecar ↔ local IDE, click-through needs it), Q6=A (confirmed a capability advance, core is the loader the IDE calls); Q5 born-dead risk → mitigated by keeping core the authority on MCP-first/local-fallback resolution and naming this the core half of T-402/T-1103)
related: discharges the core/transport half of T-402 (slash-command picker) + T-1103 (all commands callable). The picker (`commands/picker.ts`) and loader (`commands/loader.ts`) shipped unit-tested with ZERO live callers; the live collaborator `walkAgentConfig` is already walked live (the rules loader, ADR-043). Same proven "Core returns data, the IDE renders it" pattern as conversationSearch/conversationList (ADR-045/046). The overlay rendering + invocation UX remain IDE surfaces → T-402/T-1103 stay `[~]`.
date: 2026-06-02
---

# ADR-048 — Command-Palette Data Path (wiring the dead picker + loader as commandList / commandRead, T-402 / T-1103)

## Status

**Proposed** — awaits sign-off. One branch / one PR, three commit chunks
(protocol + codegen → core → docs), preserving minimal-safe-diff.

CI-verified locally: `task ci` exit 0 (lint, build, typecheck, format clean);
protocol 55 pass (+2), core 1126 pass / 1 skip (+15); `jetbrains:check` BUILD
SUCCESSFUL; codegen 59 → 64 DTOs (+5); sidecar startup smoke clean
(`agent core ready`). **No checkbox flip** — T-402 / T-1103 stay `[~]`.

## Context

A fresh thorough seam-hunt found the pure-core "wire a dead seam" runway
otherwise exhausted: the remaining dead exports are either explicitly DEFERRED
`[~]` IDE work (AgentDriver/EditLoop = T-PRD08, recordCheckpoint = T-1303,
hooks, engagement) — deleting them would destroy planned work — or one genuinely
dead twin (`context/inject.ts`, superseded by the live `buildContextInjection`).

The exception is the **command-palette data path**, dead-but-DEFERRED under
T-402 + T-1103:

- `commands/picker.ts` — `commandsToPickerItems(nodes)` projects command
  `ConfigNode`s → `{name, description, path}`; `pickCommands(items, query)`
  filters + ranks (empty query → all alphabetical). Pure, tested, ZERO callers.
- `commands/loader.ts` — `loadCommandProcedure(name, {mcp?, localNodes})` loads
  a command body, MCP-first then local-fallback. Pure, tested, ZERO callers.
- The live collaborator EXISTS: `walkAgentConfig(cwd)` is already walked live by
  the rules loader (ADR-043). No agent-config MCP client is constructed in the
  dispatcher, so the loader runs local-only — its documented offline path.

This is the same shape as the conversationSearch/conversationList slices
(ADR-045/046): a shipped-tested-but-dead pure-core capability whose live
consumer (here the IDE) reaches it through a NEW protocol method.

## Decision

Add two read-only protocol methods backed by a new `CommandHandler`:

- `commandList {query?, limit?}` → `{commands: CommandSummary[], total}` — the
  palette's list/search data path.
- `commandRead {name}` → `{name, source, body}` — load a command's procedure
  body at invocation time.

`CommandHandler` holds the command index via an injected
`loadNodes: () => walkAgentConfig(cwd)`, walked ONCE and cached for the session
(commands are session-static, like rules — mirrors `createRulesLoader`).
Registered in the dispatcher behind a `requireCommands()` guard
(`commands_not_configured` when absent); `buildCoreDispatcher` constructs one
unconditionally, so the methods are live.

**Wire shape (AI council 2026-06-02, UNANIMOUS unless noted):**

- **One `commandList {query?}` (Q2=A).** The picker already treats an empty
  query as the full alphabetical list and a non-empty query as a ranked
  subsequence match, so one method covers both list + search; a separate
  `commandSearch` would add surface for no gain. `total` is the match count
  before the cap so the IDE shows "showing N of M" (mirrors conversationList).
  Core clamps to `MAX_COMMAND_LIST_RESULTS` (100) for NDJSON-line safety.
- **Both methods (Q1=B).** `commandList` populates the palette; `commandRead`
  loads the selected body on invoke. Shipping only one leaves the feature
  non-functional end to end.
- **`CommandSummary {name, description, path}` (Q3=A).** Exactly the existing
  `PickerItem` shape; no new projection. The `description` falls back to the
  first heading when frontmatter has none (the picker's existing behaviour).
- **Keep the absolute `path` (Q4=A).** The sidecar and IDE are local peers on
  the same filesystem; the absolute path is what the IDE needs for
  click-through to the command file.
- **Core stays the resolution authority (Q5/Q6).** `commandRead` keeps the
  loader's MCP-first/local-fallback order so the agent and the palette see the
  same body and the plugin works offline / before the MCP server is up — the
  born-dead-risk mitigation (the IDE calls core, it does not re-implement
  discovery).

**Traps guarded:**

- **`Methods` registry test** asserts the exact sorted key set — `commandList`
  + `commandRead` added to the expected list.
- **Hand-maintained codegen descriptors** — five new request/response/summary
  descriptors added by hand; `task codegen` regenerated `Protocol.kt`
  (59 → 64 DTOs).
- **Kotlin doc ≤112 / detekt MaxLineLength** — every generated DTO `doc:`
  string stays well under the ceiling; `jetbrains:check` BUILD SUCCESSFUL.
- **exactOptionalPropertyTypes-safe** — the handler spreads `mcp` conditionally
  (`...(this.deps.mcp ? {mcp} : {})`) into the loader deps, never emitting
  explicit `undefined` into the optional field.
- **Fail-open walk** — a walk error degrades to an empty index WITHOUT caching
  (a transient FS race retries next call), mirroring `createRulesLoader`.

## Consequences

**Positive.** The slash-command palette has its first wire transport — the IDE
can list/search commands and load a body without re-implementing agent-config
discovery, and core stays the single source of truth (agent + palette see the
same commands). No native deps. Same proven pattern as conversationList/Search.

**Negative / limits.** The overlay rendering, favourites, and the invocation UX
remain IDE surfaces, so T-402/T-1103 stay `[~]` — the transport is live but
unexercised end-to-end until the IDE calls it. No agent-config MCP client is
wired yet, so `commandRead` is local-only today (the loader prefers MCP the
moment a client is constructed — a documented follow-up). Favourites ordering
(roadmap Sprint 12) is out of scope.

**No checkbox flip.** T-402 / T-1103 stay `[~]`. Dashboard counts unchanged.

## Alternatives considered

- **Retire `context/inject.ts` instead (Q0=B).** Clean and precedented (a prior
  PR retired a dead `tracking/audit-log.ts`), but a deletion is not a capability
  advance; the command data path is the higher-value, roadmap-anchored slice.
  The retire remains a clean separate follow-up.
- **Stop — declare pure-core work exhausted (Q0=D).** Rejected — the command
  data path is genuine deferred core/transport work with an obvious live
  consumer, not an artificial wire.
- **Separate `commandList` + `commandSearch` (Q2=B).** Rejected — the picker's
  empty-query-is-the-full-list semantics make one method sufficient; a split
  duplicates surface.
- **commandList only, defer commandRead (Q1=A/C).** Rejected — the palette
  needs both to function; shipping half is a dead-end transport.
- **Omit / relativise the path (Q4=B/C).** Rejected — the local IDE needs the
  absolute path for click-through; there is no cross-host leak (same machine).

## References

- `packages/core/src/commands/picker.ts` — `commandsToPickerItems` / `pickCommands` (the reused dead picker).
- `packages/core/src/commands/loader.ts` — `loadCommandProcedure` (the reused dead loader, MCP-first/local-fallback).
- `packages/core/src/commands/handler.ts` — new `CommandHandler` + `MAX_COMMAND_LIST_RESULTS` + `CommandRequestError`.
- `packages/core/src/server.ts` — `commandList` / `commandRead` handlers + `requireCommands()`.
- `packages/core/src/sidecar.ts` — constructs the `CommandHandler` from `walkAgentConfig(cwd)` (8th dispatcher arg).
- `packages/protocol/src/schema.ts` — `CommandSummary` / `CommandListRequest|Response` / `CommandReadRequest|Response` + `Methods.commandList` / `commandRead`.
- `scripts/codegen.ts` — the five new Kotlin DTO descriptors.
- `packages/core/src/commands/handler.test.ts` (11), `server.test.ts` (+3), `sidecar.test.ts` (+1 live-wiring), `packages/protocol/src/schema.test.ts` (+2 round-trip + sorted registry).
- ADR-043 — the rules loader that made `walkAgentConfig` live + the walk-once-cache pattern.
- ADR-045 / ADR-046 — the sibling conversationSearch / conversationList wirings (same "Core returns data, IDE renders" shape).
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2).

## Sign-off

On flip to **Accepted**: the command-palette data path is live on the wire; the
overlay rendering, favourites, and invocation UX land with the IDE composer
work that closes T-402 / T-1103. Wiring an agent-config MCP client (so
`commandRead` prefers it) and the dead-twin `context/inject.ts` retire are
documented follow-ups.
