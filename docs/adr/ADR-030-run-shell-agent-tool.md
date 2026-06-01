---
adr: 030
title: run_shell Agent Tool — The Spawn Path That Populates the Terminal Session Manager (Shared Manager, Fail-Fast on Interactive Input, Tail-Bounded Result, Leave Exited Sessions, Minimal Review Surface)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli + gemini, 2026-06-01 run_shell design round — UNANIMOUS A1/B1/C1/D1/F; SPLIT E resolved to E1; both flagged the same traps — start/subscribe race, double-resolve across exit/input-kill/abort/timeout, output-after-exit, killing an already-done session, ring-buffer eviction vs the fed-back tail, FakeTerminal-never-exits test ergonomics)
related: discharges the spawn-path half of road-to-product-readiness T-PRD03 (named there as "a future run_shell agent tool") and adds the second mutating tool to the T-PRD01 approval path; advances road-to-v1-0 T-902/T-906; builds on ADR-013 (tool approval), ADR-023 (agent-turn tool loop), ADR-029 (terminal handler — the read path over the same manager)
date: 2026-06-01
---

# ADR-030 — run_shell Agent Tool

## Status

**Proposed** — awaits sign-off. The live-terminal CORE (`TerminalSessionManager`,
the `Terminal` interface + `FakeTerminal`, the dual-capped ring buffer, the
waiting-for-input state machine) shipped in Phase 9 (T-902) and the
`terminalSubscribe` read path shipped in ADR-029 (PR #41) — but **nothing ever
called `manager.start()`**. The manager held no sessions; the terminal stream had
no source. This slice adds the missing spawn path: a `run_shell` agent tool that
starts a command in the SAME manager the `terminalSubscribe` handler reads, so a
chat-spawned command streams into the IDE terminal panel end-to-end. Pure core,
CI-verified with the deterministic `FakeTerminal`; the real env-gated `node-pty`
factory (T-901) and the xterm.js render + tool-action card in both IDEs stay
native-/IDE-gated. No checkbox flips to `[x]` — the render last-mile remains.

## Context

The agentic chat turn (`AgentTurnHandler`, ADR-023) drives a tool loop over an
injectable `ToolRegistry`: each call is `prepare`d (parse args, optional approval
review) then run through `runToolCallWithApproval` (ADR-013) — gate `block` →
error, gate `ask` → injected `decide()` → deny stops / allow runs `exec`. The
shipped tools are four read tools (gate `low`, auto-allowed) and `write_files`
(`mutates: true`, `requires_approval`); the production `decide` default-denies
every `ask` until the IDE approval round-trip lands, and `mutates: true` tools are
filtered out of read-only agent modes (T-PRD08). The terminal manager exposes
everything a spawn caller needs — `start()` (PTY via an injected factory,
defaulting to `FakeTerminal`), `subscribe()` (atomic replay + live attach),
`dispose()`, and a `TerminalEvent` broadcast union whose `exit` member is the
absolute final lifecycle signal. The gap was the caller.

## Decision

Additive, pure-core. New `packages/core/src/tools/run-shell.ts` (`RunShellTool` +
`runShellToolDefinition`), a `terminalManager?` option on
`buildDefaultToolRegistry` that registers a `mutates: true` `run_shell` entry when
provided, and a one-manager-shared-between-tool-and-handler wiring in `sidecar.ts`.
**No protocol or codegen change** (`Protocol.kt` untouched, codegen idempotent);
no IDE render.

1. **Fork A1 — the SHARED manager is injected.** `sidecar.ts` builds ONE
   `TerminalSessionManager` and passes it to BOTH `buildDefaultToolRegistry({
   terminalManager })` (the spawn path) AND `new TerminalHandler({ manager })`
   (the read path), so a chat-spawned command is visible to `terminalSubscribe`
   and renders in the IDE terminal panel end-to-end — NOT a private per-tool
   manager. `run_shell` is registered only when a manager is supplied (unit tests
   that do not exercise shell omit it). (UNANIMOUS.)

2. **Fork B1 — fail fast on interactive input; settle exactly once.** The agent
   has no stdin channel, so a command that blocks on a prompt would hang. On the
   manager's `inputRequested` event the tool KILLS the session (`dispose`) and
   returns `status: 'needs-input'` telling the model to retry non-interactively.
   The turn abort signal (`dispose` + `aborted`) and an optional `timeoutMs` cap
   (`dispose` + `timeout`) also terminate it. A single idempotent `settled` guard
   makes resolution exactly-once across the `exit` / input-kill / abort / timeout
   races. (UNANIMOUS.)

3. **Fork C1 — tail-bounded result.** The full stream lives in the panel / ring
   buffer; the model gets the LAST 200 lines / 8000 chars, accumulated in the
   tool's OWN buffer (independent of ring-buffer eviction — a verbose command that
   evicts the buffer head still yields the true tail), plus the total byte count
   and a `truncated` flag. `ok` reflects the exit code only (`exited` && code 0).
   (UNANIMOUS.)

4. **Fork D1 — leave a naturally-exited session in the manager.** A clean `exit`
   leaves the `done` session for IDE panel scrollback/replay (the dispatcher
   disposes all sessions on client disconnect — ADR-029 fork F). Only a kill path
   (input / abort / timeout / error) disposes the session. (UNANIMOUS.)

5. **Fork E1 — minimal review surface (resolved from a split).** The approval
   card shows the command via the existing `argsPreview` (a JSON of
   `{command,args,cwd}`); `run_shell` returns no structured `ToolReview`. The
   `ToolReviewSchema` stays `kind: 'diff'` only. Gemini argued E2 (extend it to a
   `diff | shell` discriminated union now, matching the schema's forward-pointed
   "future kinds (e.g. a shell-command preview)" comment and the repo's
   ship-protocol-ahead pattern); codex argued E1 (minimal until an IDE
   shell-review renderer exists). **Resolved to E1**: `run_shell` does not need the
   review change to be correct, and E2 would *restructure* an existing protocol
   DTO (flat → sealed Kotlin variant) for zero consumers today — more invasive
   than the purely additive seams prior PRs shipped. The structured ShellReview is
   a documented follow-up (below), to land WITH the IDE shell-review renderer.

6. **Fork F — `mutates: true` + `requires_approval`.** A shell command is at least
   as dangerous as a file write, so `run_shell` reuses the default-deny gate and is
   filtered out of read-only agent modes — same posture as `write_files`.
   (UNANIMOUS.)

## Consequences

- The terminal manager now has a source: the agentic turn can run a command and
  it streams into the IDE panel through the SAME manager `terminalSubscribe`
  reads. The xterm.js render + the tool-action card stay the IDE last-mile, so
  **no checkbox flips to `[x]`** — T-PRD03 / T-PRD01 / T-906 keep their `[~]`;
  overall done count unchanged (a `[~]` is deferred, not done).
- **Safe by default**: `run_shell` is mutating + `requires_approval`, and the
  production `decide` default-denies, so the agent never runs a command unattended
  until the IDE approval round-trip lands. It is also unadvertised in read-only
  modes (ask / plan / review) and refused at runtime there (T-PRD08 backstop).
- **Correctness traps guarded** (both reviewers): `start()` + `subscribe()` +
  listener-attach run synchronously inside the promise executor (no start/subscribe
  gap; the replay slice is also folded in defensively); the `settled` guard makes
  `exit` / input-kill / abort / timeout resolve exactly once and tolerates the
  `exit` the kill itself emits; the tail buffer is independent of ring-buffer
  eviction; the tail truncates by BOTH lines and chars; the cwd is resolved inside
  the workspace root (escape → throw before any spawn).
- The manager defaults to `FakeTerminal`, so no real PTY is spawned until the
  env-gated `node-pty` factory (`EVENT4U_ENABLE_PTY`, T-901) lands. The whole tool
  is unit-tested by driving the Fake (`emit` / `emitReadIdle` / `emitExit`).

## Alternatives

- **A2 — a private per-tool manager.** Rejected: chat-spawned commands would be
  invisible to `terminalSubscribe`, breaking the one-ordered-stream (tmux) model
  and the end-to-end panel render that is the whole point.
- **B2 — rely solely on abort/timeout, ignore `inputRequested`.** Rejected: an
  interactive command would hang until the timeout, wasting the turn; failing fast
  with an actionable message is better agent ergonomics.
- **B3 — auto-answer pending input with a newline/EOF.** Rejected: feeds garbage
  to an unknown prompt; the model should make the command non-interactive instead.
- **C2 — feed the entire buffer back to the model.** Rejected: a verbose build
  blows the context window; the panel already owns the full stream.
- **E2 — extend `ToolReview` to `diff | shell` now.** Deferred (not rejected): it
  matches the forward-pointed schema comment, but restructures an existing DTO for
  no current consumer; it lands with the IDE shell-review renderer.

## Follow-ups

- **Structured ShellReview (E2).** When the IDE renders a shell-command approval
  card, extend `ToolReviewSchema` to a `diff | shell` discriminated union (+ Kotlin
  sealed variant) and have `run_shell` `prepare()` return `{ kind: 'shell',
  command, args, cwd }`.
- **Native PTY (T-901).** Wire `loadNodePtyTerminal` behind `EVENT4U_ENABLE_PTY`
  into the manager factory + the prebuild matrix, so `run_shell` runs real shells.
- **Tool-action card render (T-PRD01) + xterm.js panel (T-PRD03/T-904).** The
  approve/deny card for `run_shell` and the live terminal panel.

## References

- ADR-013 — tool approval flow (`runToolCallWithApproval`)
- ADR-023 — agent-turn tool loop (the `prepare`/`execute` registry contract)
- ADR-029 — live-terminal handler (the read path over the same shared manager)
- road-to-product-readiness T-PRD01 (tool-call action cards) · T-PRD03 (terminal card render)
- road-to-v1-0 T-902 (TerminalSessionManager) · T-906 (inline input card)
