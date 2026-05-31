---
adr: 017
title: Distribution Packaging — Sidecar Bundled into VSIX (ELECTRON_RUN_AS_NODE) + JetBrains ZIP (prepareSandbox copy + Pure Path Resolver), System-Node for JetBrains, Onboarding Detection Core Seam
status: Proposed (drafted 2026-05-31 — awaits user sign-off before flip to Accepted)
deciders: solo-dev (event4u team lead) — sign-off required
consulted: AI Council (codex-cli 0.134.0 + gemini 0.41.2, 2026-05-31 Phase-3 distribution design round — UNANIMOUS forks 1A/2A/3A/4A + version 0.1.0; SPLIT fork 5, resolved to a measured 5B)
related: road-to-product-readiness Phase 3 (T-PRD10/11 packaging; T-PRD12 onboarding-detection core seam); builds on the per-client render decision (ADR-013/014), the provider-registry composition root (ADR-011), and the no-native-deps project law
date: 2026-05-31
---

# ADR-017 — Distribution Packaging

## Status

**Proposed** — the build-infra layer that turns the two thin clients into real
installable artifacts with the Agent Core sidecar bundled in. The "installs on
a clean machine and chats with no repo checkout" smoke is human/IDE-gated and
signs `docs/MANUAL_VERIFICATION.md § Product readiness Phase 3`; producing the
artifacts and asserting the bundled sidecar is autonomous and CI-verified.

## Context

Both clients spawned the sidecar from a **dev path** assuming the monorepo was
checked out: VS Code's `resolveSidecarPath` fell back to
`../../packages/core/dist/server.js`, and JetBrains hard-coded
`"$base/packages/core/dist/server.js"`. No `.vsix` or plugin ZIP existed —
the #1 external-review finding ("no installable IDE integration yet"). Phase 3
asks for installable artifacts. The open questions: how the bundled sidecar's
**Node runtime** runs in each host, **where** `server.js` lives in each artifact
and how it is **resolved** at runtime, what to do when **Node is absent**, and
how much of the onboarding wizard (T-PRD12) / extension-host smoke tests
(T-PRD13) is autonomous now vs IDE-gated.

## Decision

Six forks, ratified by the AI council (codex-cli 0.134.0 + gemini 0.41.2,
2026-05-31):

- **1A — VS Code reuses Electron's Node via `ELECTRON_RUN_AS_NODE=1`.**
  `nodePath` defaults to `process.execPath`; in a packaged `.vsix` that is the
  VS Code/Electron binary, which would *launch a window* when handed a script
  arg. Setting `ELECTRON_RUN_AS_NODE=1` in the spawn env makes it behave as
  plain Node — no system-Node prerequisite, works offline. Real Node ignores the
  var, so the dev path and unit tests are unaffected. (UNANIMOUS.)
- **2A — copy the built single-file sidecar into `clients/vscode/sidecar/`.** A
  `bundle:sidecar` script copies `packages/core/dist/server.js` (and the root
  `LICENSE`) into the extension; `resolveSidecarPath` already prefers
  `sidecar/server.js`. `vsce package --no-dependencies` (the workspace deps are
  esbuild-bundled into `out/extension.js`) emits the `.vsix`. A `.vscodeignore`
  drops `src/`, tests, and tooling. The sidecar stays a separate spawned process
  — esbuilding the core *into* the extension bundle (2B) was rejected as it
  collapses the process boundary. (UNANIMOUS.)
- **3A — JetBrains bundles via `prepareSandbox` + a pure path resolver.** A
  `prepareSandbox` `from(...).into(pluginName.map { "$it/sidecar" })` block puts
  `server.js` into the plugin distribution at `<plugin>/sidecar/server.js` (the
  `buildPlugin` ZIP carries it). `SidecarPathResolver` (pure, JUnit-tested, no
  IntelliJ API) prefers the installed `<pluginPath>/sidecar/server.js`, then the
  dev path; `SidecarLocator` feeds it the real `PluginDescriptor.pluginPath`.
  Classpath-resource extraction (3B) was rejected for the runtime extraction
  cost. The directory-form `from` is tolerant of a missing source, so the
  `check`-only CI job (which does not build the Node core) still passes. (UNANIMOUS.)
- **4A — JetBrains spawns system `node`, surfaces a clear requirement.**
  JetBrains ships no Node; bundling a multi-arch Node binary (4C) violates the
  no-native-deps spirit and is heavy. The README states the Node ≥ 20
  requirement, and the onboarding-detection seam (below) is the shared core
  backing for a "Node ≥ 20 required" first-run error. (UNANIMOUS.)
- **5B (measured) — ship a pure onboarding-DETECTION core seam now; wizard UI
  deferred.** The council split: codex (5A) wanted packaging-only for PR
  coherence; gemini (5B) wanted the core-first detection seam. Resolved to a
  *measured* 5B: `packages/core/src/onboarding/detect.ts` derives a
  `ReadinessReport` (Node ≥ 20, Anthropic key present, Claude CLI on PATH,
  recommended mode, blockers) from **injected probes** — pure and unit-tested.
  This is exactly the mitigation both reviewers asked for against the flagged
  risk (Node-runtime asymmetry between the two IDEs): one shared detection
  contract. The wizard UI, the live test-ping that proves the round-trip, and
  the extension-host smoke tests (T-PRD13) stay IDE-runtime → deferred.
- **Version 0.1.0.** A real installable artifact should not ship as `0.0.0`;
  `0.1.0` marks the first packaged distribution without overclaiming stability.
  (UNANIMOUS.)

## Consequences

- **Positive.** Both plugins now package into installable artifacts with the
  sidecar bundled (`task package` / `task vscode:package` / `task
  jetbrains:package`), and a new CI `package` job asserts the sidecar is present
  in each — closing the "no installable integration" gap autonomously. The VS
  Code spawn fix removes a real packaged-extension bug (`process.execPath`
  launching a window). The Kotlin resolver is pure and unit-tested; the IntelliJ
  glue is isolated in `SidecarLocator`. The detection seam gives T-PRD12 a tested
  core spine.
- **Negative / deferred.** JetBrains keeps a system-Node prerequisite (no
  bundled runtime) — documented, not eliminated. The `.vsix` carries a 1.25 MB
  sidecar (the esbuild bundle); acceptable for a single-file Node script. The
  onboarding wizard UI, the live test-ping, and the extension-host smoke tests
  (T-PRD13) stay IDE-runtime → T-PRD12 keeps its detection core as `[~]`,
  T-PRD13 stays `[ ]`. The clean-sandbox install smoke is human-gated.
- **Cost.** 9 new core tests (`detect.test.ts`) + 6 JetBrains tests
  (`SidecarPathResolverTest`). VSIX builds (9 files, 292 KB packed) and the
  JetBrains ZIP (`event4u-agent-jetbrains-0.1.0.zip`) both carry the sidecar,
  verified locally; `task jetbrains:check` green (compile + detekt + ktlint).

## Alternatives considered

- **1B — spawn system `node` for VS Code.** Rejected: adds a prerequisite VS
  Code does not need (its own Node is right there) and reintroduces PATH issues.
- **1C / 4C — bundle a per-platform Node binary.** Rejected: multi-arch weight,
  against the no-native-deps law.
- **2B — esbuild the core into the extension bundle.** Rejected: the core is a
  separate spawned process; one bundle cannot be both.
- **2C — download the sidecar on first run.** Rejected: network dependency
  breaks offline install.
- **3B — embed `server.js` as a classpath resource, extract on first run.**
  Rejected: runtime extraction cost; a filesystem path via `PathManager` is
  cleaner. **3C — dev path only.** Rejected: fails the no-repo-checkout goal.
- **5A — packaging-only, defer the detection seam.** Sound for PR coherence, but
  the seam is the named mitigation for the Node-asymmetry risk and matches the
  core-first law every prior slice followed.

## References

- ADR-011 — provider registry the onboarding test-ping (deferred) will reuse.
- ADR-013 / ADR-014 — the per-client render decision this packaging supports.
- `clients/vscode/scripts/bundle-sidecar.mjs`, `clients/vscode/.vscodeignore`,
  `clients/vscode/src/sidecar-client.ts` (spawn env),
  `clients/jetbrains/build.gradle.kts` (`prepareSandbox`),
  `clients/jetbrains/src/main/kotlin/de/event4u/agent/SidecarPathResolver.kt`,
  `SidecarLocator.kt`, `packages/core/src/onboarding/detect.ts`,
  `.github/workflows/ci.yml` (`package` job), `Taskfile.yml`.
- `no-native-deps` (project law), `commit-policy`, `scope-control`.
