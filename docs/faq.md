# FAQ — event4u Agent

Common questions and gotchas from internal development. Grouped by audience.

## Using the plugin

### Which providers can I use?

Anthropic (API + Claude CLI), OpenAI API, Codex CLI, Gemini CLI, and any
OpenAI-compatible HTTP endpoint (Mistral / Together / Groq / OpenRouter /
self-hosted) configured under `.agent-settings.yml::llm.providers[]`. The engine
for all of these is built and unit-tested (Phase 5); the in-chat provider picker
is the IDE surface.

### CLI mode shows "auth expired" / "click here to authorise"

CLI backends rely on the vendor CLI's own auth. Gemini in particular needs a
one-time interactive OAuth consent (`gemini` once in a terminal). The
CLI-detection result surfaces this with an authorise hint. Newer `gemini-cli`
also refuses to run in an untrusted directory — the plugin runs it with the
workspace trusted.

### What does "Shadow API cost" mean?

In CLI mode you pay a flat subscription, not per-token, so there's no real dollar
figure. The dashboard shows what the same usage **would** have cost on the
metered API — the "shadow" cost — so the subscription's value is legible
(T-1404). It is an approximation from recorded token counts, not a bill.

### Does the plugin send my code or prompts anywhere for telemetry?

No. Telemetry is **opt-in** (`telemetry.artifact_engagement.enabled`, off by
default) and records only *which* skills/tools/commands ran — never content,
prompts, completions, file paths, or arguments. Logs are local-only JSONL under
`.event4u-agent/telemetry/`, date-rotated so you can delete any single day. The
schema is `.strict()` so a bug cannot smuggle content into a log row. See
ADR-007.

### How does the plugin know pricing is correct?

It ships a trusted bundled `prices.yml`. An over-the-wire pricing update is only
adopted if it carries a valid Ed25519 signature **and** doesn't drop any model's
price by more than 50% (a tamper/corruption signal). Otherwise the plugin falls
back to the bundled baseline — it never silently under-bills (T-1401, ADR-007).
The signed-feed pipeline itself (T-1402) is a later release.

## Developing

### `task ci` is green locally but red in CI — why?

Most often one of:

- **`tsc -b` clobbers the esbuild bundle.** A plain `tsc -b packages/core` emits
  a non-bundled `dist/server.js` over the runnable esbuild sidecar; a stale
  `*.tsbuildinfo` hides this locally. Verify typecheck from a clean tree
  (`rm -rf packages/*/dist; find . -name '*.tsbuildinfo' -delete`).
- **Windows path handling.** `fileURLToPath('file:///tmp/x')` throws on Windows;
  `realpath` has no `.native` on `fs/promises`. Use plain paths in core tests and
  inject the platform. See `docs/cross-platform.md`.
- **Node 20 in the matrix.** Anything depending on `node:sqlite` (added 22.5) or
  a native module breaks on the Node 20 leg. Stay pure-TS / JSONL.

### How do I get a second opinion on a design fork?

Use the vendor CLIs as an AI council: `codex exec "<prompt>" < /dev/null` and
`gemini -p "<prompt>"`. Gotchas: don't run both in parallel in one shell (codex
loses stdin → "os error 35"); run `gemini` from a throwaway cwd or prefix the
prompt with "TEXT ONLY, do not write files" because it runs agentically and will
write into the cwd. Record the convergence in an ADR.

### Plugin doesn't start on Windows ARM

`node-pty` (live PTY terminal, Phase 9) is native and not on the default graph;
the terminal feature is deferred until a no-native path or prebuild story lands.
The core sidecar itself is pure Node and runs on every platform in the CI matrix.

### Where do I look first?

`docs/architecture.md` for the module map, `docs/adr/index.md` for the decisions,
`docs/contributing.md` for the gate and the project laws, and the relevant
`agents/roadmaps/road-to-*.md` for the per-task ledger.
