---
adr: 052
title: Agent-Config Body Read — Completing The configList Contract With A Local-Only configRead {kind,name} Sibling (T-401)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council — codex-cli 0.134.0 + gemini-cli 0.41.2 (2026-06-02), both run serially per the documented stdin gotcha. UNANIMOUS Q0–Q3 = A across both members; Q4/Q5 traps reconciled in the Decision.
related: the read half of ADR-050 (configList). Mirrors the list+read PAIR that ADR-048 shipped for commands (`commandList` + `commandRead`); the command council had explicitly required BOTH because list-without-read is "half a contract". Reuses the `walkAgentConfig` collaborator already live for the rules loader (ADR-043), the command palette (ADR-048), and `configList` (ADR-050).
date: 2026-06-02
---

# ADR-052 — Agent-Config Body Read (configRead, T-401)

## Status

**Proposed** — awaits sign-off. One branch / one PR, committed in logical
chunks (protocol+codegen → core handler+wiring → tests → docs), preserving
minimal-safe-diff.

CI-verified locally: `task ci` exit 0 (lint, format, build, typecheck, test —
core 1147 pass / 1 skip, +15). `task jetbrains:check` BUILD SUCCESSFUL (the +2
Kotlin DTOs compile, 67 → 69). **No checkbox flip** — the skill picker / rules
viewer detail pane render remains an IDE surface; this is the headless body
data path those surfaces will call.

## Context

ADR-050 shipped `configList {kind?, limit?}` → lightweight `ConfigSummary`s for
the IDE's skill picker / rules viewer, but **without a read sibling**. The
command-palette council (ADR-048) had explicitly chosen BOTH `commandList` +
`commandRead` because "half a contract otherwise" — a list whose items the IDE
cannot open into a detail pane is incomplete. `configList` is exactly that same
half-contract for skills + rules + commands.

The `ConfigHandler` (ADR-050) walks the agent-config tree once and caches it;
every walked `ConfigNode` already carries `{kind, name, absPath, frontmatter,
body}` — the body is parsed from disk during the walk for **all three** kinds.
So the body the IDE needs already exists in the cached index; nothing new must
be read from disk. The agent-config MCP client (`AgentConfigMcpClient`) exposes
`skill_read` and `command_read` tools, but **no** `rule_read`.

## Decision

Add a read-only `configRead {kind, name}` → `{kind, name, source, body}`
protocol method on the existing `ConfigHandler`, reading the body straight off
the same cached walk `configList` groups.

Council (codex-cli + gemini-cli, both serial, UNANIMOUS Q0–Q3 = A):

- **Q0=A** — wire it now. Completes the `configList` contract; mirrors
  `commandRead`; the IDE skill/rule detail pane needs the body; Core stays the
  resolution authority.
- **Q1=A** — the request key is `{kind, name}`, not `{name}`. A name is **not**
  unique across kinds (a skill and a command can share a slug), so `kind` is the
  mandatory discriminator.
- **Q2=A** — **LOCAL-ONLY**. Read `node.body` from the cached walk; uniform
  across all three kinds. An MCP-first path (like `commandRead`) would be
  asymmetric — MCP has `skill_read`/`command_read` but no `rule_read` — and
  would add an MCP dependency to a handler deliberately designed without one
  (ADR-050 Q6). Hence `ConfigSourceSchema = 'local' | 'missing'` (no `mcp`
  member, unlike `CommandSource`).
- **Q3=A** — response `{kind, name, source: 'local'|'missing', body}` mirrors
  `commandRead`; a miss is `source: 'missing'` with an empty body (graceful, no
  throw), consistent with `commandRead`.
- **Q4 — full body, uncapped.** codex: match `commandRead` (which returns the
  full body uncapped); add a cap only behind evidence of an oversized-line
  problem. gemini flagged NDJSON line length as the theoretical risk. Resolved
  in favour of consistency with `commandRead`: a skill body is comparable in
  size to a command procedure the transport already carries; a special-case cap
  here would be an asymmetric surprise. (If a future skill body proves
  pathological, a cap can land uniformly across both read methods.)
- **Q5 — traps, both satisfied by design.** codex: list and read must not
  disagree after a file change → guaranteed, because `read` goes through the
  **same** `this.nodes()` walk-once cache as `list`. gemini: never interpolate
  `name` into a disk path (traversal) → guaranteed, because `read` matches
  against the in-memory walked nodes and never touches the filesystem with the
  request value.

One correctness refinement beyond the council: `read` matches on the artifact's
**display name** (`displayName` = a non-empty frontmatter `name`, else the file
slug) — i.e. exactly the `name` `configList` returned — not the raw file slug.
The shared `displayName` helper is now used by both `toSummary` (list) and
`read`, so the two can never key on different names.

## Consequences

- **+2 DTOs** (`ConfigReadRequest`, `ConfigReadResponse`) + `ConfigSource`
  enum, 67 → 69 in codegen; +1 protocol method (`configRead`), behind the
  existing `requireConfig()` → coded `config_not_configured` when absent.
- The skill picker / rules viewer detail pane now has a headless,
  offline-capable body data path that does not depend on the agent-config MCP
  server being up — Core stays the resolution authority, exactly as for
  `configList` and `commandRead`.
- No behaviour change to any existing path; `list` is refactored only to share
  the new `displayName` helper (byte-identical projection).
- The IDE render remains the last-mile surface; this ADR does not flip any
  roadmap checkbox.

## Alternatives considered

- **Leave `configList` without a read sibling (Q0=B).** Rejected — it is the
  documented half-contract; the IDE cannot open a listed artifact.
- **`{name}`-only key (Q1=B).** Rejected — names collide across kinds; the
  result would be ambiguous.
- **MCP-first like `commandRead` (Q2=B).** Rejected — asymmetric (no
  `rule_read`) and pulls an MCP dep into a local-only handler for no gain, since
  the body is already on every walked node.
- **Cap the body length (Q4).** Deferred (YAGNI) — match `commandRead`'s
  uncapped body; revisit uniformly if evidence of an oversized line appears.

## References

- `packages/core/src/config/handler.ts` — `ConfigHandler.read` + the shared
  `displayName` helper.
- `packages/protocol/src/schema.ts` — `ConfigReadRequest/Response`,
  `ConfigSource`.
- ADR-050 — the `configList` half this completes.
- ADR-048 — the `commandList` + `commandRead` PAIR this mirrors.
- ADR-043 — the `walkAgentConfig` live collaborator reused here.
- `agents/roadmaps/road-to-v1-0.md` T-401 — the registry data path.
