# event4u Agent — IDE plugin

JetBrains + VS Code plugin pair backed by a single Node sidecar. Brings
agent-config skills, rules, and commands into both IDEs with cost-tracked
streaming, a permission-gated tool loop, and Claude CLI mode.

> **Status — MVP backend complete.** Sprints 1–4 backend halves (parsers,
> Anthropic backend, CLI backend, tool loop, permission gate, tracking,
> caps, cancellation, audit log, agent-config tree-walker) are shipped
> and unit-tested. The chat UI, settings panel, statusbar widget, and
> OS-keychain adapters live on the IDE side; the next sprint owns them.
>
> **There is no installable IDE integration yet** — you cannot install
> this into JetBrains or VS Code and use it today. The Node sidecar is
> complete and tested, but the chat UI, settings panel, and statusbar
> widget that turn it into a usable plugin are still pending (tracked in
> `agents/roadmaps/road-to-mvp-ui-finish.md`).
>
> See `docs/architecture.md` for the layout, `docs/customization.md` for
> the settings surface, `agents/roadmaps/road-to-mvp.md` for the per-task
> ledger, and `docs/MANUAL_VERIFICATION.md` for the GUI smoke checklist
> a reviewer walks before flipping the IDE-runtime tasks to done.

## Quick start (development)

```bash
pnpm install
task build            # builds all workspaces + the VS Code bundle
pnpm test             # runs every workspace's vitest suite
pnpm typecheck
pnpm lint
pnpm format

# JetBrains side (needs JDK 17 + a GUI for the runIde target):
cd clients/jetbrains
./gradlew check
./gradlew runIde      # opens a sandboxed PhpStorm with the plugin loaded
```

## Layout

```
packages/
  protocol/   wire-protocol schemas (NDJSON envelope, LLM types, tool defs)
  shared/     NDJSON parser, encoder, logger
  core/       Agent Core sidecar (Node) — LLM backends, tools, tracking, …
clients/
  jetbrains/  Kotlin + IntelliJ Platform plugin
  vscode/     TypeScript + Preact webview extension
agents/       per-project agent-config artefacts (roadmaps, evidence, …)
docs/         architecture, customization, manual-verification, cross-platform
```

## Architecture in one sentence

Two IDE plugins spawn one Node sidecar each, push messages over NDJSON
stdio, and the sidecar runs everything else: provider calls (Anthropic
API or Claude Code CLI), tool loop, permission gate, cost tracking, and
audit log. Full picture: `docs/architecture.md`.

## What MVP ships vs defers

**Shipped backends** (this branch): T-101..T-107 (Phase 1 skeleton),
T-201 Anthropic streaming, T-206 pricing book, T-208 settings reader,
T-301 tool normalizer, T-302 read tools, T-303 write_file diff,
T-304 permission gate, T-305/T-306 protocol, T-401 agent-config walker,
T-402 picker, T-403 /commit runner, T-404 rules prepend, T-405 CLI
detection, T-406 Claude CLI backend, T-407 mode toggle, T-408 tracking
JSONL, T-411a caps, T-411b countTokens, T-412 cancellation, T-413
audit log, T-205 secrets abstraction.

**Deferred to next sprint** (UI / IDE-runtime): T-103 + T-105 runtime
smoke, T-202 + T-203 chat UI, T-204 settings panel, T-207 statusbar,
T-409 + T-410 streaming counter + cost footer, the IDE-side button
wiring for T-411a / T-412, the IDE-side `SecretStore` adapter,
T-414 team demo.

## License

MIT — see `LICENSE`.
