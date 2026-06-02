---
complexity: heavy
---

# Roadmap: MVP UI finish — close every `[~]` task from road-to-mvp.md

> **Why this roadmap exists.** PR #4 + PR #6 landed every road-to-mvp.md task
> that doesn't need a running IDE. The `[~]` deferrals on those PRs would
> otherwise sit in archive purgatory once `road-to-mvp.md` closes. This
> roadmap is the explicit successor that picks them up so nothing
> disappears.
>
> **Time-box:** 3–5 calendar weeks. Sprint 4 + Sprint 5 (Buffer) overlap.
> Reviewer-driven activities (T-414, B-1) gate the end.

## Context

- **Source of truth for what's `[~]`:** `agents/roadmaps/road-to-mvp.md` and
  `agents/evidence/analysis/mvp-scope-decision-2026-05-29.md`. Re-derive the
  list from the current state of those files; don't trust the table below
  if the roadmap has moved on.
- **UI tech decision — Swing for MVP** (council `agents/runtime/council/responses/jetbrains-ui-2026-05-29.json`,
  2026-05-29, anthropic/claude-sonnet-4-5 + openai/gpt-4o, converged).
  Reasoning: Compose-in-IntelliJ has no production references as of late
  2024, jewel is pre-1.0 (experimental), `StatusBarWidget` returns
  `JComponent` (forces ComposePanel interop), and the sidecar architecture
  makes UI disposable — no migration debt. Compose migration deferred to
  v1.0 once jewel 1.0 lands.
- **Gates.** Same set as `road-to-mvp.md`: `minimal-safe-diff`,
  `scope-control`, `verify-before-complete`. Plus a new rule: every UI
  task ships **code + unit tests for testable component logic** even when
  the actual render verification needs a human. CI green ≠ runtime green;
  the human walks `docs/MANUAL_VERIFICATION.md`.

## Carry-overs from road-to-mvp.md

The original task ids stay — every entry is a continuation, not a new task.

### Phase 1 carry-over

- [ ] **T-103 — JetBrains plugin install + tool-window render smoke** —
  needs a human-driven PhpStorm 2024.2+. Run the checklist at
  `docs/MANUAL_VERIFICATION.md § T-103`, append a verification-log entry,
  then flip to `[x]`.
- [ ] **T-105 — JetBrains side ping after IDE restart + zombie check** —
  same human-driven path; `docs/MANUAL_VERIFICATION.md § T-105`.

### Phase 2 carry-over

- [ ] **T-202 — JetBrains chat UI (Swing).** Implements the chat surface
  inside the existing `AgentToolWindowFactory`. Components: scrollable
  message list (Flexmark for markdown, custom syntax-highlight via
  IntelliJ `EditorTextField` or a lightweight token painter), input
  `JTextArea` with Shift+Enter for newline / Enter to send, Stop button.
  Action cards simplified: collapsed/expanded toggle with a summary line,
  no badges, no permission card. Status dot for streaming / done / error.
  Unit tests cover message-model assembly + collapse/expand state — the
  pixel render is human-verified.
- [ ] **T-203 — VS Code chat UI (Preact webview).** Preact bundle inside
  `clients/vscode/`. `@vscode/webview-ui-toolkit` for input + buttons.
  `shiki` for code-block highlight (falls back to plain `<pre>` on bundle
  weight > 200 KB). Webview hosts the same Card components as JetBrains
  (cross-IDE Preact code-sharing). Dark/light theme syncs via VS Code CSS
  vars. Unit tests cover component-prop validation, render-to-string
  snapshots, and theme variable resolution.
- [ ] **T-204 — Settings UI v0 (both IDEs).** JetBrains: `Configurable`
  implementation with three fields (provider [Anthropic only in MVP],
  API-key deep-link to OS-Keychain, default model). VS Code: contributes
  `configuration` block to `package.json` with the same three fields.
  Both surfaces write to `.event4u-agent/settings.json` (user-scope) —
  NOT `.agent-settings.yml` (read-only in MVP per T-208 contract).
  Unit tests: validate the contribution schema + the JSON writer.
- [ ] **T-207 — Statusbar widget (both IDEs).** JetBrains:
  `StatusBarWidgetFactory` showing `claude-sonnet-4-6 · $0.0156 today`.
  VS Code: `vscode.window.createStatusBarItem`. Refreshes on every step
  event. Click opens a placeholder dialog ("Cost Dashboard ships in v1.0
  Sprint 7"). Unit tests: format-text helper, refresh-throttle helper.

### Phase 3 carry-over

- [ ] **T-305 — Halt-card rendering.** Chat UI consumes
  `HaltRequest` envelopes from the sidecar (schema already shipped in
  `packages/protocol/src/llm.ts`). Renders question + numbered option
  buttons + free-text fallback. Single-select only — multi-select is
  v1.0 Sprint 7. Unit tests: option-click → answer-envelope assembly,
  free-text → `text` field of answer.
- [ ] **T-306 — "Ask about selection" editor action.** JetBrains:
  `AnAction` under `EditorPopupMenu`. VS Code:
  `vscode.commands.registerCommand` + keybinding `Ctrl+Shift+A` /
  `Cmd+Shift+A`. Sends selected text + path + line range as a new chat
  turn via the existing `AskAboutSelection` schema. Unit tests:
  selection-context builder, line-range extraction.

### Phase 4 carry-over

- [ ] **T-409 — Streaming counter (chat header).** During an in-flight
  turn, header shows `🟢 Streaming · In: 14,238 / Out: 412 · $0.0089 so
  far · Cancel`. Debounced 100 ms. On stream end, freezes with final
  values. Unit tests: debounce helper, formatter for token+cost rollup,
  cancellation wiring.
- [ ] **T-410 — Step-level cost footer per assistant block.** Below each
  assistant message: `⏱ 4.2s · In: 18,422 (cache: 14,200) · Out: 487 ·
  $0.0156` + `3 steps · 3 tool calls · TTFT 412ms`. Click opens a
  drawer with the step events for the turn (data from
  `step_events.jsonl`). Unit tests: footer formatter, drawer-state
  reducer.
- [~] **T-411a / T-411b host integration.** Wire the `CapsEvaluator`
  result + `countInputTokens()` into the chat-input footer:
  `Context: ≈14k tok · $0.043 · Output cap: 2k · Daily remaining: $4.27`.
  Yellow banner on `warn`, modal on `confirm`, disabled button on `block`.
  Backend already lands in `road-to-mvp.md`.
  <!-- deferred 2026-06-02: BACKEND GATE LANDED (ADR-041, PR — wires the
  dead CapsEvaluator into buildCoreDispatcher + both turn handlers'
  pre-send `preflight`: a `block` cap refuses the turn before any spend
  [`stopReason: cost_cap_blocked` + the verdict on a new `cap` wire field],
  `warn`/`confirm` ride the existing estimate event and proceed). The
  chat-input footer / yellow banner / disabled-button render + the
  soft-confirm modal round-trip are the IDE last-mile → stays `[~]`. -->

- [ ] **T-412 host integration.** Stop button + ESC keybinding fire the
  `CancellationToken.requestCancel()` on the active conversation. The
  3-layer fan-out already lands in the backend; this task is the UI
  wiring.
- [ ] **T-414 — Internal demo to event4u team.** Follow the Phase 0
  Phase 8 demo script verbatim. Capture team feedback in
  `agents/analysis/demo-feedback-<date>.md`. **Human activity** — agent
  prepares the demo environment, host runs the demo.

### Phase 5 carry-over (Buffer)

- [ ] **B-1 — Bug-fix sprint.** Triage post-demo bugs from the
  event4u team's first-week of usage. Gate: T-414 must produce a
  feedback file before B-1 can scope. **Human-gated.**
- [ ] **B-4 — OpenAI provider (pull-up candidate).** Only if buffer
  budget remains after B-1 + B-3 close. Otherwise B-4 stays cut to
  `road-to-v1-0.md` Sprint 5 per the original plan. Decision deferred to
  the buffer-burndown checkpoint.

## Exit gate

- [ ] Every `[~]` task above either flips to `[x]` (verified) or
  explicitly migrates to `road-to-v1-0.md` with a one-line rationale and
  a back-link from `road-to-v1-0.md` so the trail is bidirectional.
- [ ] `docs/MANUAL_VERIFICATION.md` carries verification-log entries
  for at least one platform run of T-103, T-105.
- [ ] Demo target ("Open PhpStorm + VS Code, `/commit` works in both API
  and CLI mode, statusbar shows cost, Stop button kills a blocking
  scenario, hard caps fire") passes — captured in
  `agents/analysis/demo-feedback-<date>.md`.

## Notes

- **No version / tag / commit steps.** Roadmap plans work.
- **Hard-floor reminder.** No autonomous commits to main, no force-pushes,
  no deploy. `commit-policy` + `scope-control` still apply.
- **Cross-reference.** Predecessor: `road-to-mvp.md`. Sibling:
  `road-to-multi-project.md`. Successor: `road-to-v1-0.md`.
- **Why a successor instead of editing the predecessor?** Once every
  Phase-X exit gate of `road-to-mvp.md` closes via the human IDE
  verification, that roadmap archives. `[~]` deferred tasks don't carry
  over via the archive — they would silently disappear from the dashboard.
  This roadmap is the explicit carry-over.
