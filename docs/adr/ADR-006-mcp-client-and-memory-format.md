---
adr: 006
title: MCP Client (hand-rolled, zero-dep) + Local Memory On-Disk Format (md+frontmatter)
status: Proposed (drafted 2026-05-30 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex/gpt-5.5 + gemini-2.5-pro, 2026-05-30 Phase 11 design round)
related: road-to-v1-0 Phase 11 (T-1101, T-1102, T-1104, T-1105, T-1106)
date: 2026-05-30
---

# ADR-006 — MCP Client + Local Memory Format

## Status

**Proposed** — drafted alongside the road-to-v1-0 Phase 11 core implementation
(`packages/core/src/mcp/`, `packages/core/src/memory/`). Awaits explicit user
sign-off before flip to **Accepted**.

## Context

Phase 11 adds an MCP client (so the plugin can consume arbitrary MCP servers and
the agent-config MCP server) and a local memory store. Two design forks needed a
decision, and both were put to the AI Council (codex/gpt-5.5 + gemini-2.5-pro):

1. **MCP stdio client** — adopt the official `@modelcontextprotocol/sdk`
   (Client + StdioClientTransport) or hand-roll a minimal JSON-RPC stdio client?
2. **Local memory on-disk format** — the roadmap (T-1104) says "JSON files per
   agent-config memory schema", but the *actual* agent-config memory contract on
   disk is Markdown with YAML frontmatter (`name` / `description` /
   `metadata.type`) plus a `MEMORY.md` index. Which format is truly compatible?

## Decision

### 1. Hand-rolled, zero-dependency MCP client

MCP's stdio transport is JSON-RPC 2.0 framed as **newline-delimited JSON** — the
exact shape this repo already speaks for its own sidecar envelope (ADR-003) and
its `codex exec --json` parser. We model the subset we consume directly
(`initialize`, `tools/list`, `tools/call`) over an injectable transport seam,
reusing the existing `readNdjson` helper. **No new runtime dependency is added.**

Rationale:

- **No-native-deps law + CI-matrix safety.** The project's established law (see
  the Phase-8 vector-store decision: pure-TS over `sqlite-vec`/`onnxruntime`) is
  to hand-roll the minimal thing rather than pull a dependency whose transitive
  graph could break the node-20/22 × {macOS,Ubuntu,Windows} matrix. codex (which
  favoured the SDK) itself flagged "transitive dependency drift" as the main risk
  and proposed a CI audit to mitigate it; hand-rolling removes the risk at the
  source.
- **Precedent.** ADR-003 already rejected `vscode-jsonrpc` for the sidecar's own
  transport in favour of a hand-rolled NDJSON envelope. MCP stdio is the same
  framing; consistency wins.
- gemini recommended hand-rolling directly; codex conceded the drift risk. The
  no-dep path satisfies both.

Council convergence (Q2/Q4): tools are modelled behind an injectable
`McpToolProvider`/registry with a `FakeTransport` for deterministic tests;
prefixing (`<server-id>:<tool>`) happens at the aggregation layer; the client is
**fail-open** — a bounded `initialize` timeout (5s default), per-call timeout
(30s default), per-server degrade, and explicit teardown so one hung/dead server
never pins the agent loop.

### 2. Local memory uses md+frontmatter+`MEMORY.md`, not JSON

`packages/core/src/memory/local.ts` round-trips Markdown-with-YAML-frontmatter
files plus a regenerated `MEMORY.md` index — the format agent-config actually
writes and humans edit and Git tracks. The roadmap's "JSON" wording yields to the
real agent-config contract: a JSON-only store would be a compatibility silo that
agent-config's own CLI/MCP could not read, defeating the "agent-config coverage"
goal of the phase. Memories live under `<workspace>/.event4u-agent/memories/`
(plugin-local directory, agent-config-compatible file format).

Council was **unanimous** on this (both members independently chose
md+frontmatter+index over JSON).

## Consequences

- **Positive.** Zero new dependencies; CI matrix stays green by construction.
  Memories are interoperable with agent-config and human-editable. The transport
  seam makes the whole MCP layer unit-testable with no subprocess (25 MCP tests
  run with a `FakeTransport`).
- **Negative / accepted.** We track the slice of the MCP spec we use by hand; a
  future MCP revision that changes `initialize` / `tools/*` shapes needs a manual
  bump (mitigated by lax zod parsing with defaults + passthrough). The roadmap
  text for T-1104 ("JSON files") is superseded by this ADR.
- **Follow-up.** Wiring the MCP tool registry into the dispatcher's tool set and
  firing hooks at real session lifecycle points is IDE-runtime work and remains
  `[~]` on the roadmap (the exit-gate items), consistent with how Phase 7 core
  landed ahead of its IDE surfacing.

## Alternatives considered

- **Official `@modelcontextprotocol/sdk`.** Rejected for dependency-drift risk on
  the multi-OS/multi-node matrix and inconsistency with ADR-003. Revisit if the
  hand-rolled subset ever needs MCP features beyond tools (resources, prompts,
  sampling) where re-implementing would exceed the SDK's maintenance cost.
- **JSON memory store.** Rejected as an agent-config compatibility silo.

## Sign-off

On flip to **Accepted**: no code change required (the implementation already
embodies the decision). Update `agents/analysis/PLAN.md` §11 if/when it
references the MCP transport choice.
