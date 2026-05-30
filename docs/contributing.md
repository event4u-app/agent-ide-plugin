# Contributing — event4u Agent

Internal-contributor guide for the `agent-ide-plugin` monorepo. Read this
before opening a PR.

## Layout

```
packages/core       Node sidecar — all business logic (framework-free, unit-tested)
packages/protocol   Wire schema (NDJSON Envelope + LLM event shapes)
packages/shared     NDJSON parser/encoder + logger
clients/vscode      VS Code extension (TypeScript + Preact webview)
clients/jetbrains   JetBrains plugin (Kotlin / IntelliJ Platform)
agents/             Roadmaps, analysis, ADR drivers
docs/               Architecture, ADRs, manual-verification checklists
```

The architecture map is `docs/architecture.md`; decisions are in `docs/adr/`.

## Prerequisites

- **Node 20+** and **pnpm** (the repo is a pnpm workspace).
- **Task** (`Taskfile.yml`) for the common gates.
- JetBrains work needs **JDK 17** + **Gradle** — but **CI is the source of
  truth for Kotlin** (most contributors have no local JDK). Verify Kotlin via
  the JetBrains CI job, not locally.

## The local gate

```bash
task ci        # lint · format · build · typecheck · test  (the full local gate)
```

Run the pieces directly while iterating:

```bash
task lint
task typecheck
task test
pnpm --filter @event4u-agent/core exec vitest run src/pricing/verify.test.ts   # one file
```

Open a PR only after `task ci` is green locally for the TypeScript side. The
remote CI matrix re-runs everything across **node 20/22 × {macOS, Ubuntu,
Windows}** plus the JetBrains Gradle job.

## Project laws (non-negotiable)

These are why the codebase looks the way it does — violating them turns CI red
on a runner you may not have locally.

1. **No native dependencies.** The CI matrix includes Node 20, where
   `node:sqlite` does not exist; `better-sqlite3`, `sqlite-vec`, `node-pty`,
   `onnxruntime-node`, and `sharp` are all off the default graph. Persistence is
   append-only **JSONL**; the vector store is pure-TS brute-force; the real ONNX
   embedder is an **optional** dep loaded behind an injectable interface and
   gated by an env flag. Precedent + escape hatches: ADR-006, ADR-007, and the
   Phase-8 implementation note in `road-to-v1-0.md`.
2. **Fail-open.** A bad pricing feed, a dead MCP server, a missing telemetry
   directory, an unknown model — none of these throw into the agent loop. They
   degrade to a safe default and report a typed reason.
3. **Injectable seams for testability.** Clocks (`now()`), transports
   (`FakeTransport`), watchers (`FakeWatcher`), embedders (`FakeEmbedder`),
   process runners — every external effect is injected so unit tests are
   deterministic and need no subprocess, network, or real model.
4. **Zod at every boundary.** File content, wire payloads, and config are parsed
   with Zod; `.strict()` where extra keys would be a leak vector (telemetry).
5. **Cross-platform paths.** `fileURLToPath` on a drive-less `file:///` URL
   throws on Windows; `fs/promises realpath` has no `.native`. Make platform an
   injectable param and use plain paths in core tests. See the gotchas in
   `docs/cross-platform.md` and the FAQ.

## Core-first delivery

v1.0 phases land as **pure-core modules first**, with the IDE webview surfaces
following in a later IDE-runtime sprint. A core PR marks its IDE-gated exit
criteria `[~]` (core done, surfacing left) rather than `[ ]`. This is the
established pattern across Phases 5–14 — match it: ship and unit-test the engine,
leave a one-line note on each `[~]` saying what surface is still needed.

## Commits + PRs

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`), split into
  logical chunks (one concern per commit).
- No attribution footers, no decorative emojis in titles/commits.
- A non-trivial design fork goes to the AI Council (codex + gemini CLIs) and the
  outcome is recorded in an ADR before the code merges. See `docs/adr/` for the
  shape (Context · Decision · Consequences · Alternatives · Sign-off).
- Update `docs/architecture.md` and the roadmap checkboxes in the same PR that
  lands the work.

## Tests

Vitest for TypeScript (`*.test.ts` next to the source). JUnit for Kotlin. A bug
fix ships with a regression test; a new module ships with unit tests covering
its fail-open paths, not just the happy path.
