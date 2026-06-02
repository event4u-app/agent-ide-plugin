---
adr: 039
title: Agent-Turn Anti-Loop Guard — Stopping Re-Proposed write_files Batches (T-702c, Wiring hashEdits Into The Live Iteration Loop)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 fork round — Q0 SPLIT B (codex) / D (gemini), resolved D = anti-loop guard + the ADR-038 dead-code retire in ONE branch/PR as separate chunks; Q1=b warn-once-then-stop-on-second-repeat; Q2 write_files-only; Q3 DEFER truncateAndReinject; Q4 reuse `max_iterations` stop reason (no new wire surface); Q5 traps — same-turn-only, never on first occurrence, hashEdits must include the file path (verified: it does), define "repeat" on the PROPOSED batch with warn-once cushioning the denied/unresolved re-propose case)
related: discharges part of T-702c (road-to-v1-0 Phase 7). T-702c's full EditLoop (agent/edit-loop.ts) shipped engine-complete in ADR-014/2026-05-30 but its real live consumer is the IDE-gated AgentDriver (plan→implement→verify + bulk-diff card, Phase-7 exit gate) and it needs a ModelEditStep adapter + sub-task decomposer + a model-escalation mechanism that do NOT exist. This slice instead wires EditLoop's exported, zero-caller `hashEdits` (the `visitedSet` primitive) into the EXISTING iteration-based AgentTurnHandler as a behaviour-bounding guard. Also retires the dead `tracking/audit-log.ts` (T-413) named as a follow-up by ADR-038.
date: 2026-06-02
---

# ADR-039 — Agent-Turn Anti-Loop Guard (Wiring hashEdits into the live iteration loop, T-702c)

## Status

**Proposed** — awaits sign-off. Two changes ship in one branch / one PR as two
separate commit chunks (the user mandate is "one PR, not 1000"; minimal-safe-diff
is preserved by keeping the concerns in distinct commits):

1. **Anti-loop guard** in `AgentTurnHandler` — a `write_files` edit batch the
   model has already proposed verbatim this turn no longer burns iterations.
2. **Dead-code retire** — `tracking/audit-log.ts` + its test, the ADR-038-named
   follow-up (a confirmed-dead duplicate superseded by `permissions/audit.ts`).

Pure core, **no protocol/codegen change** (`Protocol.kt` untouched, codegen
idempotent at 50 DTOs), CI-verified (lint + build + typecheck clean; core
1035 pass / 1 skip; `jetbrains:check` BUILD SUCCESSFUL). **No checkbox flips** —
T-702c is already `[x]` for the engine; its end-to-end exit gate stays `[~]`
(IDE bulk-diff card + AgentDriver).

## Context

The Explore seam-hunt ranked `EditLoop` (`agent/edit-loop.ts`, T-702c) as the #1
remaining pure-core seam and claimed "no behaviour change". **That claim is
wrong, verified against the code.** `EditLoop` is a per-file-sub-task convergence
state machine. Wiring it live needs three collaborators that do not exist:

1. a `ModelEditStep.next()` adapter over `LlmBackend` that prompts the model PER
   FILE sub-task and extracts `FileEdit[]` (today the model emits a `write_files`
   tool call with `edits: FileEdit[]` directly — there is no per-sub-task driver);
2. a SUB-TASK DECOMPOSER that splits a turn into `EditSubTask[]`;
3. `onEscalate` — a "swap to a stronger model" hook. There is **no model-tier
   concept anywhere**; `resolveModel(providerId)` returns exactly one model string.
   Escalation targets are a product/config decision (IDE/settings-shaped).

The roadmap agrees: T-702c is already `[x]` for the engine, its Phase-7 exit gate
binds `AgentDriver` + `EditLoop` + a bulk-diff card (all IDE-halt-gated), and
line 94 even allows T-702c to slip "if the loop proves stable without it".
**Wiring `EditLoop` standalone into the iteration-based `AgentTurnHandler` would
be artificial** — the exact anti-pattern this project rejects.

But the live `AgentTurnHandler` loop has a real, verified gap: it streams the
model → executes tool calls → feeds results back → loops until the model stops OR
`maxIterations`, with **no anti-loop guard**. If the model re-emits a
byte-identical `write_files` batch every iteration (a stuck loop — ignoring
locate-failure feedback, re-proposing an already-applied edit, or re-proposing a
denied edit), the turn burns iterations to `maxIterations`, paying for every
wasted request. `EditLoop` solves exactly this with its `visitedSet` of
`hashEdits()` batch hashes — but only inside the unwired per-file loop.

This slice wires the *primitive*, not the *machine*: `hashEdits` (exported,
unit-tested, zero production callers) becomes the basis of a guard inside the
existing iteration architecture — substantive (a real cost lever), IDE-free, and
behaviour-bounding rather than paradigm-changing.

## Decision

### 1. Anti-loop guard (AI council Q0=D, Q1=b, Q2, Q4, Q5)

Per turn, keep a turn-local `Map<batchHash, count>`. After each streamed
iteration, before executing the tool calls, hash every `write_files` call's edit
batch via `hashEdits` (other tools → `null`, skipped — **Q2 write_files-only**:
repeated reads/greps are legitimate planning, not stagnation):

- **1st occurrence** (`count === 1`): run normally.
- **1st repeat** (`count === 2`): short-circuit to a no-progress `tool_result`
  (`is_error: true`) telling the model it already proposed this exact batch — and
  skip the redundant apply. The model gets **one** chance to change course
  (**Q1=b warn-once**); this also cushions the denied/unresolved re-propose case
  (council Q5) — a single nudge, never a hard block on the first retry.
- **2nd repeat** (`count >= STUCK_REPEAT_LIMIT = 3`): stop the turn, reusing the
  existing `max_iterations` stop reason (**Q4** — no new protocol/codegen surface;
  the iteration budget was not converging, so the reason is accurate enough for
  this slice; a dedicated `no_progress` variant is a future wire change).

**Traps guarded (council Q5):**

- **Never fires on first occurrence** — only a hash already seen this turn counts.
- **Same-turn-only** — the map is a per-turn local, reset every turn; a later turn
  that legitimately needs the same edit is unaffected.
- **File path is in the hash** — `hashEdits` keys on `file` + `originalCode` +
  `newCode` + flags, so identical boilerplate sent to two *different* files is NOT
  a false repeat (verified; gemini's trap). A regression test asserts this.
- **Empty-edits batches are not hashed** — `WriteFilesArgsSchema.safeParse` fails
  on `{edits: []}` (`.min(1)`), so `writeFilesBatchHash` returns `null` and the
  guard skips it (this keeps the existing "caps a runaway loop at maxIterations"
  test, which spins on `{"edits":[]}`, unchanged).

### 2. Defer history compaction (Q3)

`EditLoop.truncateAndReinject` (SweepAI `modify.py:208`) stays unwired. Both
reviewers agreed: it assumes a per-file sub-task anchor the whole-turn,
multi-tool iteration loop does not track; wiring it now could silently drop
context the model still needs across multiple files in one turn. It is not
behaviour-preserving here. Deferred to the future `AgentDriver` integration.

### 3. Retire the dead `tracking/audit-log.ts` (T-413)

Confirmed dead: imported only by its own test (the two other grep hits are
comments). Superseded by the live `permissions/audit.ts` `AuditLog`. ADR-038
explicitly named "retire the dead tracking/audit-log.ts (+its test)" as a
follow-up. Removed in its own commit chunk. Two competing `AuditLog` classes were
an active source of confusion.

## Consequences

**Positive.** A stuck model no longer burns the iteration budget on identical
re-proposals — a direct cost saving on the highest-cost tool. The guard reuses
the exact hash the future `EditLoop` will use, so behaviour stays consistent when
the per-file loop lands. The dead duplicate is gone; only one `AuditLog` remains.

**Negative / limits.** Reusing `max_iterations` slightly under-describes a
stuck-stop (a `no_progress` reason would be more observable — deferred to avoid
wire surface). The guard only catches BYTE-identical batches; a model that makes
trivial cosmetic changes between attempts (a different comment) evades it — that
is `EditLoop`'s near-miss/`attemptCount` job, out of scope here. History
compaction is deferred, so a long multi-file turn can still grow its context.

**No checkbox flip.** T-702c engine stays `[x]`; the Phase-7 end-to-end exit gate
(bulk-diff card + AgentDriver) stays `[~]`. Dashboard counts unchanged.

## Alternatives considered

- **A — retire the dead audit-log only.** Clean but small; does not advance a
  feature. Folded in as chunk 2 instead (council Q0=D).
- **B — guard only, no cleanup.** Codex's pick (don't mix a runtime change with an
  unrelated deletion). Resolved to D because the user mandate is one PR and both
  are IDE-free pure-core; separate commits keep them traceable.
- **C — full EditLoop wiring.** Rejected: L-sized, invents escalation infra, real
  consumer is the IDE-gated AgentDriver → artificial wiring.
- **Hard-stop on the first repeat (Q1=a).** Rejected: converts recoverable model
  behaviour into premature failure. Warn-once preserves a self-correction chance.
- **Hash all tool batches (Q2 alt).** Rejected: false positives on legitimately
  repeated reads/searches.

## References

- `packages/core/src/agent/turn-handler.ts` — the guard (turn-local
  `editBatchSeen`, `writeFilesBatchHash`, `REPEATED_EDIT_FEEDBACK` /
  `STUCK_EDIT_FEEDBACK`, `STUCK_REPEAT_LIMIT`).
- `packages/core/src/agent/edit-loop.ts` — `hashEdits` (the reused primitive).
- `packages/core/src/agent/turn-handler.test.ts` — 3 new guard tests
  (second-repeat-stop, distinct-file no-false-positive, warn-once-recovery).
- ADR-038 — named the dead `tracking/audit-log.ts` retire as a follow-up.
- ADR-014 / ADR-023 — the agent-turn loop + the EditLoop/permission engine.
- AI Council 2026-06-02 (codex-cli 0.134.0 + gemini-cli 0.41.2) — fork round.

## Sign-off

On flip to **Accepted**: update `agents/analysis/PLAN.md` Phase-7 notes to record
that the iteration loop now bounds re-proposed edits, and carry the
`no_progress`-stop-reason and `truncateAndReinject` items into the future
AgentDriver/EditLoop integration slice.
