---
phase: validated-bet/3
step: Phase 3 Step 2 (Copilot variant)
status: starter — refine before Phase 3 Step 3 interviews
date: 2026-05-29
author: agent
---

# VS Code + GitHub Copilot — agent-config drop-in

> Sibling artifact to `cursor-export-prototype/`. Same content, Copilot-native format.

## File layout

```
vscode-copilot-prototype/
└── .github/
    ├── copilot-instructions.md          # 12 always-on Iron Laws (workspace-wide)
    └── instructions/
        ├── cmd-commit.instructions.md         # applyTo:"**" + description trigger
        ├── cmd-work.instructions.md
        ├── cmd-refine-ticket.instructions.md
        ├── cmd-create-pr.instructions.md
        └── cmd-review-changes.instructions.md
```

## Install (drop-in, ~30s)

```bash
# 1. ins Ziel-Repo wechseln
cd ~/projects/galawork/<target-repo>

# 2. Copy
PROTO=/Users/mathiasberg/projects/galawork/galawork-packages/event4u/agent-ide-plugin/agents/analysis/validated-bet/vscode-copilot-prototype
mkdir -p .github/instructions
cp "$PROTO/.github/copilot-instructions.md" .github/
cp "$PROTO/.github/instructions/"*.instructions.md .github/instructions/

# 3. verify
ls -la .github/copilot-instructions.md .github/instructions/
```

## Verify in VS Code

1. VS Code öffnen → das Ziel-Repo öffnen.
2. Copilot Chat öffnen (Ctrl+Alt+I / Cmd+Ctrl+I — je nach Plattform).
3. Copilot Settings prüfen — `github.copilot.chat.codeGeneration.useInstructionFiles` muss `true` sein (Default in 2024+).
4. **Test:** in Copilot Chat tippen — z.B. `commit my changes` oder `review the diff`. Copilot's Backend sollte:
   - `copilot-instructions.md` automatisch laden (workspace-wide always-on).
   - Bei intent-match-Phrasings die passende `cmd-*.instructions.md` mit reingeben (applyTo: "**" macht jede `.instructions.md` für alle Files relevant; das `description:`-Feld leitet Copilot's Intent-Matching).

## Bekannte Limitations vs Cursor

| Feature | Cursor (.mdc) | Copilot (.instructions.md) |
|---|---|---|
| Always-on Rules | ✅ `.cursorrules` | ✅ `.github/copilot-instructions.md` |
| Intent-matched loading | ✅ `agent_requested: false` + `description:` semantics | ⚠️ `applyTo: "**"` is glob-based, not intent-based — Copilot loads all 5 instruction files when ANY relevant file is open. Less surgical. |
| Per-file scoping | ✅ `globs: ["src/**/*.ts"]` | ✅ `applyTo: "src/**/*.ts"` |
| MCP integration | ✅ Native | ⚠️ Über separate Copilot-Erweiterungen (variieren je Version) |

**Folge für Phase 3 Interview:** mit Copilot-Setup wird der "always-loaded" Token-Cost höher als bei Cursor (alle 5 Command-Beschreibungen + Iron Laws = ~12-15k Tokens prepended pro Anfrage statt ~9k bei Cursor's Agent-Requested-Loading). Für den Interview-Test der Funktionalität egal — für ein Production-Plugin relevant.

## Interview methodology

Identisch zum Cursor-Prototyp (`../cursor-export-prototype/README.md` § "How to use this for an interview"). Setup-Schritt 1+2 angepasst:

1. **Copilot-Variante:** kopiere `.github/` Inhalt ins Ziel-Repo (Schritt oben).
2. Workspace neu öffnen damit Copilot Instructions frisch lädt.
3. Test-Sequenz (15 min): die 5 Tasks aus dem Cursor-README durchspielen, jetzt mit Copilot Chat statt Cursor Chat.
4. Vergleich: bei welchem Tool fühlt sich Intent-Matching natürlicher an? Latency? Trefferquote?

Closing question speziell für Copilot-User: *"Wenn Copilot bereits dein Standard ist — würdest du für agent-config-Workflows zu Cursor wechseln, oder das Plugin (wenn es existiert) installieren, oder bei Copilot bleiben?"*
