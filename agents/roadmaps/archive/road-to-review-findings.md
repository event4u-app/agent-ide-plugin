---
complexity: standard
---

# Roadmap: Code-review findings remediation (2026-05-30 assessment)

> Close the four concrete defects surfaced by the 2026-05-30 external
> code-review assessment — missing LICENSE, a README usability claim that
> overstates readiness, build-coupled typecheck, and the regex-only
> permission denylist — without re-planning the UI/runtime work already
> owned by `road-to-mvp-ui-finish.md` and `road-to-v1-0.md`.

## Goal

From a clean checkout, the repo is **legally usable and honestly
described**: a real `LICENSE` file backs the README's MIT claim, the
README states plainly that there is no runnable IDE integration yet,
`pnpm typecheck` succeeds without a prior `task build`, and the
permission gate's defense-in-depth posture is documented (and, if
agreed, hardened) so no reader mistakes the regex denylist for the
security boundary.

## Prerequisites

- [x] Re-read the assessment findings (this roadmap's `## Context`) and
  confirm none have been overtaken by a merge since 2026-05-30.
- [x] Confirm scope: this roadmap does **not** touch the deferred
  UI/IDE-runtime tasks — those stay owned by `road-to-mvp-ui-finish.md`
  (T-103/T-105/T-202..T-207/T-409..T-414) and `road-to-v1-0.md`.

## Context

A full external review on 2026-05-30 walked the repo, read the
security-critical paths, and ran build + typecheck + lint + format +
the 424-test suite green. Verdict: **strong as a code artefact (8/10),
not yet a usable product** because the UI/IDE-runtime half is
deliberately deferred. That product gap is already tracked — this
roadmap exists only for the four findings that are **not** already on
a roadmap and are cheap, concrete defects:

1. **Missing LICENSE file.** `README.md` line 74 promises "MIT — see
   `LICENSE`", but no `LICENSE` file exists and `package.json` carries
   no `license` field. A dangling license reference on a hosted repo
   (`github.com/event4u-app/agent-ide-plugin`) is a real legal defect —
   nobody can rely on the code until it is fixed.
2. **README overstates readiness.** The status block is honest about
   "MVP backend complete", but a casual reader can still assume the
   plugin is installable today. There is no runnable end-to-end IDE
   integration yet; the README should say so in one unambiguous line.
3. **Typecheck is build-coupled.** `tsconfig.base.json` sets
   `composite: true`; `packages/core` references `protocol` + `shared`.
   A bare `pnpm typecheck` from a clean checkout fails because the
   referenced packages' `.d.ts` files do not exist until `task build`
   runs. CI orders it correctly, but a new contributor running
   `pnpm typecheck` first hits a confusing failure.
4. **Permission gate is a regex denylist.** `T-304` (ADR-004 hard-floor
   patterns in `packages/core/src/permissions/gate.ts`) is clean and
   honest, but a denylist over stringified args is bypassable in
   principle (obfuscation, alternate spellings, unlisted destructive
   commands). The real boundary is the `requires_approval` default plus
   the human at the button — that intent must be documented so no reader
   treats the regex list as the security wall.

**Gates.** `minimal-safe-diff`, `scope-control`, `verify-before-complete`.
Findings 1–3 are defects (fix directly). Finding 4 is defense-in-depth —
Phase 4 documents the posture unconditionally and treats any code
hardening as discretionary, decided at the phase boundary.

## Phase 1 — LICENSE file + license metadata

Back the README's MIT promise with a real file and consistent metadata.

- [x] Add a top-level `LICENSE` file with the standard MIT text, correct
  copyright holder (event4u) and year.
- [x] Add `"license": "MIT"` to the root `package.json`, and to each
  workspace `package.json` under `packages/*` and `clients/vscode` that
  is missing it.
- [x] Confirm the README reference (`README.md` line 74) resolves to the
  new file; fix the link text if the path differs.
- [x] Confirm the VS Code extension manifest (`clients/vscode/package.json`)
  declares `license` so the packaged `.vsix` is correctly labelled.

**Exit criteria** — `LICENSE` exists at repo root; `grep -L license`
across all `package.json` files returns none that should carry it; the
README no longer dangles.

**Rollback** — delete `LICENSE` and revert the `license` field edits;
the repo returns to its prior (defective) state with no behavioural change.

## Phase 2 — README readiness honesty

Make the "not end-to-end usable yet" reality impossible to miss.

- [x] Add one unambiguous line to the README status block stating that
  there is **no installable IDE integration yet** — the backend sidecar
  is complete and tested, the chat UI / settings / statusbar are pending
  (point at `road-to-mvp-ui-finish.md`).
- [x] Verify the "What MVP ships vs defers" section still matches the
  current shipped/deferred task split; correct any drift.
- [x] Keep the change additive — do not remove the existing accurate
  "MVP backend complete" framing.

**Exit criteria** — a first-time reader of the README can state, from the
status block alone, that the plugin cannot be installed and used today.

**Rollback** — revert the README edit; no other artefact depends on it.

## Phase 3 — Decouple typecheck from build

A clean-checkout `pnpm typecheck` must pass without a prior build.

- [x] Diagnose the current per-package `typecheck` script (per-package
  `tsc --noEmit` cannot resolve referenced packages' `.d.ts` before
  build). Decide the fix: a project-references-aware root typecheck
  (`tsc -b`, which honors `composite` references and emits the needed
  declarations) is the candidate — confirm it on a clean checkout.
  <!-- `tsc -b --noEmit` rejected (TS6310: composite refs may not disable
  emit). vscode client is non-composite, so it cannot join a `-b` solution.
  Chosen: `tsc -b packages/core && tsc -p clients/vscode/tsconfig.json
  --noEmit`. AI council (codex + gemini, 2026-05-30) converged. -->
- [x] Apply the chosen wiring (root `typecheck` script and/or `Taskfile`
  `typecheck` task) so it works from a clean `pnpm install` with no
  prior `task build`. <!-- root package.json `typecheck` script; Taskfile
  `typecheck` task delegates to it unchanged. -->
- [x] Update `README.md` Quick-start and `docs/architecture.md` /
  `docs/MANUAL_VERIFICATION.md` if they document the old build-first
  ordering. <!-- those three list no build-first *requirement* for
  typecheck (only README:30 names it, as a normal dev sequence). The one
  place documenting the old rationale was the ci.yml comment — updated. -->
- [x] Re-run `pnpm typecheck` from a freshly cleaned tree (remove `dist/`
  + build outputs first) and confirm exit 0. <!-- verified: dist +
  *.tsbuildinfo removed → `pnpm run typecheck` exit 0. -->

**Exit criteria** — `git clean`-equivalent checkout → `pnpm install` →
`pnpm typecheck` exits 0 with no intervening build step; CI still green.

**Rollback** — revert the script/task changes; CI is unaffected because
it already builds before typecheck.

## Phase 4 — Permission-gate posture (document; harden if agreed)

The regex denylist is acceptable for MVP — make sure nobody mistakes it
for the boundary, and decide whether to add real defense-in-depth.

- [x] Document in `docs/adr/ADR-004-permission-model.md` (or a short note
  it links) that the hard-floor regex patterns are a **convenience tripwire,
  not the security boundary** — the boundary is the `requires_approval`
  default plus human confirmation. State the known bypass classes
  (obfuscation, alternate spellings, unlisted commands) explicitly.
  <!-- ADR-004 § "What the deny-list is — and is not (boundary vs. tripwire)". -->
- [x] Add or confirm a code comment at the denylist in
  `packages/core/src/permissions/gate.ts` pointing to that ADR section so
  a future contributor does not "trust the list".
- [x] **Discretionary hardening (decide at phase entry).** If agreed,
  pick at most one concrete, testable improvement — e.g. normalize args
  before matching (collapse whitespace / quotes / `$IFS` tricks), or
  default-deny any tool call whose resolved command is not on a known
  allowlist of safe binaries. Scope it as its own checkbox with a unit
  test before implementing; otherwise mark this step `[-]` with a one-line
  rationale and leave the gate as-is.
  <!-- AI council split (codex: normalize args / gemini: binary allowlist).
  Chose option (a) arg-normalization — minimal, additive (raw blob still
  matched, no regression), and it does not break the agent's legitimate
  run_command surface the way a binary allowlist would. `normalizeArgsBlob`
  in gate.ts + 5 new unit tests; existing gate tests stay green (18 pass). -->
  - [x] Implement `normalizeArgsBlob` (strip quotes, expand `$IFS`,
    collapse whitespace) matched alongside the raw blob, with unit tests
    for the $IFS / quote-split bypass classes.

**Exit criteria** — ADR-004 (or its linked note) states the boundary vs
tripwire distinction and names the bypass classes; the gate code points
to it. Any hardening that landed ships with a unit test and does not
regress the existing 12 gate tests.

**Rollback** — documentation-only steps revert cleanly; any hardening
commit reverts independently because it is scoped to its own checkbox.

## Acceptance criteria

- [x] `LICENSE` exists, README's MIT reference resolves, and
  `package.json` license fields are consistent (Phase 1).
- [x] README states plainly there is no installable IDE integration yet
  (Phase 2).
- [x] `pnpm typecheck` passes from a clean checkout with no prior build;
  CI stays green (Phase 3).
- [x] ADR-004 documents the permission-gate boundary-vs-tripwire posture;
  any hardening is test-backed (Phase 4).
- [x] No deferred UI/IDE-runtime task was touched — that work stays on
  `road-to-mvp-ui-finish.md` / `road-to-v1-0.md`.

## Notes

- **No version / tag / commit / merge steps.** Roadmap plans work;
  delivery is the user's call (`commit-policy`, `scope-control`).
- **Hard-floor reminder.** No autonomous commits to main, no
  force-pushes, no deploy.
- **Cross-reference.** Siblings: `road-to-mvp-ui-finish.md`,
  `road-to-v1-0.md` (own the product/runtime gap this roadmap deliberately
  excludes). Source: 2026-05-30 external code-review assessment.
