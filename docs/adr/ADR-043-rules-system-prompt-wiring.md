---
adr: 043
title: Wiring The Always-Active RULES Prepend Onto The Live System Prompt (T-404)
status: Proposed (drafted 2026-06-02 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini-cli 0.41.2, 2026-06-02, two fork rounds). Round 1 (the slice) UNANIMOUS Q0=A (wire the dead T-404 rules seam — sibling of the guidelines wiring), Q1=A (extend resolveSystemPrompt with an optional loadRules; keeps every 2-arg call/test unchanged), Q2=A (walk the agent-config tree ONCE and cache — rules are session-static → byte-identical cache-friendly prefix), Q3=A (reuse the 16KB guidelines-style char cap), Q4=A (fail-open like guidelines), Q5=A (own `<workspace-rules>` delimiter, ahead of guidelines and the context base). Round 2 (the bundle fix) UNANIMOUS Q1=A (createRequire banner over re-implementing the walker / marking yaml external / lazy import).
related: completes the LIVE data path behind road-to-mvp T-404 ("Rules as always-active prepend"), marked `[x]` 2026-05-29 on its unit tests (`commands/system-prompt.ts :: buildSystemPrompt`) but whose producer + its input walker (`config/agent-config-walker.ts :: walkAgentConfig`) had ZERO live callers — the agent's always-active rules never reached the model. Direct sibling of the guidelines wiring (ADR-024 / PR #36, T-1307). The rules-editor / cost-surface render stays IDE last-mile, so T-404 stays `[x]` (engine-tested) with no checkbox change.
date: 2026-06-02
---

# ADR-043 — Wiring the always-active RULES prepend (T-404)

## Status

**Proposed** — awaits sign-off. One branch / one PR, three commit chunks
(core → build-config → docs), preserving minimal-safe-diff.

CI-verified locally: `task ci` green (lint clean, `prettier --check` clean,
build + typecheck clean); core **1075 pass / 1 skip** (+17); the VS Code
sidecar-spawn integration test passes; `jetbrains:check` BUILD SUCCESSFUL (no
Kotlin/protocol change — `Protocol.kt` untouched, no codegen). **No checkbox
flip** — T-404 was already `[x]` (engine-tested); this slice makes that `[x]`
true on the live dispatch path.

## Context

The Explore seam-hunt's standing top candidates were all rejected again as
verified-artificial / dead-writer / IDE-gated (`EditLoop`, status-rows,
`createEngagementRecorder`, memory backends, `DismissalStore`,
`ConversationState`, `buildCommitTurn`). It also surfaced
`injectContext`/`buildContextBlock` (`context/inject.ts`) — REJECTED: it is a
competing implementation of the already-live `buildContextInjection`, so wiring
it is a behaviour change to the cache contract, not a dead-seam wire.

The genuinely-clean seam is the **always-active RULES prepend (T-404)**. Two
shipped + unit-tested collaborators were DEAD on the live path:

- `walkAgentConfig(projectRoot)` (`config/agent-config-walker.ts`) — walks
  `.event4u-agent/` → `.augment/` → `.agent-src/` and returns `ConfigNode[]`
  (skill / rule / command, frontmatter + body). ZERO live callers.
- `buildSystemPrompt(nodes, {maxChars})` (`commands/system-prompt.ts`, T-404) —
  filters rules whose frontmatter `trigger` is `always` (or absent), sorts by
  name, concats `## Rule: <name>` sections under a char budget. ZERO live
  callers.

Net effect: the agent's always-active rules never reached the model. T-404 was
marked `[x]` purely on `buildSystemPrompt`'s unit tests; the live wiring was
never done — the exact shipped-tested-but-dead shape of PRs #45–54.

The live system-prompt path already EXISTS in both turn handlers:
`resolveSystemPrompt(base, loadGuidelines)` folds a per-turn guidelines string
ahead of `base` (the `<workspace-context>` block). `buildCoreDispatcher` wires
`loadGuidelines` from a `FileGuidelinesStore` but never walked the agent config
for rules. This is the direct sibling of the guidelines wiring (ADR-024 / PR
#36, T-1307) — guidelines got wired into the live request there; rules (T-404)
never did.

## Decision

Mirror the guidelines wiring:

1. **`resolveSystemPrompt(base, loadGuidelines, loadRules?)`** gains an optional
   third loader. When present, the rules string is wrapped in its own
   `<workspace-rules>` delimiter and folded AHEAD of guidelines, so the order is
   rules → guidelines → `base`. Rules + guidelines are session-static → the
   leading prefix stays byte-identical across turns (Anthropic `cache_control`
   friendly); the per-turn context trails. Fail-open: a rules-loader error
   degrades to guidelines + base, never throws. The optional arg keeps every
   existing 2-arg caller and test unchanged (council Q1=A, Q5=A).

2. **`createRulesLoader(projectRoot, {maxChars})`** (`commands/rules-loader.ts`)
   walks the agent-config tree ONCE and caches the rendered `buildSystemPrompt`
   text (rules are session-static; council Q2=A). A successful walk — even one
   finding no always-active rules (→ `''`) — is cached; a walk *error* degrades
   to `''` WITHOUT caching, so a transient FS race retries next turn (council
   Q4=A). Char budget reuses the 16KB guidelines-style cap (Q3=A).

3. **`buildCoreDispatcher`** constructs one `loadRules = createRulesLoader(cwd)`
   (overridable for tests via `BuildCoreOptions.loadRules`) and injects it into
   BOTH `ChatHandler` and `AgentTurnHandler` next to `loadGuidelines`, so chat
   and agent turns get identical rules semantics (council parity trap). The fold
   happens before the pre-send cost estimate, so the rules block is counted
   exactly once.

### The bundle fix (council round 2)

Pulling `walkAgentConfig` into the startup graph imported `yaml` into the live
sidecar bundle for the FIRST time (the walker, pricing/loader and agent-settings
all use `yaml`, but none were previously reachable from `main.ts`). The sidecar
is bundled by esbuild as ESM; `yaml`'s CJS composer does a dynamic
`require("process")`, and esbuild's ESM `__require` shim throws
`Dynamic require of "process" is not supported` → the sidecar crashed on
startup. Fix (UNANIMOUS Q1=A): move the core build off the inline esbuild CLI
into `esbuild.config.mjs` whose banner carries the standard `createRequire`
shim, so the bundled CJS deps resolve node builtins at runtime. `yaml` only ever
dynamic-requires node builtins (always resolvable) → safe for the single-file
packaged sidecar. ESM-only — the VS Code extension build is CJS and needs no
shim. The build script lives in a `.mjs` file (not an inline JSON-escaped
npm-script) so the multi-line banner stays cross-platform on the Windows CI
runner.

## Consequences

- The agent's always-active workspace rules now reach the model on every chat
  and agent turn, wrapped in a distinct `<workspace-rules>` block the model can
  tell apart from advisory guidelines.
- `yaml` is now in the startup bundle (≈no meaningful size delta on a 1.7MB
  bundle). The createRequire shim makes ALL esbuild dynamic-requires use the
  real node `require` — more correct for a node-targeted bundle; the only
  theoretical risk (masking a genuinely-missing runtime dep) is bounded because
  the bundled deps only dynamic-require node builtins.
- No protocol / codegen / Kotlin change.
- IDE last-mile (not in this slice): a rules-editor / "active rules" surface and
  any per-rule cost display. T-404 stays `[x]`.

## Alternatives considered

- **Re-implement the walker's frontmatter `trigger` read without `yaml`**
  (round-2 Q1=B) — avoids the dep but duplicates parsing logic and diverges the
  rules loader from the canonical walker. Rejected.
- **Mark `yaml` external** (round-2 Q1=C) — the packaged single-file sidecar
  would need `node_modules/yaml` at runtime, which it does not ship. Rejected.
- **Lazy `import()` the walker on first turn** (round-2 Q1=D) — does not fix the
  crash; the dynamic-require failure is bundle-level on `yaml` evaluation
  regardless of timing. Rejected.
- **Walk per-turn like guidelines** (round-1 Q2=B) — a full-tree FS walk per turn
  is heavier than reading one `guidelines.md`, and a mid-session file touch would
  churn the cacheable prefix. Rejected in favour of walk-once-cache.
- **Wire `injectContext`/`buildContextBlock` instead** — competing impl of the
  live `buildContextInjection`; a cache-contract behaviour change, not a clean
  dead-seam wire. Rejected.

## Sign-off

On flip to **Accepted**: none beyond merge — the slice is engine-complete and
verified. Follow-up (separate slice, IDE-gated): a rules-editor / active-rules
surface, and optionally a per-rule cost display. T-404 stays `[x]`.
