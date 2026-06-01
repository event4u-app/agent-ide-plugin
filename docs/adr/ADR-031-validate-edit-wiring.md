---
adr: 031
title: Post-Write Delta-Gate — Wiring validateEdit (T-702b) Into the Live write_files Tool (Validate After Atomic Apply, Advisory Feedback Never Flips ok, Scan Generated newCode Only, Optional Diagnostics Provider, Per-File Syntax, Injected LanguageRegistry)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-01 validateEdit-wiring round — UNANIMOUS A1/B1/C1/D1/E1/F1; G confirmed; both flagged the same traps — validate only a successful atomic apply, new-file baseline = empty, per-file diagnostic attribution, append-mode leftover false-positive solved by C1, line/column-free diagnostic keys, validation failure must not roll back, prepare→execute external-modification noise on the diff layer)
related: makes road-to-v1-0 T-702b LIVE (the delta-gate shipped 2026-05-30 with ZERO callers); builds on ADR-023 (agent-turn tool loop), ADR-027 (code-suggestion annotations on the same writeFilesEntry), ADR-030 (run_shell — sibling tool on the same registry); the IDE render of the findings remains the last mile
date: 2026-06-01
---

# ADR-031 — Post-Write Delta-Gate (validateEdit Wiring)

## Status

**Proposed** — awaits sign-off. The SweepAI delta-gate `validateEdit` (T-702b)
shipped on 2026-05-30 as a pure function with **zero production callers**: the
agent could write files but nothing ever checked the result. The
`AgentTurnHandler` (ADR-023) → `writeFilesEntry` → `WriteFilesTool` path applied
edits atomically and fed `{ applied, unresolved }` back to the model — never a
leftover-marker, syntax-error, or newly-introduced-diagnostic signal. This slice
wires the gate into that live path. Pure core, CI-verified; the IDE render of the
findings (inline diagnostics, a validation badge) stays IDE-gated, so **no
checkbox flips** — T-702b is already `[x]` for the shipped engine.

## Context

`validateEdit(input, registry?)` runs three layers, cheapest first:
`findLeftoverMarkers(newCode)` (pure regex for truncated generations), `checkSyntax`
(tree-sitter `.hasError()`, the `LanguageRegistry` optional and fail-soft), and
`diffDiagnostics(baseline, after)` (only the surplus of `after` over `baseline`,
keyed line/column-free so a line shift does not resurface pre-existing
diagnostics). It returns `{ ok, newDiagnostics, syntax?, leftover? }`.

The live write path exposes a `prepare`/`execute` split: `prepare` parses args and
builds the atomic `WriteFilesPlan` (per file `oldContent`/`newContent`/`diff`; the
model-generated `newCode` blocks live in the args, addressable per resolved edit);
`execute` calls `tool.apply(plan)` and returns a `ToolExecution { ok, output,
outputPreview, changedFiles }` whose `output` the loop feeds back as the
`tool_result`. The richer diagnostics (tsc/eslint) cannot run in core — the
no-native-deps law forbids shelling out — so they must come from an IDE-supplied
provider over the protocol later.

## Decision

Additive, pure-core. `buildDefaultToolRegistry` gains optional `languageRegistry?`
and `diagnostics?`; `writeFilesEntry` runs `validateEdit` per applied file after a
successful apply and folds a per-file `validation` array into the tool output;
`sidecar.ts` wires a fail-soft `new LanguageRegistry()`. **No protocol or codegen
change** (`Protocol.kt` untouched). No IDE render.

1. **A1 — validate AFTER `apply` succeeds.** The gate runs on the committed
   on-disk state inside `execute()`, not on the proposed plan at `prepare`. The
   diff-layer baseline IS captured at `prepare` (pre-write) so the before/after
   bracket is correct (fork G). A failed/rolled-back apply skips validation
   entirely — there is nothing on disk to judge.

2. **B1 — a validation finding never flips `ToolExecution.ok`.** The atomic write
   succeeded, so `ok` stays `true`; the findings ride `output.validation` as
   advisory feedback the model self-corrects from next iteration. Flipping `ok`
   would conflate "the write failed" with "the write introduced an issue" and push
   the model to retry the same call instead of reasoning over the payload. The
   write is **never rolled back** by a finding.

3. **C1 — the leftover scan reads only the model-generated `newCode`.** Per file
   we concatenate the resolved edits' `newCode` blocks and scan those — not the
   whole `newContent`. A pre-existing `// TODO: implement` in the untouched part
   of the file is not the model's fault and must not trip the gate; this also
   makes append-mode safe (only the appended block is scanned).

4. **D1 — the diagnostics provider is optional and IDE-supplied.** Absent (the
   pure sidecar) → the diff layer is skipped: baseline/after are empty and
   `diffDiagnostics` reports nothing. The IDE wires a real `DiagnosticProvider`
   over the protocol later. No tsc/eslint shelling in core.

5. **E1 — syntax-check every edited file's `newContent`.** A search-replace can
   break a brace or a statement just as a new file can; restricting the parse to
   new files would under-protect the highest-volume edit mode. The
   `LanguageRegistry` is fail-soft (unknown grammar → layer skipped).

6. **F1 — inject the `LanguageRegistry` through `buildDefaultToolRegistry`.** A
   fresh `new LanguageRegistry()` (lazy WASM init, cached, fail-soft) is passed
   from `sidecar.ts` rather than leaking the private `WorkspaceCoordinator`/
   `ContextEngine` registry. Unit tests omit it → the syntax layer is skipped, the
   leftover layer still runs.

### Guarded traps (council)

Validation runs only on a successful atomic apply (a rolled-back plan is never
judged); the baseline of a brand-new file is empty so every diagnostic in it is
"new"; per-file diagnostics are filtered by `Diagnostic.file` so the model is told
*where* to fix; diagnostic keys stay line/column-free; the `outputPreview` carries
a compact `validation issues — <file>: …` summary so the finding is visible even
when the structured `output.validation` is not rendered. The
prepare→execute external-modification race only adds noise to the diff layer,
which is inert in the pure sidecar today.

## Consequences

- The agent now sees its own truncated generations and syntax breaks immediately
  and can issue a surgical follow-up edit — the highest-leverage SweepAI
  validation pattern, finally live.
- The diff layer stays dormant until the IDE supplies diagnostics; the leftover +
  syntax layers are active in the pure sidecar today.
- `write_files` is marginally slower (one tree-sitter parse per edited file on
  first use of a grammar) — fail-soft and cached, negligible against an LLM turn.
- 6 new core tests (leftover surfaced no-registry, syntax surfaced with a real
  grammar, clean edit omits the key, C1 no-false-positive on pre-existing markers,
  injected-provider delta surfaced, same-set-before-and-after reports nothing);
  core 988 pass / 1 skip.

## Alternatives

- **A2 — validate at prepare on the proposed content.** Rejected: cannot capture
  an "after" diagnostic set (nothing is written) and judges intent, not result.
- **B2 — flip `ok` on a finding.** Rejected (see B1): misreports a successful
  write as a tool failure.
- **D2 — shell tsc/eslint in core now.** Rejected: violates the no-native /
  no-shell-out law; the IDE owns real diagnostics.
- **F2 — reach into the ContextEngine's private registry.** Rejected: leaks an
  architecture boundary and hurts testability.

## References

- `packages/core/src/tools/validate-edit.ts` — the delta-gate (T-702b).
- `packages/core/src/agent/tool-registry.ts` — `writeFilesEntry` wiring.
- `packages/core/src/sidecar.ts` — `LanguageRegistry` composition.
- ADR-023 (agent-turn tool loop), ADR-027 (code-suggestions on the same entry),
  ADR-030 (run_shell sibling tool), road-to-v1-0 Phase 7 T-702b.
