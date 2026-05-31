---
complexity: heavy
---

# Roadmap: Product Readiness — Trustworthy, Installable, Daily-Driver

> **Goal.** Turn the working vertical slice into a product an event4u dev
> installs and trusts daily: every agent action goes through a clear
> approval/diff surface, cost and index state are always visible, agent intent
> is explicit (Ask / Edit / Plan / Review / Commit / Explain), context scope is
> user-controllable per turn, the plugin ships as a real installable artifact
> with an onboarding wizard, and the git loop (commit message, PR description,
> change summary) is built in.
>
> **Why it's a separate roadmap.** This is breadth on top of a proven spine.
> It must **not** start before `road-to-vertical-slice.md` clears — every
> feature here assumes the chat → send → stream → stop → cost path works in
> both IDEs. The engine substrate for each feature already exists
> (`permissions/`, `cost/`, `context/`, `agent/loop.ts`, `review/`); the work
> is surfacing it. Almost all of it is **IDE-runtime-/human-gated** (webviews,
> packaging, extension-host smoke tests) — executed by a human at an IDE.
>
> **Source.** Authored 2026-05-31 from the user's 12-point feedback. Item map:
> P1 = #2/#3/#5 · P2 = #5/#6/#7/#8/#9 · P3 = #4/#11/#10 · P4 = #12.

## Context

- **Gates.** `minimal-safe-diff`, `scope-control` (reuse the shipped engine
  modules — no new permission/cost/index framework), `security-sensitive-stop`
  (the permission + git surfaces gate real actions — threat-model before
  wiring), `verify-before-complete` (IDE steps need a captured manual smoke run).
- **Hard dependency.** `road-to-vertical-slice.md` complete (the working
  request path both features build on).
- **Engine substrate (already shipped, to be surfaced).**
  - Permission model — `packages/core/src/permissions/` + ADR-004 (threat model, hard-floor deny-list, audit trail).
  - Cost — `packages/core/src/cost/` (`estimate.ts`, `reconcile.ts`, `shadow.ts`).
  - Index / context — `packages/core/src/context/` (walker, BM25, embeddings, per-root status from `road-to-multi-project`).
  - Agent loop + directive sets — `packages/core/src/agent/loop.ts` (`refine → plan → implement → verify`).
  - Review / git — `packages/core/src/review/` + the `code-review` engine work.
- **Shared-UI decision.** Both clients render **per-client** (VS Code webview
  `chat-app.ts` / JetBrains Swing + JCEF), not through a shared Preact bundle.
  The `packages/shared/ui/` assumption in `road-to-v1-0` Phases 7/12/13 +
  `road-to-multi-project` Phase C is **superseded** — revisit only if
  cross-client divergence becomes costly.
- **`road-to-v1-0` `[~]` discharge map.** Surfacing a task here flips the
  matching v1-0 IDE-runtime gate: T-PRD03 → T-904/906/907/908 (terminal);
  T-PRD05 → T-704 (inline scope editor); T-PRD06 → T-707 (cost dashboard);
  T-PRD07 → T-1304 (index statusbar); T-PRD08 → directive-set modes;
  T-PRD09 → T-1308 (context sidebar) + `ContextScope`. **Still deferred**
  (not in scope here): session browser UI (T-1201/1203/1205), slash/command
  picker (T-1103), guidelines editor (T-1307), conversation sidebar/fork/rewind
  (T-1301-1303), pricing verify-on-load.
- **Non-goals.** Inline-autocomplete, repo-aware refactor skills, web tool,
  team/cloud backend — these are v1.5+ candidates, each its own roadmap.

---

## Phase 1 — Surface wiring: tool-approval + diff review (both IDEs)

> **Goal.** Agent tool-calls render as action cards the user approves; multi-file edits show a reviewable diff before they apply.

- [ ] **T-PRD01 — tool-call action cards.** When the agent loop emits a tool-call (run-shell, write-files, …), both clients render an action card with the call summary and an approve/deny control wired through `permissions/`.
- [ ] **T-PRD02 — multi-file diff review.** `tools/write-files.ts` (atomic multi-file) output renders as a per-file diff the user accepts/rejects before write; rejection rolls back atomically.
- [ ] **T-PRD03 — terminal card render.** Wire the shipped `terminal/` core (ring-buffer replay, waiting-for-input, first-write-wins) to xterm.js in both surfaces — completes `road-to-v1-0` T-904/906/907/908.
- [ ] **T-PRD04 — streamed event union → client renderers.** The `TerminalEvent` / chat event unions get the Kotlin sealed-class + TS render switch (deferred from ADR-009).

### Exit gate — Phase 1

- [ ] A multi-step agent turn that runs a command and edits 2+ files renders: approval card → live terminal card → diff review → applied — in both IDEs. Captured in `docs/MANUAL_VERIFICATION.md`.

**Baseline (P50):** 2.5 weeks.

---

## Phase 2 — Trust & Control UX

> **Goal.** The user always sees what it costs, what is indexed, what mode the agent is in, and what context a turn uses — and can change each.

- [ ] **T-PRD05 — permission cards, full (#5).** Diff preview, risk-level badge (from the hard-floor classifier), `allow once / allow always / deny`, and a link to the audit-trail entry. Always-rules persist per workspace.
- [ ] **T-PRD06 — cost UX, full (#6).** Pre-send estimate (`±` range) before the prompt fires; live counter during; reconciled final after (`cost/reconcile.ts`); a configurable **daily budget** with a soft warning on approach.
- [ ] **T-PRD07 — index statusbar (#7).** Statusbar widget: `Indexing 428 / 1200 files…` / `Index ready · N files · last update …`; per-root error surfacing; a Reindex action. Consumes the `rootStatus` protocol method.
- [ ] **T-PRD08 — agent modes (#8).** Explicit mode selector — `Ask` / `Edit` / `Plan` / `Review` / `Commit` / `Explain selection` — each mapping to a directive set on `agent/loop.ts`; the mode is visible in the composer.
- [ ] **T-PRD09 — per-turn context chips (#9).** Composer chips: `current root` / `all roots` / `no codebase` / `specific files`, emitting the `ContextScope` discriminated union the protocol already carries.
- [~] **T-PRD17 — provider/model selector, incl. OpenAI.** <!-- late addition 2026-05-31: feedback — the OpenAI backend exists in core (`llm/`) but the VS Code config only offers Anthropic. core half DONE 2026-05-31 (PR for feat/product-readiness-provider-core): `ProviderRegistry` (resolveBackend/resolveModel over all 5 backends, eager build + isolated config errors, env default `EVENT4U_DEFAULT_PROVIDER`, throw `provider_not_configured`, env model override) + `buildCoreDispatcher` wired into `main.ts` so the real sidecar answers `chatSend` instead of `chat_not_configured`. ADR-011. Client provider/model selector UI (settings, both IDEs) stays IDE-runtime → `[~]`. --> Client settings expose a provider + model selector across Anthropic / OpenAI / CLI backends; the choice flows into the `chatSend` `providerId` the vertical slice already carries. Both IDEs.

### Exit gate — Phase 2

- [ ] A user can: see a pre-send estimate, watch live cost, hit a daily-budget warning; read the index status + reindex; switch agent mode; scope a turn to specific files — in both IDEs.

**Baseline (P50):** 3 weeks.

---

## Phase 3 — Distribution & onboarding

> **Goal.** Someone can install the plugin from an artifact and be productive without reading the source.

- [ ] **T-PRD10 — VSIX packaging (#4).** Build a real `.vsix` with the Node core bundled (no dev-path assumption); the sidecar resolves from the bundled location.
- [ ] **T-PRD11 — JetBrains plugin ZIP (#4).** `buildPlugin` ZIP with the bundled core; verified to load in a clean sandbox without the repo checkout.
- [ ] **T-PRD12 — onboarding wizard (#11).** First-run flow: detect API key / Claude CLI, pick a model, set a budget, run a test ping that proves the round-trip. Reuses the existing `agent-config` onboarding contract where it overlaps.
- [ ] **T-PRD13 — IDE extension-host smoke tests (#10).** Automated smoke tests against a real VS Code Extension Host and a JetBrains test IDE — open chat, send a canned prompt against a fake provider, assert a streamed answer. Wired into CI where the runner supports it; reference-only where it cannot.

### Exit gate — Phase 3

- [ ] A clean machine installs the VSIX / JetBrains ZIP, runs the wizard, sends a test ping, and gets a streamed answer — no repo checkout. Smoke tests run (or are documented reference-only per platform).

**Baseline (P50):** 2.5 weeks.

---

## Phase 4 — Git workflow integration

> **Goal.** The agent helps close the loop: commit message, PR description, review mode, change summary.

- [ ] **T-PRD14 — commit-message suggestion (#12).** From the staged/working diff, propose a Conventional-Commit message; the user edits/accepts. Never commits autonomously (respects `commit-policy`).
- [ ] **T-PRD15 — PR description draft (#12).** Generate a PR body from the branch diff + commit log; no attribution footer, no decorative emoji (house rules).
- [ ] **T-PRD16 — review mode + change summary (#12).** The `Review` agent mode runs the `review/` engine over the current diff and renders a change summary + findings as cards.

### Exit gate — Phase 4

- [ ] From a working branch: get a commit-message suggestion, a PR-description draft, and a review summary — all surfaced as editable cards, none executing a git action without explicit user confirmation.

**Baseline (P50):** 2 weeks.

---

## Acceptance criteria — product readiness

- [ ] Every agent action (tool-call, multi-file edit, terminal, git) is surfaced through an approval/diff/summary card before it takes effect.
- [ ] Cost (pre-send estimate, live, final, daily budget) and index status are always visible.
- [ ] Agent mode and per-turn context scope are explicit and user-controllable.
- [ ] The plugin installs from a VSIX / JetBrains ZIP with an onboarding wizard, no repo checkout.
- [ ] Extension-host smoke tests cover the core path (or are documented reference-only per platform).
- [ ] The git loop (commit / PR / review) is built in and never acts without confirmation.
