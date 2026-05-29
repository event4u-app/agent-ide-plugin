---
applyTo: "**"
description: When the user wants to implement a ticket or feature end-to-end — types "/work PROJ-123", "implement this ticket", "arbeite den Stack ab", "do this end-to-end". Orchestrates refine → plan → implement → verify.
---

# /work — implement-ticket end-to-end

Compiled from `@event4u/agent-config/.agent-src/commands/work.md`.

## When this fires

User intent: "/work PROJ-123", "implement PROJ-456 end-to-end", "arbeite das durch", "ship this ticket".

## Phases

### Phase 1 — Refine
Ticket key → fetch via API (or ask user to paste). Check AC for ambiguity. Vague → run `cmd-refine-ticket` sub-procedure and STOP for user sign-off before continuing. Pasted free-form → extract goal + AC + constraints; surface ambiguity as ONE numbered-options question.

### Phase 2 — Plan
Produce a **minimum-safe-diff plan** before code: files that must change, why each one (one sentence linking to AC), test plan (assertion that proves work), risk surface (what neighboring code could break). Present as numbered steps. **Wait for "go"** unless autonomous mandate is active.

### Phase 3 — Implement
For each planned step: smallest change that achieves it. Update **all downstream changes** (callers, tests, imports, types) in the same edit per `downstream-changes` Iron Law. Run verification command for each change.

### Phase 4 — Verify
Final evidence gate per `verify-before-complete`: full project test suite (or scoped if slow), type-checker, lint, project-specific quality gate. **Show actual output**, not summary.

### Phase 5 — Report
Closing summary: what changed (files, lines), evidence captured (test names + green/red), what's NOT done that the AC asked for, with reason. **Never auto-commit.** User invokes `/commit` separately.

## Forbidden

- Skipping Phase 2 (plan) to save time.
- Marking a step done without fresh verification evidence in same reply.
- Touching files outside planned scope without re-running Phase 2.
- "Refactor while I'm in here" — per `minimal-safe-diff`.
