---
adr: 050
title: Agent-Config Registry Data Path — Wiring The Dead indexByKind As A configList Protocol Method For Skills + Rules (T-401)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council — gemini-cli 0.41.2 answered Q0–Q7 = A/B/A/B/A/A/A/A (2026-06-02); codex-cli 0.134.0 was invoked with the same question set but hung >7 min producing zero output and was terminated (a recurring codex-exec flakiness this repo has hit before), so the second opinion is gemini + the host agent's own seam-hunt + independent caller verification. The one reasoned divergence from gemini is Q6 (see Decision).
related: sibling of ADR-048 (command-palette data path) for the artifact kinds it does not surface — skills + rules. The MCP path (`AgentConfigMcpClient.listSkills`/`skillRead`, T-1102) is IDE-gated (MCP server lifecycle is IDE-native); this is the local-walker authority/offline sibling, mirroring how `commandList` relates to the MCP `command_read`. Reuses the `walkAgentConfig` collaborator already live for the rules loader (ADR-043) and the command palette (ADR-048).
date: 2026-06-02
---

# ADR-050 — Agent-Config Registry Data Path (configList, T-401)

## Status

**Proposed** — awaits sign-off. One branch / one PR, committed in logical
chunks (protocol+codegen → core handler+wiring → tests → docs), preserving
minimal-safe-diff.

CI-verified locally: `task ci` exit 0 (lint, format, build, typecheck, test —
protocol 55, shared 5, vscode 40, core 1132 pass / 1 skip). `task
jetbrains:check` BUILD SUCCESSFUL (the +3 Kotlin DTOs compile). **No checkbox
flip** — the skill picker / rules viewer render remains an IDE surface; this is
the headless data path those surfaces will call.

## Context

The pure-core "wire a dead seam" runway after ADR-049 looked thin, but a fresh
Explore seam-hunt + independent caller verification found one genuinely-dead,
non-artificial core export:

`packages/core/src/config/agent-config-walker.ts::indexByKind` groups a flat
`ConfigNode[]` into `{skill[], rule[], command[]}`. It is fully unit-tested and
has **zero live callers** (only its own test imports it — verified by a
whole-repo grep excluding `*.test.ts`/`dist`). The Explore agent's other
candidates were rejected on cross-check: `phaseRunsInMode` (IDE-gated,
already a recorded reject), `sortAndDedup` (live at `review/pipeline.ts:308`),
`dismissalFor` (live inside `review/dismissals.ts`).

The capability gap is real, not invented. `walkAgentConfig` discovers **all**
agent-config artifacts — skills, rules, and commands — but the only protocol
data path that ships (ADR-048's `CommandHandler`) filters the walked tree to
`kind === 'command'`. Skills and rules — also walked, also in the index — have
**no** protocol data path. The IDE cannot populate a skill picker or a rules
viewer. `indexByKind` is exactly the grouping helper that path needs.

## Decision

Wire `indexByKind` over one new read-only protocol method, `configList
{kind?, limit?}` → `{items: ConfigSummary[], total}`, on a **dedicated
`ConfigHandler`**. `ConfigSummary {kind, name, description, path}` mirrors
`CommandSummary` and adds `kind` so one flat list can carry skills, rules, and
commands. Absent `kind` → every artifact (skills, then rules, then commands,
alphabetical within each kind as the walker sorts); a `kind` → that kind only.
`total` is the count before a `MAX_CONFIG_LIST_RESULTS=100` clamp so a browser
can show "showing N of M". Description falls back frontmatter `description` →
first heading → `''`, and a non-empty frontmatter `name` overrides the slug —
both identical to the command picker's projection.

Council resolution (gemini Q0–Q7 = A/B/A/B/A/A/A/A):

- **Q0=A** — wire it (the dead seam fills a real gap).
- **Q1=B** — return all three kinds; the unified registry is one call, and
  commands appearing here (without the slash-palette fuzzy ranking) is
  harmless. The kind filter narrows to skills or rules.
- **Q2=A** — optional `kind` filter; absent returns all.
- **Q3=B** — flat `{items, total}` with a `kind` field per item, mirroring
  `commandList` rather than a grouped object.
- **Q4=A** — `{kind, name, description, path}`; absolute path for IDE
  click-through, no `relPath`/`sourceRoot` bloat (YAGNI).
- **Q5=A** — lightweight summary only; no frontmatter map or body on the wire
  (a body-read method can follow if a surface needs it).
- **Q6 — reasoned divergence.** Gemini chose A (extend `CommandHandler`,
  reusing its cached walk). The host agent chose **B (a dedicated
  `ConfigHandler`)** for two reasons: (1) it preserves the codebase's
  one-handler-per-domain shape (`ChatHandler`, `GitHandler`, `CommandHandler`,
  `CostReporter`, `TerminalHandler`) — overloading the command handler with
  skill/rule listing muddies its contract; (2) **correctness** — gemini's
  cache-reuse benefit would require a sidecar-level shared walk promise, which
  would cache a *transient* FS error for the whole session, defeating each
  handler's fail-open-and-retry cache. Each handler keeps its own
  `loadNodes: () => walkAgentConfig(cwd)`. The cost is one extra tree walk on
  first use; config trees are small (the same premise behind Q7), so this is
  negligible and buys the fail-open resilience.
- **Q7=A** — hard `MAX_CONFIG_LIST_RESULTS=100` clamp + carry `total`,
  sibling-consistent with `commandList` / `conversationList`.

## Consequences

- **+3 DTOs** (`ConfigSummary`, `ConfigListRequest`, `ConfigListResponse`),
  64 → 67 in codegen; +1 protocol method (`configList`), behind
  `requireConfig()` → coded `config_not_configured` when absent.
- The skill picker / rules viewer now have a headless, offline-capable data
  path that does not depend on the agent-config MCP server being up — Core
  stays the resolution authority, exactly as for `commandList`.
- No behaviour change to any existing path; `CommandHandler` is untouched.
- The IDE render (skill picker overlay, rules viewer) remains the last-mile
  surface; this ADR does not flip any roadmap checkbox.

## Alternatives considered

- **Leave `indexByKind` dead (Q0=B).** Rejected — it fills a real gap and the
  wiring is a thin, low-risk pure-core slice.
- **Extend `CommandHandler` (Q6=A).** Rejected for the contract-clarity +
  fail-open-resilience reasons above.
- **Skills only (Q1=C).** Rejected — rules also lack a UI data path; a unified
  registry with a kind filter covers both at no extra cost.
- **Include frontmatter/body in the summary (Q5=B/C).** Deferred (YAGNI) — a
  separate read method can fetch a body when a surface needs it.

## References

- `packages/core/src/config/handler.ts` — the new `ConfigHandler`.
- `packages/core/src/config/agent-config-walker.ts::indexByKind` — the wired seam.
- ADR-048 — the command-palette sibling this mirrors.
- ADR-043 — the `walkAgentConfig` live collaborator reused here.
- `agents/roadmaps/road-to-v1-0.md` T-401 — the walker; T-1102 — the MCP
  skill/rule path this complements with a local-walker authority path.
