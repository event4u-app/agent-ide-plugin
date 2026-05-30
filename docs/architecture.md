# Architecture v0 — event4u Agent MVP

> Status: MVP backend complete (Sprints 1–4 backend halves shipped via
> `feat/road-to-mvp-phase-2-to-5`). UI work is the IDE-side sprint that
> reviewers can pick up next. See `agents/roadmaps/road-to-mvp.md` for
> the per-task ledger and `agents/evidence/analysis/mvp-scope-decision-2026-05-29.md`
> for the council-scoped pull-forward rationale.

## Topology

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  JetBrains plugin        │         │  VS Code extension       │
│  clients/jetbrains       │         │  clients/vscode          │
│  (Kotlin · Compose/Swing │         │  (TS · Preact webview    │
│   Tool Window)           │         │   for chat surface)      │
└─────────────┬────────────┘         └─────────────┬────────────┘
              │ NDJSON over stdio                  │ NDJSON over stdio
              │ (one Envelope per line)            │
              ▼                                    ▼
       ┌──────────────────────────────────────────────────┐
       │  Agent Core sidecar (Node.js)                    │
       │  packages/core                                   │
       │                                                  │
       │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
       │  │ LLM        │  │ Tools      │  │ Tracking   │  │
       │  │ backends   │  │ + perms    │  │ + caps     │  │
       │  │ (api, cli) │  │            │  │ + audit    │  │
       │  └────────────┘  └────────────┘  └────────────┘  │
       │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
       │  │ Config     │  │ Commands   │  │ Secrets    │  │
       │  │ (settings, │  │ (picker,   │  │ (env-      │  │
       │  │  walker)   │  │  /commit)  │  │  injected) │  │
       │  └────────────┘  └────────────┘  └────────────┘  │
       └──────────────────────────────────────────────────┘
                │
                ▼
       Anthropic API · Claude Code CLI · (more in v1.0)
```

The protocol package (`packages/protocol`) is the wire schema both ends speak;
the shared package (`packages/shared`) carries the NDJSON parser, encoder, and
logger. Both are TypeScript-only and build to `dist/` for direct consumption.

## Module responsibilities

### `packages/core/src/llm/`

| File | Responsibility |
|---|---|
| `backend.ts` | `LlmBackend` interface, `collectStream` helper, generic Anthropic-tool translator |
| `anthropic-api.ts` | T-201: streaming SDK wrapper, `cache_control` toggle, `countInputTokens` |
| `claude-cli.ts` | T-406: subprocess wrapper, no-output watchdog, raw → unified event translator |
| `cancellation.ts` | T-412: AbortSignal fan-out + SIGTERM → grace → SIGKILL for children |
| `conversation.ts` | T-407: per-conversation state, mode toggle, default-mode resolver |

### `packages/core/src/tools/`

| File | Responsibility |
|---|---|
| `normalizer.ts` | T-301: stream `tool_use_*` → `NormalizedToolCall`, JSON re-assembly, `tool_result` builder |
| `read-tools.ts` | T-302: `read_file` / `list_dir` / `glob` / `grep`, workspace sandboxing |
| `write-file.ts` | T-303: `WriteFileTool.propose` + `.apply`, unified-diff generator |

### `packages/core/src/permissions/`

| File | Responsibility |
|---|---|
| `gate.ts` | T-304: hard-floor regex set (ADR-004), classify + evaluate + persist `always` grants |

### `packages/core/src/tracking/`

| File | Responsibility |
|---|---|
| `db.ts` | T-408: append-only JSONL persistence of `step_events` + `conversation_summaries`; SQLite migration is a future INSERT loop |
| `caps.ts` | T-411a: per-step + daily-window cost caps with warn / confirm / block verdicts |
| `audit-log.ts` | T-413: append-only JSONL of `tool_call` / `permission_decision` / `hard_floor_block` |

### `packages/core/src/config/`

| File | Responsibility |
|---|---|
| `agent-settings.ts` | T-208: Zod-typed `.agent-settings.yml` reader (MVP-relevant subset) |
| `agent-config-walker.ts` | T-401: scan `.event4u-agent/` → `.augment/` → `.agent-src/`, parse frontmatter, index |

### `packages/core/src/commands/`

| File | Responsibility |
|---|---|
| `picker.ts` | T-402: fuzzy filter + rank over command nodes |
| `system-prompt.ts` | T-404: always-active rules → system prompt with optional char budget |
| `commit.ts` | T-403: read `git status` + assemble the `/commit` LLM turn |

### `packages/core/src/pricing/`

| File | Responsibility |
|---|---|
| `prices.yml` | T-206 v0: Anthropic models + Claude Pro / Max / Max-20x subscriptions; T-501/503/506 added OpenAI / Gemini / compat models |
| `loader.ts` | T-206: Zod-validated `PricingBook` with model + subscription lookup and `costFor()` |
| `verify.ts` | T-1401: Ed25519 detached-signature verify (`verifyPricingSignature`) + `priceDropGuard` (>50% drop) + `resolvePricing` fail-open orchestrator (ADR-007) |
| `pricing-pubkey.pem` | T-1401: bundled signing public key (placeholder until the T-1402 release pipeline; private key never committed) |

### `packages/core/src/cli/`

| File | Responsibility |
|---|---|
| `claude-detection.ts` | T-405: `which claude` → `--version` → light auth probe (2s timeout) |

### `packages/core/src/secrets/`

| File | Responsibility |
|---|---|
| `keychain.ts` | T-205: `SecretStore` interface, `EnvSecretStore` sidecar reader, `MemorySecretStore` test fixture. The real OS-keychain adapter lives on the IDE side |

## Wire protocol

NDJSON over stdio. One JSON-encoded `Envelope` per line:

```json
{ "messageId": "uuid", "messageType": "ping", "data": {}, "done": true }
```

- Request/response uses the same `messageId`.
- Streaming emits N envelopes with `done: false` then a terminal `done: true`.
- Schemas: `packages/protocol/src/schema.ts` + `packages/protocol/src/llm.ts`.

## What's NOT in this PR (UI / IDE-runtime work)

The backend modules above are framework-free and unit-tested. The remaining
MVP scope is IDE-side surface work that needs a running PhpStorm / VS Code:

- **T-202** — JetBrains chat UI (Compose Multiplatform or Swing, per Spike 0.3a).
- **T-203** — VS Code Preact webview + `@vscode/webview-ui-toolkit`.
- **T-204** — Settings UI (`Configurable` / `package.json contributes.configuration`).
- **T-205** — IDE-side `CredentialStore` / `secrets` adapter implementing `SecretStore`.
- **T-207** — Statusbar widget rendering the live cost.
- **T-305** — Chat card rendering the `HaltRequest` schema.
- **T-306** — Editor-action plumbing for "Ask about selection".
- **T-409 / T-410** — Streaming counter + step cost footer in the chat view.
- **T-411b host integration** — Wire the `countInputTokens()` result into the
  chat-input footer (`Context: ≈14k tok · $0.043 · Output cap: 2k`).
- **T-412 host integration** — Wire the cancellation token to the Stop button
  + ESC keybinding.
- **T-414** — Internal demo (human activity).

Manual smoke checklist for the JetBrains pieces lives in
`docs/MANUAL_VERIFICATION.md`.

## v1.0 core — shipped vs IDE-gated

The MVP module map above is the v0 baseline. Since then the v1.0 engine phases
landed as **pure-core** modules (framework-free, unit-tested) ahead of their
IDE surfaces — the same core-first split documented per phase in
`road-to-v1-0.md`. What is built in `packages/core/src/` today:

| Area | Modules | Roadmap |
|---|---|---|
| Multi-provider LLM | `llm/openai-api.ts`, `llm/codex-cli.ts`, `llm/gemini-cli.ts`, `llm/openai-compat.ts`, `llm/cli/manifests/*` | Phase 5 (T-501..507) |
| Context Engine | `context/walker.ts`, `chunk-tree.ts`, `indexer.ts`, `bm25.ts`, `embedder.ts`, `vector-store.ts`, `hybrid.ts`, `inject.ts`, `engine.ts` | Phase 6 + 8 |
| Agent loop + edit | `agent/loop.ts`, `agent/edit-loop.ts`, `tools/locate.ts`, `tools/write-files.ts`, `tools/validate-edit.ts` | Phase 7 (T-701..702c) |
| Cost UX | `cost/estimate.ts`, `cost/reconcile.ts`, `cost/shadow.ts` | Phase 7 + 14 (T-705/706/1404) |
| MCP + memory + hooks | `mcp/*`, `memory/local.ts`, `memory/backend.ts`, `hooks/runner.ts` | Phase 11 (T-1101..1106) |
| Session browser | `sessions/*` (5 lossy adapters + aggregator + provenance + watcher) | Phase 12 (T-1202..1206) |
| Ship-readiness | `pricing/verify.ts`, `telemetry/engagement.ts`, `telemetry/report.ts` | Phase 14 (T-1401/1403) |

Multi-root workspace support (`context/roots.ts`, `multi-root-walker.ts`) landed
via `road-to-multi-project`. ADRs 005–007 record the load-bearing v1.0
decisions.

**Still IDE-runtime-gated** (need a running PhpStorm / VS Code; tracked `[~]` /
`[ ]` on the roadmaps): every webview surface — chat cards, action-card badges,
Cost Dashboard, the per-CLI gear panel, the Unified Session Browser overlay, the
inline-edit prompt bar, live PTY terminal rendering, the telemetry opt-in toggle
+ export command, and the price-drop hard-block dialog. The core engines they
render are done and unit-tested; only the surfacing remains.

## v1.0 deferrals

Still genuinely out of scope (not just unsurfaced) per the roadmap: the Sigstore
signing **pipeline** (T-1402 — Ed25519 verify ships now, the signed feed +
provenance is later), live PTY terminal backend (`node-pty` is native — blocked
by the no-native-deps law), and the native IDE-depth shortcuts (Phase 10). See
`road-to-v1-0.md` for the per-phase ledger.
