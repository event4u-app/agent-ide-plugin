---
adr: 038
title: Permission-Audit Trail — Wiring The AuditLog Into The Composition Root (T-PRD05, The Dead-Trail Seam)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02 fork round — Q0=A wire-the-audit-seam, Q1=A `<state>/audit` sibling dir, Q2=A inject only into the agent turn, Q3=A BuildCoreOptions override mirroring step/calibration/budget, Q5=A write-path only; SPLIT Q4 → A (leave the competing T-413 file, minimal-diff) over gemini's B (delete now); both flagged real traps — construct once per dispatcher, and the entry schema carries no session/conversation correlation)
related: completes the LIVE half of T-PRD05 — ADR-014 shipped `permissions/audit.ts` AuditLog + its four call sites in `runToolCallWithApproval`, ADR-032 wired the risk badge onto the approval event; this slice constructs the recorder in the composition root so the production trail stops being dead. The permission-card audit-trail link + audit-drawer UI stay IDE-runtime (`[~]`). Reuses the calibration/step/budget injection seam (ADR-035/ADR-036/ADR-022).
date: 2026-06-02
---

# ADR-038 — Permission-Audit Trail (Wiring the AuditLog into buildCoreDispatcher, T-PRD05)

## Status

**Proposed** — awaits sign-off. ADR-014 shipped a fully-built, unit-tested
permission-audit subsystem: `permissions/audit.ts` `AuditLog` (append-only,
date-rotated `audit-<YYYY-MM-DD>.jsonl`, fail-open `record()`, torn-line-tolerant
`readDay()`), and `runToolCallWithApproval` already calls `ctx.audit?.record(...)`
at four decision points (`deny_hard_floor`, `deny_user`, `grant_always`,
`grant_once`). `AgentTurnHandler` already accepts `audit?: AuditRecorder` and
forwards it into the approval context. **But the composition root
(`buildCoreDispatcher`) never constructed an `AuditLog`** → in production
`deps.audit` was always `undefined` → every `record()` was a no-op → the audit
trail was dead. This slice constructs one live `AuditLog` and injects it. Pure
core, no protocol/codegen change (`Protocol.kt` untouched), CI-verified. The
audit-trail link on the permission card + the audit-drawer UI stay IDE-gated, so
**no checkbox flips** — this completes the live data path behind an existing
`[~]`.

## Context

This is the same seam shape as the last several PRs: a subsystem ships
built + tested + plumbed, but the production composition root never wires it, so
the live behaviour is dormant. A fresh Explore seam-hunt surfaced the audit
recorder as the cleanest, highest-value remaining pure-core seam — it is
**S-sized with NO behaviour change** (purely additive: it turns an
always-`undefined` optional dep into a live recorder), and it is genuinely
security/observability-relevant: every gated tool call now leaves an immutable
on-disk record.

Two facts make the wiring produce real rows immediately, not dormant ones:
the default `decide` in `buildCoreDispatcher` is `() => 'deny'` (the IDE approval
round-trip is not yet wired), so every `write_files` / `run_shell` the model
emits is denied → records a `deny_user` row; and any hard-floor block records a
`deny_hard_floor` row. The trail is live the moment a tool is gated.

A second, competing, fully-dead design also exists — `tracking/audit-log.ts`
(T-413), a different schema (`tool_call` / `permission_decision` /
`hard_floor_block`) with a `write()` method and **zero** callers or call sites
anywhere. It is not part of this wiring; see Q4 below.

The two alternatives the seam-hunt ranked above this both carry risk: wiring the
`AgentDriver` state machine into `AgentTurnHandler` is an L-sized HIGH
behaviour-change refactor; swapping in `EditLoop` is M-sized MEDIUM
behaviour-change. Neither is a clean additive one-PR autonomous slice.

## Decision

Construct one `AuditLog` in `buildCoreDispatcher` and inject it into the agent
turn, per the AI-council fork resolutions:

- **Q0 — wire the permission-audit seam (A).** Unanimous. Activates
  already-tested behaviour with minimal blast radius; the L/M behaviour-change
  alternatives are not autonomous one-PR slices.
- **Q1 — `<state>/audit` sibling dir (A).** Unanimous. Audit is neither cost
  (`<state>/cost`) nor generic tracking (`<state>/tracking`); it gets its own
  date-rotated sibling, matching the per-log-type dir convention.
- **Q2 — inject only into `AgentTurnHandler` (A).** Unanimous. The agent turn is
  the only handler that runs tool approvals; `ChatHandler` has no
  approval/`decide`/audit path, so injecting there would be misleading dead
  plumbing.
- **Q3 — `BuildCoreOptions.audit?` override, default `new AuditLog({dir})` (A).**
  Unanimous. Mirrors the existing `step` / `calibration` / `budget` injection
  pattern: production gets the live recorder, tests can override.
- **Q4 — leave the competing `tracking/audit-log.ts` (T-413) untouched (A).**
  SPLIT: codex A (separate cleanup PR — minimal-diff, the dead file has its own
  test + ticket, deleting it mixes a removal concern into an additive wiring
  slice), gemini B (delete now to prevent cross-schema confusion). Resolved to A
  on minimal-safe-diff / scope-control grounds; gemini's confusion concern is
  honoured by *documenting* the two-design supersession here rather than
  deleting in this PR. **Follow-up:** a separate cleanup slice should retire
  `tracking/audit-log.ts` (+ its test) in favour of `permissions/audit.ts`.
- **Q5 — wire only the WRITE path (A).** Unanimous. `readDay()`, the permission
  card's audit-trail link, and the audit-drawer UI stay IDE-gated (v1.0
  Sprint 7) — matching every prior data-path-first seam PR.

### Traps guarded (council)

- **Construct once per dispatcher** (codex). The `AuditLog` is built once in
  `buildCoreDispatcher` with a stable `<state>/audit` dir, not per turn/session;
  it does no I/O until the first recorded decision (`record()` lazily
  `mkdir`s + appends).
- **Fail-open write** (codex). `AuditLog.record` already wraps `mkdir` +
  `appendFile` in a try/catch that swallows — a torn append or disk-pressure
  error can never break a tool approval or the turn.
- **No session/conversation correlation** (gemini). The `AuditEntry` schema
  carries `kind` / `tool` / `reason` / `scope` / `ts` but **no** `session_id`
  or `conversation_id`, so a denial cannot be linked to a specific chat thread
  in post-mortem analysis. Adding correlation means evolving the council-locked
  T-PRD05 entry schema AND threading the conversation id through
  `ApprovalContext` — a separate, larger slice, explicitly **out of scope** here.
  Documented as a known limitation; the trail is still useful (per-decision,
  date-rotated rows).

## Consequences

- The production permission-audit trail is live: every gated tool call writes
  one JSONL row to `<state>/audit/audit-<YYYY-MM-DD>.jsonl`. With today's
  deny-default `decide`, that is a `deny_user` row per denied write/run plus a
  `deny_hard_floor` row per hard-floor block.
- No protocol/codegen change (`Protocol.kt` untouched); no native deps.
- No checkbox flips — T-PRD05 stays `[~]` (the card's audit-trail link + the
  drawer UI are the IDE last mile). Dashboard counts UNCHANGED.
- Backward-compatible: with an injected `audit` override (tests) the default
  construction is skipped; the recorder is fail-open so it never affects turn
  outcome.
- A follow-up cleanup should delete the superseded `tracking/audit-log.ts`
  (T-413); a separate slice may add session/conversation correlation to the
  entry schema and a `costReport`-style read method + drawer.

## Alternatives considered

- **AgentDriver / EditLoop seam.** Both carry behaviour-change risk (L HIGH / M
  MEDIUM); not clean additive one-PR autonomous slices.
- **Delete the competing T-413 file in this PR (Q4/B).** Mixes a removal concern
  into an additive wiring diff and pulls in the dead file's test + ticket;
  deferred to a dedicated cleanup slice.
- **Add session correlation now.** Requires evolving the council-locked entry
  schema and threading the conversation id through the approval context — a
  larger, separate slice.
- **Inject into ChatHandler too (Q2/B).** Dead plumbing — the chat turn runs no
  approvals.

## Sign-off

On flip to **Accepted**: no further action — the wiring is the whole change.
Deferred follow-ups (separate slices): retire `tracking/audit-log.ts` (T-413);
add session/conversation correlation + a read method + the drawer UI.

## References

- `packages/core/src/sidecar.ts` — `buildCoreDispatcher` constructs `AuditLog` under `<state>/audit` and injects it into the agent turn.
- `packages/core/src/permissions/audit.ts` — `AuditLog` / `AuditRecorder` (T-PRD05, shipped ADR-014).
- `packages/core/src/agent/approval.ts` — the four `ctx.audit?.record(...)` call sites.
- `packages/core/src/agent/turn-handler.ts` — forwards `deps.audit` into the approval context.
- `packages/core/src/sidecar.test.ts` — wiring test (a denied `write_files` records a `deny_user` row to disk via the default-constructed recorder).
- `packages/core/src/tracking/audit-log.ts` — the competing T-413 design left untouched (Q4/A); flagged for a follow-up cleanup.
- ADR-014 — shipped the audit recorder + call sites; ADR-032 — risk-badge wire.
- road-to-product-readiness T-PRD05.
