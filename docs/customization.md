# Customization — MVP fields

> This doc lists the **MVP-relevant** fields the agent reads. agent-config's
> full schema can ship many more fields; the MVP silently ignores them
> (forward-compat).

## `.agent-settings.yml`

Lives at the **consumer-project** root. Hot-reload is deferred to T-207; for
now, restart the IDE after edits.

```yaml
llm:
  # Provider — only "anthropic" in MVP; OpenAI lands in v1.0 Sprint 5.
  default_provider: anthropic
  # Mode the chat starts in. "auto" picks CLI when claude is on PATH, else API.
  default_mode: auto      # api | cli | auto

roles:
  # Optional persona pin. Recognised values:
  # developer | reviewer | tester | po | incident | planner
  active_role: developer

commands:
  suggestion:
    enabled: true         # show command picker on "/" prefix
    senior_gate: false    # placeholder — wired in v1.0
```

Defaults when the file is missing or a field is omitted:

| Key | Default |
|---|---|
| `llm.default_provider` | `anthropic` |
| `llm.default_mode` | `auto` |
| `roles.active_role` | unset |
| `commands.suggestion.enabled` | `true` |
| `commands.suggestion.senior_gate` | `false` |

## `tracking.caps` (cap-evaluator wiring — Phase 4)

```yaml
tracking:
  caps:
    single_step:
      warn_above_usd: 0.05         # yellow banner
      confirm_above_usd: 0.50      # modal before send
      hard_block_above_usd: 2.00   # button disabled

    daily:
      warn_above_usd: 5.00
      confirm_above_usd: 20.00
      hard_block_above_usd: 50.00
```

Unset thresholds skip that severity; an unset section disables the whole
cap class. Subscription caps (Claude Pro etc.) are tracked but never block —
those are the CLI's responsibility.

## `.event4u-agent/`  (per-user, agent-managed)

| File | Content |
|---|---|
| `settings.json` | User-scope toggles the Settings UI writes (T-204 future) |
| `permissions.json` | "Always" grants recorded by the permission gate (T-304) |
| `step_events.jsonl` | Token-tracking persistence (T-408) |
| `conversation_summaries.jsonl` | Roll-up rows per conversation (T-408) |
| `audit-<session_id>.jsonl` | Tool calls + permission decisions + hard-floor blocks (T-413) |

The agent treats `.event4u-agent/` as machine-managed — edits survive but
get overwritten on the next write.

## Slash commands (agent-config tree-walker)

The walker scans for command markdown files in this priority order:

1. `.event4u-agent/commands/`
2. `.augment/commands/`
3. `.agent-src/commands/`

Higher-priority sources shadow lower ones by file basename. The picker shows
the command name (slug or `name:` frontmatter) plus the first non-empty line
of `description:` (or the first markdown heading as a fallback).

## API keys

The agent **never reads OS-keychains directly** from the sidecar. The IDE
adapter (JetBrains `CredentialStore` or VS Code `secrets`) retrieves the
secret and passes it via env var on sidecar spawn:

| Env var | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | T-201 Anthropic backend |
| `OPENAI_API_KEY` | v1.0 Sprint 5 |

The sidecar's `EnvSecretStore` (`packages/core/src/secrets/keychain.ts`)
maps logical keys → env vars; absent / empty values disable the matching
backend and surface a "set your key in Settings" banner in the chat.

## What's NOT user-tweakable in MVP

- The pricing book (`packages/core/src/pricing/prices.yml`) is plugin-bundled.
  Remote fetching + Sigstore signing land in v1.0 Sprint 14.
- The agent-config tree-walker's priority order is fixed (`.event4u-agent` →
  `.augment` → `.agent-src`). Customizable lookup paths are a v1.0 Sprint 11
  surface.
- Hard-floor regex patterns are fixed at the code level (ADR-004). Per-user
  pattern editing is v1.0 Sprint 6.
