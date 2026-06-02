---
adr: 049
title: Retire The Dead Context-Injection Twin — context/inject.ts Superseded By The Live buildContextInjection (T-605 / T-606)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 — UNANIMOUS Q0=A (retire the zero-caller competing contract; it is dead code, not a useful alternative), Q1=A (warrants a dedicated ADR mirroring the ADR-039 retire precedent — documents the supersession so the user-message pattern is not re-implemented), Q2=A (T-605/T-606 stay `[x]` and their done-comments are updated to cite the live `buildContextInjection` — the capability survived, only the losing implementation changed), Q3=A (nothing to port — the live fixed 8000-char cap is the council-blessed system-prompt contract and is safer than the dynamic 20%-window budget that could overflow the system-prompt cache block), Q4 no trap (zero live callers confirmed; the system-prompt placement is better instruction-following steering than user-message injection; just update stale refs + grep))
related: discharges a documentation/cleanup follow-up named by ADR-048 (which flagged `context/inject.ts` as the one genuinely dead twin) and ADR-043 (which REJECTED wiring `injectContext` because it is a competing impl of the already-live `buildContextInjection`). Mirrors the ADR-039 retire of the dead `tracking/audit-log.ts` (T-413) superseded by the live `permissions/audit.ts`. No protocol/codegen change; T-605/T-606 stay `[x]`.
date: 2026-06-02
---

# ADR-049 — Retire The Dead Context-Injection Twin (context/inject.ts, T-605 / T-606)

## Status

**Proposed** — awaits sign-off. One branch / one PR, two commit chunks
(core deletion → docs), preserving minimal-safe-diff.

CI-verified locally: `task ci` exit 0 (lint, build, typecheck, format clean).
**No checkbox flip** — T-605 / T-606 stay `[x]` (the capability is live via the
system-prompt placement; only the losing implementation file is removed).

## Context

The pure-core "wire a dead seam" runway is otherwise exhausted for clean
autonomous slices (a fresh seam-hunt + independent code verification confirmed:
the command-palette data path is wired as of ADR-048; the `AgentConfigMcpClient`
wiring is IDE-gated because the MCP server lifecycle is IDE-native; embed
cost-tracking is a wide feature needing an `ActivitySchema` enum + `Embedder`
hooks). The one remaining genuinely-dead, zero-risk slice is a **retire**.

There are two competing context-injection implementations:

- **`packages/core/src/context/inject.ts`** (76 lines, `buildContextBlock` +
  `injectContext` + `ContextBlockOptions`) — the recorded implementation of
  **T-605** (context-block injection) and **T-606** (cache-friendly placement).
  Its contract: render the relevance-ordered snippets into a fenced
  `[Context: …]` block and insert it into the **last user message**, leaving
  `request.system` byte-identical so the `cache_control`'d static rule prefix
  stays cached across turns. Token budget = 20% of the model context window
  (~4 chars/token). Six unit tests in `inject.test.ts`.

- **`packages/core/src/chat/context-injection.ts::buildContextInjection`**
  (T-MR13, ADR-025) — the LIVE path, used in BOTH `chat/handler.ts:356` and
  `agent/turn-handler.ts:312`. Its contract: produce a `<workspace-context>`
  block placed in the **system prompt** as the `base` of `resolveSystemPrompt`,
  AFTER the cached guidelines/rules prefix, bounded to 8000 chars (under the
  16KB guidelines cap).

The system-prompt placement (T-MR13) won and is live. The user-message twin
(`context/inject.ts`) is the dead loser:

- Grep across `packages/core/src` and `clients/` (excluding its own test and
  any `/dist/`) returns **zero** callers. No barrel/index re-exports.
- Deleting it does not orphan `context/snippet.ts` — `Snippet` is still imported
  by `annotations.ts`, `indexer.ts`, `chunk-tree.ts`, and `engine.ts`.

This is the same shape ADR-043 already named when it REJECTED wiring
`injectContext` ("a COMPETING impl of the already-live `buildContextInjection`")
and the same retire shape as ADR-039 (`tracking/audit-log.ts`, T-413).

## Decision

**Retire `context/inject.ts` + `context/inject.test.ts`** (Q0=A).

- **ADR (Q1=A).** This ADR documents the supersession so the user-message
  injection pattern is not re-implemented later. Matches the ADR-039 precedent.
- **Checkboxes (Q2=A).** T-605 / T-606 stay `[x]` — the capability
  (cache-friendly context-block injection) IS live, via `buildContextInjection`.
  Their done-comments are updated in `road-to-v1-0.md` to cite the live impl and
  record this retire, so the audit trail stays correct without losing the
  history of completed work.
- **No port (Q3=A).** The 20%-of-context-window dynamic budget is NOT ported.
  The live fixed 8000-char cap is the council-blessed system-prompt contract and
  is safer: a dynamic 20% window could overflow the system-prompt cache block
  that the guidelines/rules prefix shares.

### Both implementations preserve the SAME cache goal

The retire loses no insight. Both keep the cached static prefix byte-identical
and let the per-turn context ride where cache misses are expected:

- `inject.ts`: per-turn block in the **user message**, `request.system`
  untouched.
- `buildContextInjection`: per-turn `<workspace-context>` block as the
  system-prompt **suffix AFTER** the `cache_control`'d guidelines/rules prefix.

The live placement additionally gives better instruction-following steering
(context in the system prompt, not buried in the user turn) — council Q4.

## Consequences

- **Positive.** One fewer competing context-injection contract; the codebase has
  a single source of truth for snippet injection. Removes a stale 76-line file +
  its 6 tests that could mislead a future contributor into re-wiring the dead
  user-message path.
- **Neutral.** No runtime behavior change — the deleted code had zero live
  callers. No protocol/codegen change. `jetbrains:check` unaffected (no Kotlin /
  protocol touch).
- **Negative / risk.** The historical ADR-043 / ADR-048 prose still references
  `context/inject.ts` as it existed at the time — those are dated decision
  records and are intentionally left unchanged (history is not rewritten); this
  ADR-049 is the authoritative record that the file is now retired.

## Alternatives considered

- **Keep `inject.ts` as a documented alternative (Q0=B).** Rejected: a
  zero-caller competing contract is dead code, not a useful alternative; the
  live system-prompt placement already documents the chosen approach.
- **Roadmap-note only, no ADR (Q1=B).** Rejected: the supersession crosses a
  recorded `[x]` task pair (T-605/T-606) whose done-comments cite the retired
  file; a dedicated ADR (matching ADR-039) is the durable record.
- **Port the dynamic 20% budget (Q3=B).** Rejected: the fixed 8000-char cap is
  the live contract and is safer against system-prompt cache-block overflow.

## References

- Retired: `packages/core/src/context/inject.ts`, `context/inject.test.ts`.
- Live replacement: `packages/core/src/chat/context-injection.ts`
  (`buildContextInjection`), used in `chat/handler.ts:356` +
  `agent/turn-handler.ts:312`.
- Roadmap: `agents/roadmaps/road-to-v1-0.md` T-605 / T-606 (stay `[x]`,
  done-comments updated).
- Precedent: ADR-039 (retire dead `tracking/audit-log.ts`, T-413); ADR-043
  (rejected wiring `injectContext` as a competing impl); ADR-048 (named this
  retire as the one genuinely dead twin); ADR-025 (the T-MR13 live
  context-injection path).

## Sign-off

On flip to **Accepted**: no further action — the deletion + roadmap-comment
update + this ADR are the complete change. The PR is ready for review.
