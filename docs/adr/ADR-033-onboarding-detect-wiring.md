---
adr: 033
title: Onboarding Readiness On The Wire — Wiring detectReadiness (T-PRD12) As The onboardingDetect Dispatcher Method (New Method, Boolean-Only Provider Presence, Injected Host Probes, Spawn-Free PATH Lookup)
status: Proposed (drafted 2026-06-01 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-06-01 roadmap-selection + seam round — UNANIMOUS Option C, NEW onboardingDetect method, boolean-only key presence, api>cli>none derivation; converged on archiving road-to-vertical-slice with a documented IDE-smoke handoff)
related: makes road-to-product-readiness T-PRD12 detection seam LIVE over the protocol (detectReadiness shipped in ADR-017 with ZERO callers); completes + archives road-to-vertical-slice (the slice's final acceptance is the product-readiness handoff this same PR advances); builds on ADR-017 (distribution packaging, the "Node ≥ 20 required" startup contract this exposes) and ADR-004 (the readiness report is a hint for the wizard, never a security gate); the first-run wizard render stays the IDE last mile
date: 2026-06-01
---

# ADR-033 — Onboarding Readiness On The Wire (onboardingDetect)

## Status

**Proposed** — awaits sign-off. `detectReadiness(probes)` (onboarding/detect.ts,
T-PRD12, shipped in ADR-017) is a pure derivation of a `ReadinessReport`
(Node ≥ 20, Anthropic key present, Claude CLI on PATH, recommended mode
`api > cli > none`, ordered blockers) over **injected** probes. It had **zero
production callers**: a packaged plugin had no way to ask the running sidecar
whether the host can run the agent. This slice puts that question on the wire as
a new `onboardingDetect` dispatcher method backed by real host probes. Pure
core, CI-verified; the first-run **wizard render** (the VS Code webview /
JetBrains Swing panel, the model/budget pickers, the live test-ping) stays
IDE-gated, so **no checkbox flips** — T-PRD12 stays `[~]`.

## Context

A packaged plugin (no repo checkout) must tell, on first run, whether the host
can actually run the agent: a Node runtime new enough to host the sidecar, a
provider path (an Anthropic key, or the keyless Claude CLI). `detectReadiness`
already encodes that derivation, deliberately pure and side-effect-free — the
host is meant to supply the facts via a `DetectProbes` interface so every branch
is deterministic under unit test. But nothing wired it: the `Dispatcher` had no
method to invoke it, and the protocol had no readiness shape on the wire. The
detection was the shared core backing the JetBrains "Node ≥ 20 required" path
(ADR-017, AI council Fork 4A) yet sat unreachable from either client.

This is the same shape of pure-core seam every PR since #11 has discharged: a
capability shipped ahead of its render with no live caller, wired into the
dispatcher protocol-first. The seam-hunt this session ranked it the cleanest
remaining substantive seam (`planToReview` is trivial DRY; `phaseRunsInMode` and
the status-row builders only have the IDE-gated `AgentDriver` as a consumer).

## Decision

1. **New `onboardingDetect` method, not an overload.** Readiness is a distinct
   capability with its own request/response shape; it does not ride `connect` or
   `rootStatus`. Request is empty (`{}`) — the sidecar runs its own probes;
   response mirrors `ReadinessReport`. The protocol package owns the wire shape
   (`OnboardingDetectResponse` + `OnboardingNodeReadiness` +
   `OnboardingRecommendedMode`); it never imports core (the ChatUsage↔LlmUsage
   precedent). Kotlin DTOs are codegen'd (46 DTOs total).

2. **Boolean-only provider presence — the report never carries a key value.**
   `anthropicKey: boolean` says a non-empty `ANTHROPIC_API_KEY` is visible;
   `claudeCli: boolean` says the CLI resolves on PATH. The raw key value never
   reaches the wire. A protocol test and a dispatcher test both assert the
   serialized report cannot leak the value. `recommendedMode = api > cli > none`
   is the existing derivation, surfaced unchanged.

3. **Injected host probes, default to live, spawn-free PATH lookup.** The
   `Dispatcher` gains an optional 6th constructor parameter
   `onboardingProbes: DetectProbes`, defaulting to `defaultDetectProbes()`. The
   real probes live in a NEW `onboarding/probes.ts` (kept out of the pure
   `detect.ts`): `process.versions.node`, `process.env`, and a PATH lookup that
   walks `PATH` with plain `fs.existsSync` (with `PATHEXT` on Windows) — **no
   `child_process`, no native module** (no-native-deps law; runs identically on
   every CI matrix OS). The injection point keeps the dispatcher test
   deterministic (Node / key / CLI pinned per case).

4. **No checkbox flip; the wizard render is the last mile.** The method makes
   detection reachable; the wizard UI, the pickers, and the test-ping that proves
   the round-trip stay IDE-runtime. T-PRD12 stays `[~]`.

This PR also **completes and archives `road-to-vertical-slice`**: its sole open
acceptance step — "road-to-product-readiness.md is the next active roadmap" — is
now true (product-readiness is the active successor, advanced by this very
seam). Its remaining `[~]` items are IDE-runtime smokes documented in
`docs/MANUAL_VERIFICATION.md` and carried by product-readiness; per the council's
Iron-Law-3 resolution the roadmap is archived with that handoff recorded inline,
not kept open waiting on a human IDE session.

## Consequences

- A client can call `onboardingDetect` and get a deterministic readiness report
  to drive a "you're ready / here's what's missing" first-run gate — one shared
  contract for both IDEs, no per-client re-derivation of the Node/provider check.
- The sidecar's own Node version is always the reported one (it runs under Node),
  so the report is authoritative for the host that will run the agent.
- New surface area: one method, two DTOs, one probe module. The wizard render
  remains the deferred work; this does not change the IDE backlog, it unblocks it.
- `road-to-vertical-slice` leaves the active set (archived); the dashboard open
  count drops by one roadmap. No engine behaviour changed by the archive.

## Alternatives considered

- **Overload an existing method (e.g. `connect`) to return readiness.** Rejected:
  conflates workspace lifecycle with host capability; readiness is needed before
  any workspace is connected (first run, no checkout).
- **Expose the key value or a masked prefix.** Rejected: a boolean is sufficient
  for the wizard gate and the only shape that cannot leak a secret over the wire.
- **Spawn `which claude` / `claude --version` for CLI detection.** Rejected:
  violates the no-native/no-spawn posture and is slower + flakier than an
  `fs.existsSync` PATH walk; the walk is pure and cross-platform.
- **Keep road-to-vertical-slice open until a human runs the IDE smokes.**
  Rejected (council): the smokes are already documented in
  `docs/MANUAL_VERIFICATION.md` and owned by the active product-readiness
  roadmap; keeping the slice open duplicates that tracking. Archive with the
  handoff recorded.

## References

- `packages/core/src/onboarding/detect.ts` — `detectReadiness` (ADR-017).
- `packages/core/src/onboarding/probes.ts` — `defaultDetectProbes` (this slice).
- `packages/core/src/server.ts` — the `onboardingDetect` handler + injected probes.
- `packages/protocol/src/schema.ts` — `OnboardingDetectResponse` + method registration.
- ADR-017 — distribution packaging; the "Node ≥ 20 required" contract.
- ADR-004 — permission model; readiness is a hint, not a gate.
- `agents/roadmaps/road-to-vertical-slice.md` (archived), `road-to-product-readiness.md` (T-PRD12).
- `docs/MANUAL_VERIFICATION.md` § Vertical slice — the deferred IDE smokes.
