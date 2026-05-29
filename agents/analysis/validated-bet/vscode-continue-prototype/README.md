---
phase: validated-bet/3
step: Phase 3 Step 2 (Continue.dev variant)
status: starter — refine before Phase 3 Step 3 interviews
date: 2026-05-29
author: agent
---

# VS Code + Continue.dev — agent-config drop-in

> Sibling artifact to `cursor-export-prototype/`. Same content, Continue-native format.
>
> **Bonus:** matches the Phase 2 bolt-on (`bolt-on-real.md`). The Continue bolt-on adds agent-config as a slash-command **source** (auto-walks the full tree); this prototype installs **5 hand-picked artefacts** via Continue's existing `.continue/prompts/` mechanism — no Continue-source-code patch required. Two different integration depths.

## File layout

```
vscode-continue-prototype/
└── .continue/
    ├── rules/
    │   └── iron-laws.md                # alwaysApply: true — 12 Tier-A Iron Laws
    └── prompts/
        ├── commit.prompt               # Continue v2 format: yaml preamble \n---\n body
        ├── work.prompt
        ├── refine-ticket.prompt
        ├── create-pr.prompt
        └── review-changes.prompt
```

## Install (drop-in, ~30s)

Continue.dev sucht nach `.continue/` im Workspace-Root sowie in `~/.continue/`. Für den Interview-Test → Workspace-Root, damit der Effekt pro Repo isolierbar ist.

```bash
# 1. ins Ziel-Repo wechseln
cd ~/projects/galawork/<target-repo>

# 2. Copy
PROTO=/Users/mathiasberg/projects/galawork/galawork-packages/event4u/agent-ide-plugin/agents/analysis/validated-bet/vscode-continue-prototype
mkdir -p .continue/rules .continue/prompts
cp "$PROTO/.continue/rules/"*.md       .continue/rules/
cp "$PROTO/.continue/prompts/"*.prompt .continue/prompts/

# 3. verify
ls -la .continue/rules/ .continue/prompts/
```

## Verify in VS Code

1. VS Code öffnen → das Ziel-Repo öffnen.
2. Continue.dev Plugin installieren falls nicht da: Extensions → "Continue".
3. Continue Chat-Panel öffnen (typically Cmd+L / Ctrl+L).
4. **Test slash-picker:**
   - In Continue Chat input `/` tippen.
   - Picker sollte zeigen: `commit`, `work`, `refine-ticket`, `create-pr`, `review-changes` (zusammen mit Continue's eingebauten 7 Legacy-Commands — also ~12 Einträge total).
   - Eines auswählen → Continue lädt die `.prompt`-Datei und sendet `<system>`-Block + Body als Prompt an's Modell.
5. **Test always-on rule:**
   - In Chat fragen: *"Welche Iron Laws gelten gerade?"* — Continue sollte aus `iron-laws.md` zitieren, weil `alwaysApply: true`.

## Bekannte Limitations vs Cursor

| Feature | Cursor (.mdc) | Continue (.prompt + rules/.md) |
|---|---|---|
| Always-on Rules | ✅ `.cursorrules` | ✅ `.continue/rules/*.md` mit `alwaysApply: true` |
| Slash-picker mit Hand-gepickten Commands | ✅ Über `.cursor/rules/cmd-*.mdc` + Description | ✅ Über `.continue/prompts/*.prompt` |
| Auto-discovery der vollen 135 agent-config Commands | ❌ jeder muss als eigene .mdc rein | ✅ über Phase-2-Bolt-on (separate Code-Änderung in Continue) |
| Picker-UX bei 12+ Items | Cursor's Picker hat Fuzzy-Search | Continue's Picker ist **prefix-only** (Spike 0.1 Befund) — bei 12 noch OK, bei 30+ kippt's |

## Zwei Integrationstiefen — was wann nutzen

Diese Direktory ist die **drop-in-Variante** — User kopiert 6 Files, fertig. Kein Continue-Source-Code-Change.

Der **Phase 2 Bolt-on** (`../bolt-on/`) ist die **deepere Integration** — User patcht Continue's `core/` mit `agentConfigSlashCommand.ts` und kriegt damit **automatisches** Walking der vollen agent-config-Tree (alle 219 Skills + 77 Rules + 135 Commands), gefiltert per Tier/Cluster.

| Variante | Setup-Aufwand | Coverage | Persistenz |
|---|---|---|---|
| **Diese drop-in-Variante** | 30 Sekunden cp | 5 hand-gepickte Commands | Bleibt bei Continue-Upgrade unverändert |
| **Bolt-on `core/`-Patch** | ~16 min einmal + full npm install | Alle 219+77+135 Artefakte automatisch | Muss bei Continue-Update neu gemerged werden |

Für **Phase 3 Interview** → drop-in nutzen (Iso-Bedingungen, vergleichbar zu Cursor-Prototyp). Für **eigene tägliche Arbeit** → bolt-on patchen.

## Interview methodology

Identisch zum Cursor-Prototyp (`../cursor-export-prototype/README.md` § "How to use this for an interview"). Setup-Schritt 1+2 angepasst auf die `.continue/`-Pfade oben. Test-Sequenz die gleichen 5 Tasks (commit / work / refine-ticket / create-pr / review-changes).

Closing question speziell für Continue-User: *"Wenn agent-config als drop-in funktioniert (diese Variante) — bräuchtest du den `core/`-Patch (mehr Setup, mehr Coverage) ÜBERHAUPT noch? Oder ist 5 hand-gepickte Commands genug?"* Wenn alle Interviewees sagen "5 reicht", killt das einen wesentlichen Teil der Plugin-Differenziator-Logic.
