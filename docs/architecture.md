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
| `prices.yml` | T-206 v0: Anthropic models + Claude Pro / Max / Max-20x subscriptions |
| `loader.ts` | T-206: Zod-validated `PricingBook` with model + subscription lookup and `costFor()` |

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

## v1.0 deferrals

Out of scope per the roadmap's "cut explicitly" list — see `road-to-v1-0.md`
for the v1.0 expansion path: multi-step agent loop, multi-file edit, SweepAI
inline edits, Context Engine (Tree-sitter + BM25 → embeddings), live PTY
terminal, session browser, OpenAI / Codex / Gemini providers, Pricing-Book
signing, telemetry.
