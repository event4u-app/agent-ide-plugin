---
adr: 001
title: Build vs Fork — Continue.dev as starting point
status: Proposed (drafted 2026-05-28 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (claude-sonnet-4-5 + gpt-4o, 2026-05-28, 2 rounds)
related: ADR-002 (Positioning), ADR-003 (UI-stack), ADR-004 (Permission Model)
date: 2026-05-28
source_spike: agents/analysis/spike-reports/spike-0-1-continue-fork.md
---

# ADR-001 — Build vs Fork

## Status

**Proposed** — drafted from Phase 1 Spike 0.1 verdict. Awaits user sign-off in writing. Sign-off triggers flip to **Accepted (YYYY-MM-DD)**.

## Context

The plan calls for a JetBrains + VS Code AI assistant plugin with event4u-specific differentiators: dual-mode (API + CLI) per LLM provider, cost-tracking on 4 levels, agent-config tree-walker, slash-command picker for 136 commands, Hard-Floor permission gate (ADR-004), pre-flight cost estimate, signed pricing book.

**Continue.dev** (`continuedev/continue`, Apache-2.0, 33k stars, 393 contributors) ships a JetBrains + VS Code AI assistant with overlapping scope. Three options:

1. **Fork:** clone Continue, modify it into our plugin.
2. **New-build:** write from scratch, no Continue code.
3. **Hybrid:** new-build host, selectively lift Continue subsystems.

Spike 0.1 (research-grade evidence, no bolt-on prototype run in autonomous session) audited Continue's architecture against our 7 required differentiators.

## Decision

**Hybrid.** New-build host, selective lifts from Continue.

### What we lift from Continue (Apache-2.0)

1. **`@continuedev/terminal-security`** — npm package, 1241-line `shell-quote`-based deny-list. Lift verbatim, extend with our Hard-Floor patterns. Saves 2-3 weeks.
2. **Model-pricing tables** (`core/llm/utils/calculateRequestCost.ts`) — copy structure, our Pricing Book wraps with Sigstore signing.
3. **JCEF + Node-sidecar wire format** (`binary/src/IpcMessenger.ts` shape) — newline-delimited JSON over stdin/stdout. Our `binary/` follows the same packaging pattern (esbuild + `pkg`).
4. **Tree-sitter + LanceDB indexing** (`core/indexing/`) — reference for our Context Engine v0/v1.

### What we build fresh

1. **Host plugin** (Kotlin + JCEF + Compose where Compose-native makes sense per ADR-003).
2. **Provider abstraction with first-class dual-mode** (API + CLI per provider). Continue's `BaseLLM` is HTTP-only — see Spike 0.1 §2.
3. **agent-config tree-walker** — Continue has no equivalent.
4. **Pre-flight cost estimate** module.
5. **Pricing book with Sigstore signature.**
6. **In-chat cost footer + per-day rollup UI.**
7. **Slash-picker for 135 commands** with fuzzy + favorites (Continue's picker is prefix-only, ships 7 commands).

## Consequences

### Positive

- 2-3 weeks saved on terminal-security gate (the hardest correctness path).
- Architecture pattern proven at 33k-user scale.
- Apache-2.0 attribution lightweight; no licensing risk.
- Lifts are extractable npm packages or one-file references — minimal rebase pain.

### Negative

- Fork-friendliness score (Spike 0.1): 4 rewrites · 2 mediums · 1 easy out of 7 differentiators. Most of our value-prop falls in rewrite territory regardless.
- Need to maintain pricing-table copy-and-extend hygiene (when Continue adds a new model's price, we have to re-sync our table).
- Inheriting Continue's wire format couples us to their JSON envelope — escape hatch is small (it's NDJSON, we could swap to LSP later).

### Negative — risks the Hybrid does NOT solve

- Solo-dev maintenance of "selective lifts" requires discipline. A drift PR upstream that changes the terminal-security API breaks us.
- The "fresh build" surfaces are still the bulk of the work (host plugin, dual-mode providers, picker, cost UI).

## Alternatives considered

- **Fork** — rejected. Provider abstraction is single-transport; slash picker is built for ~10 commands; cost UI is debug-console only. Most differentiators land in rewrite. The "≤2 days bolt-on clean" criterion is unlikely to pass on Continue's shape.
- **New-build** — rejected (provisionally). Wastes 2-3 weeks rebuilding the terminal-security gate that Continue already shipped. Loses the prior of a working JCEF + sidecar architecture.

## References

- Spike 0.1 — `agents/analysis/spike-reports/spike-0-1-continue-fork.md`
- AI Council top-10 finding #3 (Build-vs-Fork unfalsifiable without spike), 2026-05-28
- Continue.dev repo — `https://github.com/continuedev/continue` (HEAD 2026-05-28)
- `@continuedev/terminal-security` — `packages/terminal-security/`

## Sign-off

Awaits user sign-off. On sign-off:
- Flip Status to **Accepted (YYYY-MM-DD)**.
- `agents/analysis/PLAN.md` §17 (Phasen-Plan) updated to assume Hybrid (no major rewrite of MVP roadmap — Hybrid keeps the MVP roadmap shape).
- Two follow-up tickets: (a) add `@continuedev/terminal-security` to MVP T-304 dependencies; (b) Continue-Apache-2.0 attribution added to NOTICE file in MVP T-101.
