# event4u Agent Plugin — Implementierungsplan

> **Ziel:** Ein **nativer IDE-Host für `@event4u/agent-config`** (Skills, Rules, Commands, Personas) für **JetBrains-IDEs** und **Visual Studio Code**, der nebenbei ein vollwertiger Coding-Agent ist — LLM-agnostisch (Claude, OpenAI, Gemini, lokal, Custom) und Dual-Mode (API + CLI/Subscription).
>
> **Positionierung:** Wir bauen **kein** generisches Coding-Agent-Plugin in Konkurrenz zu Continue.dev / Cline / Cody. Wir bauen den **erstklassigen Konsumenten** des kuratierten event4u-Wissens-Layers. Das ist der einzige Grund, warum dieses Plugin existiert (statt ein bestehendes Plugin zu forken).
>
> **Arbeitsname:** `event4u-agent` (Repository). Marketing-Name + Zielgruppen-Positionierung (intern vs. public) werden in **Phase 0** entschieden (siehe §0).

---

## Inhaltsverzeichnis

0. [Phase 0 — Validation & strategische Entscheidungen](#0-phase-0--validation--strategische-entscheidungen)
1. [Executive Summary](#1-executive-summary)
2. [Ziele & Non-Goals](#2-ziele--non-goals)
3. [Referenz — was Augment Code macht](#3-referenz--was-augment-code-macht)
4. [Referenz — agent-config als Grundlage](#4-referenz--agent-config-als-grundlage)
5. [Zielarchitektur](#5-zielarchitektur)
6. [Tech-Stack & Repository-Layout](#6-tech-stack--repository-layout)
7. [Feature-Roadmap (MVP → v1.0 → v2.0)](#7-feature-roadmap)
8. [Modul-Breakdown](#8-modul-breakdown)
9. [LLM-Provider-Strategie — Dual Mode (API + CLI)](#9-llm-provider-strategie--dual-mode-api--cli)
10. [agent-config Integration — der eigentliche Differenziator](#10-agent-config-integration--der-eigentliche-differenziator)
11. [Context Engine Design](#11-context-engine-design)
12. [Tool-Calling & MCP](#12-tool-calling--mcp)
13. [Sicherheit, Privacy & Compliance](#13-sicherheit-privacy--compliance)
14. [Token-Tracking, Cost-Transparenz & Telemetry](#14-token-tracking-cost-transparenz--telemetry)
15. [Testing-Strategie](#15-testing-strategie)
16. [Distribution & Release](#16-distribution--release)
17. [Konkreter Phasen-Plan mit Tickets](#17-konkreter-phasen-plan)
18. [Risiken & offene Entscheidungen](#18-risiken--offene-entscheidungen)
19. [Follow-up: lokale Augment-JAR-Analyse](#19-follow-up-lokale-augment-jar-analyse)
20. [Glossar](#20-glossar)

---

## 0. Phase 0 — Validation & strategische Entscheidungen

> **Vor Sprint 1 muss diese Phase abgeschlossen sein.** Ohne diese Entscheidungen wäre Sprint 1 ein Bauen auf Vermutungen — und Bauversuche auf falschen Annahmen sind die teuerste Form von Re-Work. Phase 0 ist **2 Wochen, harte Zeitbox.**

### 0.1 Build-vs-Fork-Entscheidung gegen Continue.dev

Bevor wir einen einzigen Sprint anfangen: **Können wir Continue.dev (Apache 2.0, Cross-IDE-Plugin mit JetBrains + VS Code, Provider-Layer, MCP-Support, Context-Engine, Diff-Apply) forken** und mit einer event4u-agent-config-Integration veredeln — statt vier Sprints lang Infrastruktur neu zu bauen?

**Aufgabe in Phase 0:** Continue.dev forken (Spike-Branch, kein commitment), folgende konkrete Punkte prüfen:

| Prüfpunkt | Ergebnis-Form |
|---|---|
| Ist die agent-config-Integration als Plugin/Extension in Continue.dev sauber andockbar? | Code-Sketch, ja/nein |
| Wie steht es um den Dual-Mode (API + CLI)? Hat Continue.dev so etwas? Wie schwer ist es nachzurüsten? | Aufwandsschätzung (Wochen) |
| Wie aufwändig ist Re-Branding + Distribution unter eigenem Namen? | Aufwand + lizenzrechtliche Bewertung |
| Wie stark divergiert die Continue.dev-UX von unserer Ziel-UX (Action Cards, Permission Cards, Cost Dashboard)? | Visueller Vergleich + UX-Diff |
| Kostentransparenz auf 4 Ebenen + Shadow-API-Cost: nachrüstbar oder Neu-Bau im Fork-Repo? | Aufwand + Architektur-Skizze |
| Wie tief greift Continue.dev in den IDE-API ein (Inline-Edit, Right-Click, Intention)? Müssten wir trotzdem nativ nachlegen? | Liste der Lücken |

**Entscheidungs-Regel:**
- Wenn Fork **≤ 40% Aufwand** gegenüber Neu-Bau **und** keine architektonischen Knebel: → **Fork-Pfad**
- Wenn Fork **≥ 70% Aufwand** oder unsere Differenziatoren (Dual-Mode, Cost-Tracking, agent-config-first) sich nicht sauber andocken lassen: → **Neu-Bau-Pfad** (dieser Plan)
- Dazwischen: **Pragmatischer Hybrid** — Continue.dev's Provider-Layer + Diff-Apply übernehmen, agent-config-Host eigen bauen

Das ist **die wichtigste Entscheidung im ganzen Projekt.** Wenn wir sie nicht aktiv treffen, treffen wir sie passiv — und entdecken in Sprint 6, dass wir die Hälfte von Continue neu gebaut haben.

### 0.2 Positionierungs-Entscheidung — intern vs. public

Diese Frage entscheidet über mindestens fünf andere Punkte (Skalierung, Code-Signing, Marketplace-Distribution, Marketing-Aufwand, Telemetry-Architektur, Lizenz). Sie muss **vor Sprint 1** beantwortet sein, nicht nach Sprint 10.

| Option | Was das heißt | Pro | Contra |
|---|---|---|---|
| **A) Reines Internal Tool** | Nur für event4u + Galawork-Team. Verteilung über internes Repo. Keine Marketplaces. | Geringer Marketing-Aufwand, Solo-Entwickler reicht, Telemetry kann strikter, kein Code-Signing-Aufwand | Plugin wird nicht zur Lead-Gen-Bewegung für event4u-Brand |
| **B) Public, primary für event4u-Stack** | JetBrains Marketplace + VS Code Marketplace, aber „best-in-class für event4u/Laravel/PHP" und nur sekundär generisch | Brand-Halo, Recruiting-Werkzeug, externe Beiträge möglich | 2–3× Entwickler-Aufwand für Distribution + Doku + Support |
| **C) Public, generisches Coding-Tool** | Konkurrenz zu Continue/Cline | maximaler Reach | unterskaliert mit 1 Entwickler, würde Continue.dev-Fork erzwingen |

**Empfehlung Default:** Option **B**, falls Phase 0 keine andere Erkenntnis bringt. event4u-spezifisch bauen, aber so dass es für andere PHP/Laravel-Shops genauso nutzbar ist. Die Frage muss vom Team explizit bestätigt werden.

### 0.3 Technische Spikes (parallel zu 0.1 + 0.2)

Drei Spikes mit harten Pass/Fail-Kriterien. Jeder Spike maximal 2 Tage.

| Spike | Frage | Pass-Kriterium |
|---|---|---|
| **JBCef Theme-Sync** | Funktioniert `JBColor` ↔ CSS-Variablen-Sync robust bei Theme-Switch + IDE-Restart? | UI-Test bei Theme-Switch zeigt Webview-Update < 200ms, kein FOUC, kein Memory-Leak nach 50 Theme-Switches |
| **JSON-RPC Throughput** | Schafft die Kotlin-↔-Node-Pipe ein Streaming-Token-Volumen ohne UI-Stall? | 5000 Token in < 3 s vom Sidecar zum JetBrains-Chat geliefert + gerendert, p99 < 800 ms per Token-Batch |
| **CLI-Pipe Robustness** | Funktioniert `claude --output-format=stream-json` als Subprozess von der IDE? OAuth-Flow funktioniert? | End-to-End-Demo: ein Chat-Turn an Claude Code CLI, Antwort streamt zurück, Token-Counts werden extrahiert, Abort funktioniert sauber |
| **JetBrains-PTY-Bridge** | Kann `JBTerminalWidget` + `TtyConnector` an einen externen PTY-Stream (von node-pty im Sidecar) gebunden werden? | Spike-Demo: ein Sidecar-PTY-Stream wird im JetBrains-Terminal-Tool gerendert, Tastatur-Input vom IDE-Terminal landet in der PTY. Bei Fail: v1.0 ohne full read/write JetBrains-Terminal-Sync — nur read-only Mirror. v1.5 reicht read/write nach |

Jeder Fail führt zu Re-Scoping: bei JBCef-Fail → Compose-only-UI; bei JSON-RPC-Fail → Kotlin-natives-Backend ohne Sidecar; bei CLI-Pipe-Fail → CLI-Mode in v1.0 statt MVP.

### 0.4 IDE-Mindestversion-Frage

Augments `since-build="242"` = IntelliJ 2024.2+. Vor Sprint 1 beim Team klären: **Welche PhpStorm-Versionen laufen im event4u-Team tatsächlich?** Falls jemand auf 2024.1 oder älter ist, müssen wir entweder `since-build` runter ziehen oder die Person updaten lassen. Diese triviale Frage hat zwei Sprints später überraschend hohen Impact.

### 0.5 agent-config-PR — frühe Abstimmung

Damit das Plugin als first-class Tool in agent-config geführt wird, brauchen wir eine eigene Projection-Pipeline. PR-Skizze (kein Code) **vor Sprint 1** an die agent-config-Maintainer schicken, damit Sprint 4 nicht an unklarem upstream-Status hängt.

### 0.6 Phase-0-Deliverables

Am Ende von Phase 0 liegt vor:
- **ADR-001** „Build vs Fork" — die Entscheidung mit Begründung
- **ADR-002** „Positionierung" — interne vs. public + Skalierungs-Konsequenzen
- **ADR-003** „UI-Stack" — Ergebnis aus Spike 0.3
- 3 Spike-Reports (kurz, je ≤ 2 Seiten)
- agent-config-PR-Skizze
- **Aktualisierter §17-Phasen-Plan** — möglicherweise grundlegend anders, abhängig von 0.1

**Wenn Phase 0 zum Fork-Pfad führt, ist der Rest dieses Plans nicht weggeworfen** — die meisten Architektur-, Permission-, Cost- und agent-config-Sektionen sind Fork-agnostisch und beschreiben das, was wir auch in einem Fork bauen würden.

---

## 1. Executive Summary

Wir bauen einen **nativen IDE-Host für `@event4u/agent-config`**. Sekundär — als Mittel zum Zweck — ein vollwertiger Coding-Agent, weil agent-config ohne Runtime keinen Wert hat. Vorbild für UX und Features ist Augment Code; Vorbild für IDE-Tiefe und Bundle-Größe ist SweepAI.

Wesentliche Eigenschaften:

- **Cross-IDE**: JetBrains *und* VS Code aus einer geteilten Codebasis.
- **agent-config-first**: Skills (~219), Rules (~75), Commands (~136), Personas (~24) sind first-class, nicht Add-on. Das Plugin steht in der „Supported tools"-Tabelle als ✅, nicht 📌.
- **LLM-agnostisch** im Dual-Mode (API *und* CLI-Subscription pro Modell).
- **Volle Cost-Transparenz** auf 4 Ebenen, inklusive Shadow-API-Cost für Subscription-Modi.
- **Bewusster Verzicht** auf eigenes Cloud-Backend in v1.0 — wir replizieren Augments Features, nicht Augments Cloud.

Die Architektur folgt dem etablierten Muster *thin IDE client + headless agent core* (wie Cody, Continue.dev, Cline): TypeScript-Agent-Core als Sidecar, zwei dünne Clients (Kotlin für JetBrains, TypeScript für VS Code).

**Lieferzeitfenster (ehrlich, bei einem Entwickler in Vollzeit, Neu-Bau-Pfad):**

| Stufe | Zeitfenster (kalendarisch, inkl. realistischem Puffer) | Demo-Ziel |
|---|---|---|
| **Phase 0** | 2 Wochen | ADRs + 3 Spikes — siehe §0 |
| **MVP** | 14–16 Wochen (13 Wochen reine Sprint-Zeit + 1–3 Wochen Puffer) | Chat + Single-File-Edit mit Approval, Anthropic-API + Claude-CLI, **mindestens 1 agent-config-Command live**, Stop-Button funktional |
| **v1.0** | weitere 6,5–7,5 Monate (Sprint 5–15 = 27 Wochen Sprint-Zeit + Puffer-Sprint 15) | Internal alpha, dogfood-fähig, Marketplace-ready |
| **v1.5 public beta** | weitere 12 Wochen (nur falls Positionierung B/C) | Marketplace-Submission |

**Gesamtdauer bis Marketplace-Submission (falls relevant): 12–14 Monate** ab Phase-0-Start, inkl. realistischer Puffer.

Der **ältere Zeitplan (10–12 Wochen für MVP, 6 Monate für v1.0)** war optimistisch um Faktor 2. Continue.dev brauchte mit 4–6 Leuten ~12 Monate für vergleichbaren Scope; ein Solo-Entwickler in 8 Wochen schafft realistisch 30–40 % davon. Mit Fork-Pfad halbieren sich die Zahlen oben.

**Wartungs-Annahme:** Die geteilte Architektur halbiert die Wartungslast gegenüber zwei unabhängigen Plugins — gilt aber nur, wenn der Sidecar das Cross-IDE-Sharing wirklich trägt; Phase 0 muss das per Spike 0.3 bestätigen.

---

## 2. Ziele & Non-Goals

### 2.1 Ziele

| Ziel | Begründung |
|---|---|
| **Erstklassiger IDE-Host für `@event4u/agent-config`** | Skills, Rules, Commands und Personas sind kuratiertes Domain-Wissen — das Plugin macht sie in PhpStorm/IntelliJ und VS Code nutzbar. Das ist der primäre Existenzgrund. |
| **Auf event4u-Codebases bessere Antworten als generische Plugins** (durch Kombination von solidem lokalen Retrieval + agent-config-Skills/Rules) | Für event4u-Repos ist dieses Plugin *besser* als Augment, weil wir kuratiertes Domain-Wissen haben statt es raten zu müssen. Für Random-Repos sind wir ungefähr gleich. |
| Cross-IDE (PhpStorm + VS Code) | Galawork/event4u-Team nutzt beide IDEs |
| **Dual-Mode-Provider:** API + CLI pro Modell, frei toggleable | Existierende Subscriptions (Claude Pro/Max, ChatGPT Plus, Gemini) nutzbar machen — günstiger als API. **Unser Differenzierungsmerkmal Nr. 2.** |
| **Volle Token- & Cost-Transparenz** auf jeder Ebene (Step / Request / Conversation / Session / Daily / Monthly), inkl. Shadow-API-Cost im CLI-Mode | Keine negativen Überraschungen. **Differenzierungsmerkmal Nr. 3** — niemand sonst zeigt Shadow-API-Cost. |
| LLM-Provider-frei wählbar | Vermeidet Vendor-Lock-in, ermöglicht günstigere/private Modelle |
| Solides lokales Retrieval (Tree-sitter + Hybrid BM25/Vector) ohne Cloud-Komponente | Privacy, kein Backend in v1.0. Bewusster Trade-off gegen Cloud-augmented Engines wie Augments (siehe §11.0 — Non-Goals der Context Engine) |
| **SweepAI-Niveau bei IDE-Tiefe** (Intention Actions, Right-Click, Find Action, ergonomische Shortcuts) — ab v1.0, nicht MVP | Native IDE-Integration ist Sweeps USP; Augments Webview wirkt „fremd" in JetBrains. Wir bauen das **nicht** im MVP — siehe §7.1. |
| Plugin-Größe ≤ 30 MB | Augment: 153 MB. SweepAI: 15 MB. Wir wollen näher an Sweep liegen. |
| Open-Source / Mono-Repo (MIT) | Konsistent mit `agent-config`, erleichtert interne Beiträge |

### 2.2 Non-Goals (bewusst NICHT in v1.0)

- **Generisches Coding-Agent-Plugin in Konkurrenz zu Continue.dev / Cline / Cody.** Wenn das das Ziel wäre, würden wir Continue.dev forken und nicht neu bauen. Unser Existenzgrund ist agent-config — das Plugin ist primär ein **Host für domain-spezifisches Wissen**.
- **Augment-Niveau bei Cloud-augmented Context Engine.** Augments USP ist 2+ Jahre ML-Arbeit auf eigenem Backend mit cross-user, cross-repo Signalen. Replizierbar nur mit eigenem Backend — bewusster Non-Goal in v1.0. Siehe §11.0.
- **Zentrales Gedächtnis im Sinne eines server-seitigen Indexes oder Cross-Repo-Vektor-Sharings.** Cross-Repo-Wissen kommt bei uns über kuratierte agent-config-Rules, nicht über impliziten ML-Transfer.
- **Hosted Service / eigenes Cloud-Backend.** Provider-Calls laufen direkt vom Client (oder über einen optionalen lokalen Sidecar). Self-hosted Team-Backend kommt frühestens v2.0 (siehe §7.4).
- **Inline-Autocomplete (Ghost-Text).** Augments „next-token completion" ist ein separates ML-Produkt. v1.0 fokussiert auf Chat + Agent-Mode. Autocomplete in v1.5+ über Codestral / Qwen-Coder.
- **Eigene Embedding-Modelle.** Wir lehnen uns an bestehende lokale Embeddings (BGE, lokal via ONNX) an.
- **Reverse-Engineering eines kommerziellen Closed-Source-Produkts.** Wir replizieren *Features* aus public sources (Plugin-Manifests, Docs, UX-Screenshots), nicht *Code*. Augments JARs werden zum Architektur-Verständnis inspiziert, keine Originalsourcen übernommen.
- **Enterprise-Features** (SSO, Audit-Log-Server, Org-Policy-Dashboard): tracked in `agent-config`s eigenem „Organization Mode"-Backlog, kommt erst nach Customer-Validation.

### 2.3 Erwartungs-Management gegenüber dem Team

Wenn jemand fragt „Bauen wir ein eigenes Augment?", ist die ehrliche Antwort:

> Nein. Wir bauen einen **IDE-Host für unsere eigenen agent-config-Skills**, der auf event4u-Codebases dank kuratiertem Domain-Wissen sinnvollere Antworten gibt als ein generisches Plugin. Auf einem Random-Repo (z. B. ein Open-Source-Projekt, das wir noch nie gesehen haben) sind wir technisch ungefähr auf Cline-/Continue-Niveau — ohne Cloud-Backend strukturell unterlegen gegenüber Augments großer Indexing-Pipeline. Das ist Absicht.

Diese Klarstellung gehört ins README, in den Marketplace-Eintrag (falls Public) und in interne Pitch-Decks.

---

## 3. Referenz — was Augment Code macht

> **Diese Sektion ist verifiziert.** Sie basiert auf der direkten Analyse des installierten Plugins Version `0.466.6-stable` (Mai 2026): plugin.xml-Manifest, dekomprimierte JAR-Klassennamen, gebundelte Sidecar-Binary, Webview-Assets und Protobuf-Module. Speculativer Inhalt war in einer früheren Plan-Version — wurde durch die jetzigen Fakten ersetzt.

### 3.1 Augment-Feature-Set (verifiziert, aus plugin.xml + Klassennamen)

| Feature | Beschreibung | Plugin-Relevanz |
|---|---|---|
| **Chat Panel** | Tool Window "Augment" (rechts), JBCef-Webview hosting acp-panel.html | Muss-Feature, MVP |
| **Agent Mode** | Mehrstufige Task-Ausführung mit `AgentSessionEvent` + Checkpoints | Muss-Feature, MVP |
| **Context Engine** | `AgentCodebaseRetrievalRequest` — eigenes RPC, local + cloud-augmented | Muss-Feature, MVP-Subset |
| **Multi-File Edits** | `libedit_proto` Domain mit Exchange / GitDiffFileInfo | Muss-Feature, MVP |
| **Inline Completions** | `AugmentCompletionProvider` als `inline.completion.provider order="first"` | v1.5+ (in Augment seit v1) |
| **Memories** | `ChatResultAgentMemory` — Memories werden vom Result zurückgegeben | v1.0 |
| **MCP-Tools** | First-class incl. OAuth + Refresh-Tokens + Tool Search | v1.0 |
| **Codebase-aware refactoring** | Cross-File via Context Engine + `libnext_edit_proto` | v1.0–v2.0 |
| **Terminal Integration** | `TerminalInfo` proto + `depends>org.jetbrains.plugins.terminal</depends>` | v1.0, mit Permission-Gate |
| **Diff Preview vor Apply** | `SmartPasteDiffExtension` + Standard-IntelliJ-Diff | Muss-Feature, MVP |
| **Cost Display** | `ChatResultTokenUsage` + `ChatResultBillingMetadata` | v1.0 |
| **Conversation Forking** | Editieren einer früheren Nachricht erzeugt Branch | v1.0 (Changelog 0.466.6) |
| **Checkpoints** | `CheckpointBlobsRequest/Response` — Conversation-State-Snapshots | v1.0 |
| **Smart Paste** | Diff-View bei Paste in Editor | v1.0 |
| **KaTeX + Mermaid** | Math + Diagrams im Chat | v1.0 |
| **Tool Safety** | `CheckToolSafety` — Tool-Call-Safety-Classifier | v1.0 |
| **Hooks** | sessionStart/End/Stop in `HooksConfig` | v1.0 (passt zu agent-config Hooks) |
| **Native Integrations** | Atlassian, GitHub, Linear, Notion, Slack — als ExtraToolInput-Subclasses | v1.5+ |
| **BYOK** | Direkter Provider-Call: Anthropic, OpenAI, AWS Bedrock | MVP |
| **Conversation Recovery** | Wiederherstellung aus Backend nach Disconnect | v1.0 (optional ohne Backend) |
| **Bulk Thread Delete** | Confirm-Dialog ab 300 Conversations | v1.0 |

### 3.2 Augment-Architektur (verifiziert aus JAR)

```
┌────────────────────────────────────────────────────────────────────┐
│                          JetBrains IDE                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Kotlin Plugin (com.augmentcode.intellij)                    │  │
│  │  • ToolWindow: "Augment" (right anchor)                      │  │
│  │    └── JBCef Webview → acp-panel.html (Vite SPA, 525 assets) │  │
│  │  • Inline Completion Provider (order="first")                │  │
│  │  • VFS Listener, Editor Listeners, Smart-Paste Diff Ext.     │  │
│  │  • OAuth Callback Handlers (Augment + MCP OAuth)             │  │
│  │  • Status Bar Widget, Settings Configurable                  │  │
│  │  • FileBasedIndex (com.intellij)                             │  │
│  └────────────────────────┬─────────────────────────────────────┘  │
│                           │ JSON-RPC (vscode-jsonrpc Pattern)       │
│  ┌────────────────────────▼─────────────────────────────────────┐  │
│  │  Node.js Sidecar (sidecar/index.cjs, 6.2 MB bundled)         │  │
│  │  • LevelDB store (classic-level mit native prebuilds)        │  │
│  │  • Context Engine, Embeddings, Retrieval                     │  │
│  │  • Cloud-Backend-Client                                      │  │
│  └────────────────────────┬─────────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────────┘
                            │ gRPC + Connect-Web (Kotlin Client)
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│         Augment Cloud Backend (Bazel-built Java/Kotlin)            │
│  • intake_service              (Eintritts-RPC)                     │
│  • repository_allowlist_service                                    │
│  • settings_webview_communication                                  │
│  • shredder + shredder_admin   (GDPR / Datenlöschung)              │
│  • tenant_watcher              (Multi-Tenant SaaS)                 │
│  • fraud_guard                 (Missbrauchserkennung)              │
│  • metering + subscription     (Billing)                           │
│  • supabase                    (vermutlich Backend-DB)             │
│  • glean                       (vermutlich Code-Suche/Analyse)     │
└────────────────────────────────────────────────────────────────────┘
```

**Quellenangabe für jede Komponente** (alle direkt aus dem JAR):
- ToolWindow: `<toolWindow id="Augment" factoryClass="com.augmentcode.intellij.chat.AugmentChatToolWindowFactory"/>`
- Inline Completion: `<inline.completion.provider order="first" .../>`
- Webview: `webviews/acp-panel.html` (Vite-SPA mit Monaco Editor v0.52.2)
- Sidecar Start: `<postStartupActivity implementation="com.augmentcode.intellij.sidecar.SidecarStartupActivity"/>`
- Sidecar Bundle: `sidecar/index.cjs` (6.219.837 Bytes), native prebuilds für darwin-x64+arm64, linux-x64/arm/arm64, win32-ia32/x64
- gRPC: `grpc_runtime_bundle_deploy.jar`, `intellij_protos_deploy.jar` (27 MB protos), `connect-kotlin-*.jar`
- BYOK: `com.augmentcode.intellij.byok.*` — direkter Provider-Call ohne Cloud-Roundtrip
- Hooks: `com.augmentcode.intellij.hooks.HooksConfig`, `HooksMessaging`

#### Tech-Stack-Bestätigung (aus plugin.xml + JAR-Manifest)

| Komponente | Technologie |
|---|---|
| Plugin-Sprache | Kotlin 2.2.21 |
| IntelliJ Compat | `since-build="242"` bis `until-build="262.99999"` (2024.2 – 2026.2) |
| Build-System | Bazel (`_deploy.jar`-Naming, `aspect_rules_js`) |
| HTTP Client | Ktor 2.3.12 + OkHttp 5.3.0 |
| RPC | gRPC + Connect-Kotlin 0.7.4 (Buf Connect-Protokoll über HTTP/2) |
| Protobuf | protobuf-java/kotlin 4.31.1 |
| JSON | Gson 2.10.1 + Moshi 1.15.2 |
| Error Reporting | Sentry 8.12.0 |
| Cache | Caffeine 3.1.8 |
| Sidecar Runtime | Node.js (bundled — kein User-Install nötig) |
| Sidecar Storage | classic-level (LevelDB) |
| Webview-Engine | JBCef (JetBrains Chromium Embedded Framework) |
| Webview-Framework | Vite-gebaute SPA (525 Assets) |
| Code-Editor im Webview | Monaco Editor 0.52.2 (von cdnjs CDN) |

**Was wir mit dieser Erkenntnis machen** (siehe §5.3): Augments Cloud-Anteil wegschneiden, optional machen. Sidecar-Pattern übernehmen. Webview *selektiv* statt überall (siehe §5.3 Hybrid-Stack-Entscheidung).

### 3.3 UX-Patterns von Augment, die wir übernehmen

- Ein einziges Tool-Window mit Tabs: Chat, Tasks, Memories, Logs.
- Inline-Diff-Preview mit Akzeptieren/Ablehnen pro Hunk.
- „/" als Slash-Command-Trigger im Chat-Input (genau wie `agent-config` Commands).
- Statusbar-Icon für Modell-Wahl + Token-Cost-Display.
- Keyboard-Shortcut für „Ask about selection" (markierter Code → Chat).
- Settings-Page direkt im Tool Window (deep-links zu Sub-Sektionen).
- Workspace-Guidelines als editierbare Datei.
- Hooks für sessionStart/End/Stop.

---

### 3.5 Referenz — SweepAI als zweite Inspirationsquelle

> Plugin-ID: `dev.sweep.assistant.cloud`, Version `1.29.3`. Analyse aus dem installierten JAR unter `/agent-plugin/sweepai/lib/jetbrains-1.29.3.jar`.

#### 3.5.1 Verifizierte SweepAI-Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                    JetBrains IDE                             │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Sweep Plugin (Pure Kotlin — kein Sidecar)           │    │
│  │  • ToolWindow "Sweep AI" (right, canCloseContents)   │    │
│  │  • Native Swing-/Kotlin-UI (kein Webview!)           │    │
│  │  • AnthropicClient direkt in JVM                     │    │
│  │  • SweepAgent + SweepAgentManager + SweepAgentSession│    │
│  │  • MCP via offiziellem kotlin-sdk-client             │    │
│  │  • Tools: 19 Stück native Kotlin                     │    │
│  │  • SQLite (sqlite-jdbc) für lokalen State            │    │
│  │  • jgit 6.7 für direkte Git-Ops                      │    │
│  │  • CommonMark-Renderer (kein Monaco)                 │    │
│  │  • Intention Action (Alt+Enter More-Actions)         │    │
│  │  • Right-Click EditorPopupMenu Group                 │    │
│  │  • Floating Code Toolbar Integration                 │    │
│  └──────────────────────────────────────────────────────┘    │
└────────────────────────────┬─────────────────────────────────┘
                             │ Direkter HTTP-Call (OkHttp / Ktor)
                             ▼
              ┌──────────────────────────────┐
              │   Anthropic API direkt       │
              │   + Sweep-Cloud (BYO-Backend)│
              └──────────────────────────────┘
```

#### 3.5.2 Vergleich Augment vs SweepAI (was wir lernen)

| Aspekt | Augment Code | SweepAI | Unsere Wahl |
|---|---|---|---|
| **Tech-Stack** | Kotlin Plugin + Node.js Sidecar (153 MB) | Pure Kotlin (15 MB) | Pure Kotlin Core + optionaler Sidecar nur falls nötig |
| **UI-Engine** | JBCef Webview + Vite SPA + Monaco | Native Swing/Kotlin + CommonMark | **Hybrid:** Kotlin-UI für Performance + JBCef für komplexe Views (Settings, Diagramme) |
| **Markdown** | KaTeX + Mermaid in Webview | CommonMark renderer in Kotlin | CommonMark + KaTeX/Mermaid optional |
| **Storage** | LevelDB (classic-level) | SQLite (sqlite-jdbc) | **SQLite** — JVM-nativ, kein NPM-Dep |
| **Git** | unklar (vermutlich via Sidecar) | jgit direkt in Kotlin | jgit direkt |
| **Provider** | Augment-Backend + BYOK (Anthropic, OpenAI, AWS Bedrock) | Sweep-Backend + BYOK (über BYOKProviderConfig) | Vollständig BYO — kein eigenes Backend |
| **MCP** | Eigene Implementation in Sidecar | Offizielle `kotlin-sdk-client` (Anthropic) | **Offizielles Kotlin SDK** |
| **Inline-Edit** | "Smart Paste" diff extension | **`Ctrl+I` Prompt Bar** mit Selection-Edit | SweepAI-Style Prompt Bar |
| **Chat-Shortcut** | `Ctrl+Alt+I` / `Cmd+Ctrl+I` | `Ctrl+J` / `Cmd+J` (eleganter, leichter zu drücken) | `Cmd+J` |
| **Autocomplete** | Next-Token via Sidecar | "Next-Edit" Autocomplete (USP von Sweep) | Beides als Optionen ab v1.5 |
| **Diff-Acceptance** | Webview-basiert | `Ctrl+Y` accept, `Ctrl+N` reject, `Ctrl+Enter` accept-all, `Ctrl+Shift+Backspace` reject-all | SweepAI-Shortcuts übernehmen |
| **Navigation in Changes** | nicht prominent | `Alt+L` go-to-changes, `Alt+J/K` scroll-next/prev | Übernehmen |
| **Right-Click Integration** | nicht ausgeprägt | `EditorPopupMenu` + `Floating.CodeToolbar` Groups | Übernehmen |
| **Intention Actions** | nicht in plugin.xml | `SweepFixIntentionAction` für Alt+Enter | Übernehmen |
| **Find Action** | nicht prominent | `FindActionInitializer` — Plugin-Actions in Find-Action | Übernehmen |
| **PR Review** | nicht in plugin.xml gefunden | `ReviewPRAction` integriert | v1.0 |
| **Custom Prompts** | nicht prominent | `CustomPrompt` + `AddCustomPromptAction` | v1.0 |
| **Background Bash** | nicht prominent | `BackgroundBashExecutor` mit Transcript-Copy | v1.0 |
| **Bash Auto-Approve** | per Permission-Gate | `BashAutoApproveMode` mit Modes | Modes übernehmen |
| **Todo-Tool** | nicht in Tool-Liste sichtbar | `TodoWriteTool` als first-class | Übernehmen |
| **Action Plan** | nicht sichtbar | `UpdateActionPlanTool` + `ActionPlanToolCallItem` UI | Übernehmen |
| **Prompt Compression** | unklar | `PromptCrunchingTool` (eigenes Tool) | Übernehmen |
| **GitHub Auth** | OAuth Callback | `GitHubAuthHandler` Token-Input-Dialog | Beide Wege anbieten |
| **Memory Estimation** | nicht sichtbar | `EstimateTabMemoryAction` (Dev Mode) | Übernehmen |
| **Streaming Diffs** | Smart-Paste-Style | Streamed file modifications (Changelog 1.29.3) | Übernehmen |
| **Settings Tools/Page** | Webview-Multi-Section | `SweepSettingsConfigurable` IntelliJ-nativ | **Beides:** IntelliJ-native Configurable + In-Panel Settings für komplexe Sektionen |
| **Plugin-Größe** | 153 MB | 15 MB | Ziel: ≤30 MB |

#### 3.5.3 SweepAI Tool-Set (vollständig, 19 native Kotlin-Tools)

```kotlin
ApplyPatchTool          // strukturierter Patch-Apply (mit Parser, Chunk, DiffError)
BackgroundBashExecutor  // langlaufende Bash-Prozesse im Hintergrund
BashTool                // Foreground-Bash-Ausführung
CreateFileTool          // neue Datei erstellen
FindUsagesTool          // IntelliJ Find-Usages programmatisch nutzen
GetErrorsTool           // Compile-/Inspection-Fehler aus IntelliJ holen
GlobTool                // Glob-Pattern Datei-Suche
ListFilesTool           // Verzeichnis-Listing
McpTool                 // Generischer MCP-Tool-Adapter
MultiStringReplaceTool  // Multi-Replace in einer Datei
NotebookEditTool        // Jupyter-Notebook editieren (.ipynb)
PromptCrunchingTool     // Prompt-Komprimierung
ReadFileTool            // Datei lesen mit Range
SearchFilesTool         // ripgrep-ähnliche Inhaltssuche
SkillTool               // Skills als Tools nutzen
StringReplaceTool       // Einfacher String-Replace
TodoWriteTool           // Persistente Todo-Liste
UpdateActionPlanTool    // Action-Plan aktualisieren (UI rendert das)
WebFetchTool            // URL fetchen
WebSearchTool           // Web-Search via Provider
```

`SkillTool` ist besonders wichtig: SweepAI nutzt agent-config-Skills bereits als Tools. Wir übernehmen das.

#### 3.5.4 SweepAI Shortcut-Set (1:1 ergonomisch geprüft, alle aus plugin.xml)

| Aktion | Shortcut Mac | Shortcut Win/Lin |
|---|---|---|
| Open New Chat | `⌘ J` | `Ctrl+J` |
| Add Selection to Chat | `⌘ ⇧ J` | `Ctrl+Shift+J` |
| New Inline Edit (Prompt Bar) | `⌘ I` | `Ctrl+I` |
| Accept Autocomplete | `Tab` | `Tab` |
| Reject Autocomplete | `Esc` | `Esc` |
| Show Last Rejected Suggestion | `⌥ ⇧ ⌫` | `Alt+Shift+Backspace` |
| Accept Single Change | `⌘ Y` | `Ctrl+Y` |
| Reject Single Change | `⌘ N` (wird mit New-Chat-Konflikt überschrieben) | `Ctrl+N` |
| Accept All Changes in File | `⌘ Enter` | `Ctrl+Enter` |
| Reject All Changes in File | `⌘ ⇧ ⌫` | `Ctrl+Shift+Backspace` |
| Go to File with Changes | `⌥ L` | `Alt+L` |
| Scroll to Next Change | `⌥ J` | `Alt+J` |
| Scroll to Previous Change | `⌥ K` | `Alt+K` |

> Hinweis: Sweep hat einen Konflikt zwischen `Ctrl+N` (Reject Change vs New Chat). Wir lösen das in unserem Plugin sauber auf.

---

## 4. Referenz — agent-config als Grundlage

`@event4u/agent-config` (siehe Repo unter `~/projects/galawork/galawork-packages/event4u/agent-config`) ist **kein Runtime** und kein LLM-Dispatcher. Es ist ein **Content-Layer**:

- **Skills** (~219): SKILL.md-Dateien mit YAML-Frontmatter (Agentskills.io-Spec) — strukturierte Expertise on demand.
- **Rules** (~75): Always-active behavior constraints.
- **Commands** (~136): Slash-Command-Workflows (`/work`, `/implement-ticket`, `/commit`, `/create-pr`, …).
- **Personas** (~24): Review-Lenses.
- **Guidelines** (~73): Coding-Konventionen pro Sprache.

### 4.1 Wie agent-config projiziert wird

```
.agent-src.uncompressed/   # Source-of-truth (Maintainer-Repo)
       │ Pipeline A
       ▼
.agent-src/                # Compiled, shipped via npm
       │
       ├─ Pipeline B ──▶  .augment/                      # Augment-CLI + IDE
       │
       ├─ Pipeline C ──▶  .claude/ .cursor/ .clinerules/ .windsurfrules GEMINI.md
       │
       └─ Pipeline D ──▶  dist/cloud/<skill>.zip         # Claude.ai-Bundle
```

**Unser Plugin braucht einen eigenen Projection-Pfad — entweder konsumieren wir `.augment/` direkt (Augment-Marker re-purpose) oder wir bekommen einen eigenen Namespace (`.event4u-agent/`).** Empfehlung: eigener Namespace, weil das langfristig sauberer ist und Augment-Plugin parallel installiert sein kann.

### 4.2 SKILL.md-Format (Beispiel-Auszug)

```yaml
---
name: api-design
description: Use when designing APIs ...
personas: [backend-architect]
source: package
domain: engineering
lifecycle: active
trust:
  level: core
  confidence: high
install:
  default: true
  removable: false
---

# api-design

## When to use ...
## Procedure ...
```

### 4.3 Tech-Stack-Hinweise aus agent-config

- **CLI**: TypeScript (Commander, Zod, Fastify für lokalen UI-Server, Preact für UI).
- **Build-Scripts**: Python 3.10+.
- **Distribution**: npm-only via `npx @event4u/agent-config`.
- **MCP-Server**: bereits vorhanden (Lite hostable auf Cloudflare Workers; Full lokal stdio).
- **Settings-Datei**: `.agent-settings.yml` mit `agent_config_version`-Pin.

### 4.4 Was unser Plugin von `agent-config` *erbt*

| Übernehmen | Warum |
|---|---|
| YAML-Frontmatter-Format für Skills/Rules/Commands | Wir wären sonst nicht kompatibel |
| `.agent-settings.yml`-Konsumption | Single Source of Truth für Konfiguration |
| MCP-Server-Anbindung | Skills + Commands über MCP statt erneut implementieren |
| `agent_config_version`-Pin-Mechanik | Versionskonflikte vermeiden |
| Trust-Level-Konzept (`core` / `community` / `experimental`) | Sicherheits-Floor |
| Hard-Floor- und Permission-Gate-Konzept | Direkte Übernahme in Tool-Permissions |

### 4.5 Was unser Plugin *neu* baut

| Komponente | Warum |
|---|---|
| Agent Loop (multi-step orchestration) | agent-config ist explizit kein Runtime |
| LLM Provider Abstraction | gibt es in agent-config nicht (wird vom Host-Tool erwartet) |
| Tool Calling (file ops, terminal) | nicht in agent-config |
| Context Engine (Indexing, Retrieval) | nicht in agent-config |
| IDE-UI (Chat, Diff Viewer) | nicht in agent-config |

---

## 5. Zielarchitektur

### 5.1 High-Level

```
┌─────────────────────────────────────────────────────────────────┐
│                          JetBrains IDE                          │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ JetBrains Client (Kotlin)                           │        │
│  │  • Tool Window UI (Compose Multiplatform / Swing)   │        │
│  │  • File Watcher, Editor Hooks                       │        │
│  │  • Diff Preview / Apply                             │        │
│  └─────────────────────────┬───────────────────────────┘        │
└────────────────────────────┼────────────────────────────────────┘
                             │ JSON-RPC over stdio/TCP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│             event4u-agent core (Node.js sidecar)                │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ Agent Loop                                          │        │
│  │  • Phase machine (plan → edit → test → verify)      │        │
│  │  • Tool calls (file, shell, web)                    │        │
│  │  • Halt protocol, scope control                     │        │
│  └─────────────────────────────────────────────────────┘        │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ LLM Provider Layer                                  │        │
│  │  • Anthropic · OpenAI · OpenAI-compat · Ollama      │        │
│  │  • Custom HTTP endpoints                            │        │
│  │  • Streaming, cost accounting                       │        │
│  └─────────────────────────────────────────────────────┘        │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ Context Engine                                      │        │
│  │  • Tree-sitter AST + symbol index                   │        │
│  │  • Embedding store (sqlite-vec or LanceDB)          │        │
│  │  • Retrieval (BM25 + vector hybrid)                 │        │
│  └─────────────────────────────────────────────────────┘        │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ agent-config Adapter                                │        │
│  │  • Liest .agent-settings.yml                        │        │
│  │  • Lädt Skills/Rules/Commands aus .agent-src/       │        │
│  │  • Spricht MCP-Server (Lite/Full)                   │        │
│  └─────────────────────────────────────────────────────┘        │
└────────────────────────────┬────────────────────────────────────┘
                             │ JSON-RPC over stdio/TCP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Visual Studio Code                        │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ VS Code Client (TypeScript)                         │        │
│  │  • Webview Panel (Preact / React)                   │        │
│  │  • Editor API Hooks                                 │        │
│  │  • Diff Preview / Apply                             │        │
│  └─────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Warum *Sidecar + Thin Client*?

Etabliertes Muster bei Cody, Continue.dev (teilweise), Cline (vs-only), Sourcegraph: ein gemeinsamer „Agent Core" in TypeScript, der als Subprozess von der IDE gestartet wird und via JSON-RPC kommuniziert. Vorteile:

- **Single source of truth** für Agent-Logik, LLM-Provider, Context-Engine.
- **Reduzierte Cross-IDE-Duplikation** — nur UI ist pro IDE neu zu bauen.
- **Einfacher zu testen** (Core wird headless getestet).
- **VS-Code-Extensibility** ohne IPC-Overhead (Core und Extension teilen sich Node-Runtime).
- **Updates** der Core-Logik unabhängig vom IDE-Plugin (npm-Release vs. Marketplace-Release).

### 5.3 Alternativen-Bewertung

| Ansatz | Pro | Contra | Entscheidung |
|---|---|---|---|
| **Sidecar + Thin Client (gewählt)** | Cross-IDE-Code-Sharing, Bewährtes Pattern (Augment-Modell) | Extra-Prozess, JSON-RPC-Latenz, größeres Bundle | ✅ (mit Caveat) |
| **Pure Kotlin (SweepAI-Modell)** für JetBrains, separater TS-Stack für VS Code | Sehr kleines Bundle (15 MB möglich), tiefe IDE-Integration, kein Sidecar | Massive Codeverdopplung | ❌ |
| Native Kotlin + Native TS, kein Sharing | Performanteste UI pro IDE | Massive Codeverdopplung | ❌ |
| LSP (Language Server Protocol) | Standard-Protokoll | LSP ist für Sprachserver, nicht Agents — passt nicht 1:1 | ❌ |
| Tauri / WebView überall | UI-Sharing | JetBrains-Integration mau, kein Editor-API | ❌ |
| WebAssembly-Core | Single runtime in beiden IDEs | Tooling unreif für Node-Workloads | ❌ |

**Caveat zur Sidecar-Entscheidung:** SweepAI zeigt eindrucksvoll, dass „Pure Kotlin"-Plugins mit ~15 MB möglich sind und ergonomischer in JetBrains integriert sind (Intention Actions, Right-Click, Find-Action). Augments Webview-Architektur wirkt „fremd" in JetBrains und ist 10× größer. **Unser Kompromiss:**

- Agent-Core, Provider-Layer, Context-Engine, Tracking → **TS-Sidecar** (cross-IDE Code-Sharing, weil VS Code Node-nativ ist)
- JetBrains-Client-UI → **Pure Kotlin Swing/JBCef-Hybrid**: einfache Chat-Komponenten Kotlin-nativ, Cost-Dashboard und Settings als JBCef-Webview (nur dort wo komplexe HTML-Rendering Sinn macht — Charts, Markdown mit KaTeX/Mermaid)
- Intention-Actions, Right-Click-Menus, Status-Bar-Widget, File-Indexer → **immer Kotlin-nativ** (sonst geht IDE-Tiefe verloren)

Damit haben wir ein Bundle-Ziel von ~30 MB (Plugin + Sidecar) — doppelt so groß wie Sweep, ein Fünftel von Augment. Cross-IDE-Code-Sharing bleibt erhalten, IDE-Tiefe auch.

---

## 6. Tech-Stack & Repository-Layout

### 6.1 Tech-Stack

| Komponente | Stack |
|---|---|
| **Agent Core** | TypeScript 5.x, Node.js ≥20, tsx/tsc, Vitest |
| **JetBrains Client** | Kotlin 1.9, IntelliJ Platform SDK 2024.1+, Gradle (intellij-platform-gradle-plugin v2), Compose Multiplatform für UI (oder Swing-Fallback) |
| **VS Code Client** | TypeScript, VS Code Extension API, Webview mit Preact (konsistent mit `agent-config` UI) |
| **Embeddings** | `@xenova/transformers` (ONNX runtime, lokal) — Default; optional Voyage/OpenAI Embeddings remote |
| **Vector Store** | `sqlite-vec` (SQLite-Erweiterung, zero-dep) |
| **AST/Symbole** | `web-tree-sitter` (offizielle Tree-Sitter-WASM-Bindings) |
| **JSON-RPC** | `vscode-jsonrpc` (gleicher Code-Pfad wie LSP-Tools) |
| **MCP-Client** | `@modelcontextprotocol/sdk` |
| **Schema-Validation** | Zod (konsistent mit agent-config) |
| **Logging** | `pino` mit File-Sink in `agents/runtime/state/` |
| **CI** | GitHub Actions (matrix: ubuntu/macos/win × node 20/22) |
| **Linter** | ESLint + Prettier (TS), Detekt + ktlint (Kotlin) |

### 6.2 Repository-Layout (Mono-Repo)

```
event4u-agent/
├── README.md
├── PLAN.md                  # dieses Dokument
├── LICENSE                  # MIT
├── CHANGELOG.md
├── package.json             # workspaces root
├── pnpm-workspace.yaml      # oder npm workspaces
├── tsconfig.base.json
├── Taskfile.yml             # konsistent mit agent-config
│
├── packages/
│   ├── core/                # Agent Core (Sidecar, Node)
│   │   ├── src/
│   │   │   ├── agent/           # Agent loop, phase machine
│   │   │   ├── llm/             # Provider implementations
│   │   │   ├── context/         # Indexer, retriever, embedder
│   │   │   ├── tools/           # File, shell, web, MCP tools
│   │   │   ├── config/          # agent-config adapter, .agent-settings.yml reader
│   │   │   ├── protocol/        # JSON-RPC schema (shared with clients)
│   │   │   ├── memory/          # @event4u/agent-memory adapter
│   │   │   └── server.ts        # Entry point
│   │   └── package.json
│   │
│   ├── protocol/            # Shared JSON-RPC types (TS + Kotlin codegen)
│   │   ├── schema.ts
│   │   └── codegen/         # generates Kotlin DTOs from Zod schemas
│   │
│   └── shared/              # Shared utilities (UI primitives, logger)
│
├── clients/
│   ├── jetbrains/           # IntelliJ Platform plugin
│   │   ├── build.gradle.kts
│   │   ├── src/main/kotlin/app/event4u/agent/
│   │   │   ├── toolwindow/      # Chat tool window
│   │   │   ├── diff/            # Diff preview & apply
│   │   │   ├── sidecar/         # Process management, JSON-RPC client
│   │   │   ├── actions/         # Editor actions (Ask about selection, …)
│   │   │   └── settings/        # Settings page
│   │   └── src/main/resources/META-INF/plugin.xml
│   │
│   └── vscode/              # VS Code extension
│       ├── package.json
│       ├── src/
│       │   ├── extension.ts
│       │   ├── webview/         # Preact UI
│       │   ├── sidecar.ts       # spawns core
│       │   └── commands.ts
│       └── webpack.config.js
│
├── scripts/
│   ├── codegen.ts           # generates Kotlin DTOs from Zod
│   └── package.sh           # builds .jar + .vsix
│
└── docs/
    ├── architecture.md
    ├── contributing.md
    ├── adr/                 # Architecture Decision Records
    └── contracts/
        ├── json-rpc-protocol.md
        ├── agent-config-integration.md
        └── tool-permissions.md
```

### 6.3 Mono-Repo Rationale

- **Atomic refactors** über Core ↔ Protocol ↔ Client möglich.
- **Codegen** für Kotlin-Typen aus dem Zod-Schema läuft lokal im selben Repo.
- **Shared Versioning** (alle Packages tragen dieselbe Version, Releases sind koordiniert).
- **CI-Workflow** kann mit Matrix-Strategie alle drei Targets parallel bauen.

---

## 7. Feature-Roadmap

> **Vorbemerkung — schmaler MVP-Scope:** Der ältere Plan packte SweepAI-Style Inline-Edit, Intention Actions, Codex-CLI-Backend, Pre-flight Cost Estimate und Multi-Step Agent in einen 8-Wochen-MVP. Das war optimistisch um Faktor 2. Der neue MVP ist deutlich schmaler: **Chat + Single-File-Edit mit Approval, Anthropic-API + Claude-CLI, ein einziger agent-config-Command live, Single-Shot Agent ohne Loop.** Alles andere ist v1.0. Das ergibt einen ehrlichen 12–16-Wochen-MVP statt einem optimistischen 8-Wochen-MVP, der dann 24 Wochen dauert.

### 7.1 MVP — „Internes Demo + dogfooding" (13 Wochen Sprint-Work + 1–3 Wochen Puffer = 14–16 Wochen kalendarisch)

**Demo-Ziel am Ende des MVP:** *Ich öffne PhpStorm, öffne den event4u-Hauptrepo, tippe `/commit` in den Chat. Das Plugin liest die `commands/commit.md` aus dem agent-config-Tree, ruft Claude (entweder via API oder via Claude-CLI mit meiner Pro-Subscription) auf, liest git status, schlägt eine Commit-Message vor, ich akzeptiere. Cost-Footer zeigt mir Tokens + USD. Das gleiche funktioniert in VS Code.*

**Sprint 1 (3 Wochen)** — Skeleton & RPC-Baseline
- [ ] Mono-Repo + Tooling (pnpm, Taskfile, ESLint, Detekt, CI Skeleton)
- [ ] Agent Core: Echo-Server via JSON-RPC
- [ ] JetBrains Client: leeres Tool Window, startet Sidecar
- [ ] VS Code Extension: leeres Webview, startet Sidecar
- [ ] CI für alle 3 Targets (lint + build, kein Test in Sprint 1)
- [ ] **Phase-0-Spike-Ergebnisse ins Skeleton einarbeiten** (z. B. Compose-vs-Swing, Sidecar-vs-Kotlin-nativ — abhängig von 0.3)

**Sprint 2 (3 Wochen)** — Chat mit *einem* Provider
- [ ] **Anthropic API Backend** mit Streaming (nur Anthropic im MVP, OpenAI in v1.0)
- [ ] Chat UI in beiden IDEs (Markdown-Render, Codeblöcke mit Syntax-Highlighting) — **Action Cards in vereinfachter Form**: collapsed/expanded ohne komplexe Badges; volle Badge-Implementation (§8.8) erst in v1.0
- [ ] Settings Page (Provider + API Key + Modell-Wahl)
- [ ] OS-Keychain Integration für API-Keys
- [ ] **`.agent-settings.yml`-Reader** (Mindest-Implementation, nur Felder die MVP braucht)
- [ ] Cost tracking v0: Token-Counter pro Request, USD-Anzeige (Pricing Book mit nur Anthropic-Modellen)

**Sprint 3 (3 Wochen)** — Single-Shot Agent + Single-File-Edit
- [ ] Tool Calling: `read_file`, `list_dir`, `glob`, `grep`
- [ ] Tool: `write_file` (Single-File, nicht Multi-File) mit Diff-Preview
- [ ] Permission-Gate v0: Hard-Floor-Liste aus agent-config (keine inline-editable Scope-UI in MVP — die kommt in v1.0)
- [ ] Halt-Protocol Rendering (klickbare Optionen, Free-Text-Input) — Card-Variante einfach gehalten
- [ ] „Ask about selection" Action in beiden IDEs (eine einzige Editor-Action, keine Intention/Right-Click in MVP)

**Sprint 4 (4 Wochen)** — agent-config Integration + CLI-Mode
- [ ] **agent-config Tree-Walker** (`.event4u-agent/` oder `.augment/`-Fallback, Skills/Rules/Commands einlesen)
- [ ] **Slash-Command-Picker** im Chat-Input
- [ ] **`/commit` als erstes lauffähiges agent-config-Command** (Single-Shot, kein Multi-Step Loop)
- [ ] Rules als „always-active" prepended an System-Prompt
- [ ] **Claude Code CLI Backend** (`--output-format=stream-json`)
- [ ] **Mode-Toggle im Chat-Header** (API ↔ CLI per Conversation)
- [ ] CLI-Detection Service (nur `claude`, andere CLIs in v1.0)
- [ ] **Tracking SQLite-Persistenz** v0 (Step-Events in `tracking.db`, Conversation-Summary)
- [ ] **Hard Caps + Confirm-Dialog** (single-step, daily — die echten User-Schutzlinien)
- [ ] **Internal demo to event4u team**

→ **Demo:** ein agent-config-Command live, in beiden IDEs, mit Cost-Tracking auf 4 Ebenen für 1 Provider in 2 Modes.

**Was bewusst NICHT im MVP ist (verschoben auf v1.0):**

| Feature | Warum aus MVP raus |
|---|---|
| SweepAI-Style Inline-Edit (Cmd+I Prompt-Bar) | Native IDE-Tiefe ist ein Sprint für sich; macht keinen Unterschied für „Funktioniert das?"-Demo |
| Intention Actions, Right-Click EditorPopupMenu, Floating-Toolbar | Identisch wie oben |
| Codex CLI Backend, Gemini CLI Backend | Drei Provider parallel in 8 Wochen + alle CLIs ist unrealistisch — *einer* funktionierender Dual-Mode ist die echte Validierung |
| Pre-flight Cost Estimate | Wenn Tokenizer-Drift ±15–30 % erreichen kann, ist das ein eigener Sprint mit eigenen Edge Cases — Hard Caps + Real-time Counter reichen für MVP-Demo |
| Multi-Step Agent-Loop (plan → exec → verify) | Single-Shot reicht für `/commit`-Demo. Loop kommt mit `/work` und `/implement-ticket` in v1.0 |
| Context Engine v0 (Tree-sitter + BM25) | MVP nutzt naive „all open editors + selection" — Retrieval kommt erst in v1.0 |
| Full Action-Card-Badges (Diff-Stats, Numeric, Status-Dot) | Vereinfachte Cards reichen für Demo; Polish kommt in v1.0 |
| OpenAI-API-Backend | Nur Anthropic im MVP. OpenAI in v1.0 |
| Multi-File-Edit | Single-File reicht für `/commit`-Demo; Multi-File mit Bulk-Permission-Card in v1.0 |
| **PTY-basierter Live-Terminal mit interaktivem Input** (§8.9) | MVP nutzt naive Pipe-Spawn mit Output-Streaming; volle PTY + Waiting-for-input + Dual-Surface-Sync in v1.0. Interaktive Scripts schlagen im MVP fehl mit klarer Message |
| **Per-CLI Zahnrad-Controls** (§9.11) | Capability-Manifests + adaptive UI sind ein Polish-Sprint für sich. MVP nutzt eine einzige CLI (Claude Code) ohne Settings-UI — User muss `claude config` manuell nutzen |
| **Session Browser** (§9.13) | Adapter pro CLI + Live-Watcher + Unified-Listing ist ein eigener Sprint. MVP zeigt nur die *aktuelle* Conversation; History ist intern in `tracking.db` schon da, nur UI fehlt |
| Conversation-Forking, Checkpoints | Augment-Inspirationen, kein MVP-Differenziator |
| Inline-editable Permission-Scope | „Allow once / Always / Deny" reicht im MVP; inline-edit-UI in v1.0 |
| Smart Paste, KaTeX/Mermaid | reine Polish-Features |
| Background Bash, Todo-Tool, Action-Plan-Tool | sind v1.0-Polish |

### 7.2 v1.0 — „Internal alpha, dogfood it" (Sprint 5–15, ~6,5–7,5 Monate nach MVP inkl. Puffer-Sprint)

**Aus dem MVP nachgezogen (v1.0-Pflicht):**
- **OpenAI API Backend** + GPT-5/o-Reihe-Support
- **Codex CLI Backend** + **Gemini CLI Backend** (Detection für alle 3 CLIs)
- **Multi-Step Agent-Loop** mit Phasen (plan → exec → verify) + Halt-Protokoll
- **Multi-File Edit** mit Bulk-Permission-Card und atomic rollback
- **Inline-editable Permission-Scope** (Claude-Code-Style, §8.8.11)
- **Volle Action-Card-Implementation** mit allen Badges (§8.8)
- **Pre-flight Cost Estimate** (mit klarem ±-Range, siehe §14.3)
- **PTY-basierter Live-Terminal** (siehe §8.9): node-pty, ANSI-Color, Spinner, Elapsed-Time, Waiting-for-input-Detection (Heuristik + stdin-Readiness + Idle-Timeout), Inline-Input-Card in der Chat-Surface
- **Dual-Surface-Sync** zwischen Chat-Card und VS-Code-IDE-Terminal (Pseudoterminal-API). JetBrains-IDE-Terminal-Sync **read-only in v1.0**, full read/write in v1.5 (Spike-abhängig — §0.3)
- **Per-CLI Zahnrad-Settings** mit Capability-Manifest (§9.11) — Auto-Modes, Slash-Commands, Verbosity, Permission-Modes pro CLI
- **Unified Session Browser** (§9.13) mit Sessions-Button oben rechts — listet Plugin-API-Sessions + alle externen CLI-Sessions (Claude/Codex/Gemini), Resume via `--resume <id>` für CLIs bzw. Conversation-Load für API
- **Chokidar-Watcher** auf CLI-Session-File-Locations für Live-Detection neuer externer Sessions
- **SweepAI-Style Inline-Edit** (`Cmd+I` Prompt-Bar)
- **SweepAI-Style Diff-Accept Shortcuts** (`Cmd+Y`/`Cmd+N`/`Cmd+Enter`/`Cmd+Shift+Backspace`)
- **Right-Click EditorPopupMenu Group** + Floating-Toolbar
- **Intention Action** (Alt+Enter „Fix with event4u-agent")
- **Context Engine v0** (Tree-sitter + BM25) — naive Variante, aber funktional

**Echte v1.0-Erweiterungen:**
- Vector Embeddings + Hybrid-Retrieval (BM25 + vector rerank)
- Memories (lokal + optionale @event4u/agent-memory MCP-Backend)
- Full agent-config Command-Set (alle 136 Commands aufrufbar)
- MCP Client: arbitrary MCP servers connecten und nutzen
- Terminal-Integration mit Permission-Gate
- Improved Diff Apply (Multi-File, atomic rollback)
- Better Streaming UX (token-by-token, abortable)
- Persisted Chat History
- Statusbar-Widget mit Modell + Kosten + Index-Status
- Telemetry (opt-in, lokal)
- Auto-Update Mechanik des Sidecars
- **Gemini CLI Backend**, **Aider CLI Backend**
- **OpenAI-compat API Backend** (Mistral, Groq, OpenRouter, Together, …)
- **Ollama API Backend**
- **Cost-Dashboard** (eigener Tool-Window-Tab mit Charts)
- **CSV/JSON-Export** für Cost-Audit
- **Conversation Forking** (Augment-Style)
- **Checkpoints** in Conversations
- **PR-Review Skill** (SweepAI-inspiriert)
- **Custom Prompts**: User-definierte Prompts persistiert + zugänglich via `/` (SweepAI-Style)
- **Background Bash Tool** mit Transcript-Inspector
- **Bash Auto-Approve Modes** (deny / ask / pattern-allowlist / always)
- **TodoWrite + UpdateActionPlan Tools** (SweepAI-Style mit UI-Rendering)
- **Workspace Guidelines** als editierbare Datei (Augment-Style + agent-config Rules)
- **Hooks-System** (sessionStart/End/Stop) — kompatibel agent-config-Hooks
- **KaTeX + Mermaid** Rendering im Chat
- **Subscription-Cost-Approximation** für CLI-Modus (shadow-API-cost)
- **Pricing-Book Sigstore-Signature-Verification** + opt-in npm-Auto-Update mit Hard-Block bei >50 % Preis-Drop (§14.10.1) — Default bleibt Plugin-gebundelt

### 7.3 v1.5 — „Public beta" (Sprint 16–21, ~12 Wochen, nur falls Positionierung B/C aus §0.2)

- Inline-Autocomplete (Codestral / Qwen-Coder local oder remote)
- Repository-aware Refactoring-Skills
- Linear / Jira / GitHub Issue-Reader für `/implement-ticket` Auto-Resolve
- Web-Tool (Browser/Search) für Agent
- Roo-Code-/Cline-style Tasks-Liste persistent
- Customization-UI (Skills per Workspace toggeln)
- **JetBrains-IDE-Terminal-Sync full read/write** (`TtyConnector`-Implementation für `JBTerminalWidget` — siehe §8.9.5)
- **Externer-Claude-CLI-Attach** als dritte Surface (Hook-/JSONL-Tail-/Socket-basiert — siehe §8.9.7), erfordert Phase-0-Spike auf Claude-Code-CLI-Hook-Mechanik

### 7.4 v2.0 — „Production-grade" (Sprint 19+)

- Self-hosted Backend für Team-Modus (Sharing memories, kostentracking org-weit)
- Eigene Embedding-Pipeline mit Cache-Sharing im Team
- Speech-to-Text Eingabe
- Cloud-Bundle-Konsumption (auch Claude.ai Skills nutzen)
- Enterprise-Features (SSO, Audit-Log)

---

## 8. Modul-Breakdown

### 8.1 `packages/core/agent` — Agent Loop

State-Machine analog `agent-config`-Work-Engine:

```
refine → score → plan → implement → test → verify → report
```

- Zustand persistiert in `.work-state.json` im Projekt (kompatibel zu agent-config).
- Halt-Protokoll: Agent emittiert *strukturierte* Halts (`{phase, question, options}`); Client zeigt sie als Card im Chat.
- **Directive Sets**: `ui`, `ui-trivial`, `mixed`, `default` — identisch zu agent-config ADR-Product-UI-Track.
- Scope-Control: jeder Tool-Call wird gegen aktuelle „scope" geprüft.

### 8.2 `packages/core/llm` — Provider Layer

```typescript
interface LLMProvider {
  id: string;
  capabilities: { streaming, toolCalling, vision, longContext };
  send(req: ChatRequest): AsyncIterable<StreamChunk>;
  countTokens(messages: Message[]): number;
  estimateCost(usage: Usage): number;
}
```

**Implementierungen (v1.0):**
- `AnthropicProvider` (Messages API mit Tool Use)
- `OpenAIProvider` (Chat Completions + Responses API)
- `OpenAICompatibleProvider` (für Mistral, Together, Groq, OpenRouter, …)
- `OllamaProvider` (lokales LLM)
- `CustomHttpProvider` (für event4u-eigene Endpoints — vom Nutzer konfigurierbar)

**Auto-Mapping aus agent-config:**

In `.agent-settings.yml` kann ein Provider-Pin stehen:
```yaml
llm:
  default_provider: anthropic
  providers:
    - id: anthropic
      type: anthropic
      model: claude-sonnet-4-6
      api_key_env: ANTHROPIC_API_KEY
    - id: local
      type: ollama
      base_url: http://localhost:11434
      model: qwen2.5-coder:32b
    - id: company
      type: openai-compatible
      base_url: https://llm.event4u.app/v1
      api_key_env: EVENT4U_LLM_KEY
```

Das Plugin liest diese Liste und stellt sie in einem Modell-Picker dar.

### 8.3 `packages/core/context` — Context Engine

**v0 (MVP):**
- `walker.ts` — durchläuft Workspace, respektiert `.gitignore` + `.augmentignore` (besteht im Repo).
- `symbol_index.ts` — Tree-sitter parsed jede Source-Datei, extrahiert Top-Level-Symbole (Klassen, Funktionen, Methoden) mit Datei-Position.
- `bm25.ts` — Inverted Index für Symbol-Namen + Pfad-Tokens.
- `retriever.ts` — bei jedem User-Turn: top-K-Symbole + ihre Datei-Bereiche werden als Context-Snippets in den Prompt eingefügt.

**v1 (Embeddings):**
- `embedder.ts` — chunked Code-Blöcke (~512 token), Tree-sitter respektiert Funktionsgrenzen.
- `vector_store.ts` — `sqlite-vec` als persistenter Store unter `.event4u-agent/index.db`.
- `hybrid.ts` — BM25 + Vector → RRF (reciprocal rank fusion) → Rerank.
- Incremental Re-Indexing on file change (debounced 2s).

**v2 (advanced lokal — kein Cloud-Backend):**
- Cross-file dependency graph (Call-Graph, Import-Graph).
- Skill-aware boost: wenn Skill `api-design` aktiv ist, Routes/Controllers bevorzugen. Das ist unser eigentlicher Vorteil — kuratierte Skills steuern das Retrieval-Ranking, statt es aus impliziten ML-Signalen zu lernen.

(Hinweis: „Augment-Niveau" in der Cloud-augmented Lesart ist explizit Non-Goal — siehe §11.0.)

### 8.4 `packages/core/tools` — Tool Calling

| Tool | Beschreibung | Permission |
|---|---|---|
| `read_file` | Lies Datei (mit Range) | low |
| `write_file` | Patche Datei | requires_diff_approval |
| `list_dir` | Listet Verzeichnis | low |
| `glob` | Glob-Pattern-Suche | low |
| `grep` | ripgrep-Suche | low |
| `run_shell` | Terminal-Kommando | requires_approval |
| `run_test` | Test-Subset ausführen | requires_approval |
| `web_fetch` | URL fetchen | low |
| `web_search` | Suche (via konfigurierbaren Provider) | low |
| `mcp_call` | Beliebigen MCP-Tool aufrufen | per_tool |

**Permission-Modell:**
- `low` — automatisch erlaubt.
- `requires_diff_approval` — Diff wird gezeigt, Nutzer akzeptiert.
- `requires_approval` — Nutzer muss explizit „Yes" klicken.
- `denied` — Hard-Floor (z.B. `rm -rf /`, `git push`-Aliase, prod-DB-Connection).

### 8.5 `packages/core/config` — agent-config Adapter

Verantwortlich für:
- `.agent-settings.yml` lesen (Zod-Schema, kompatibel mit agent-config-Spec).
- `.agent-src/` (oder `.augment/`) im Projekt finden und Skills/Rules/Commands laden.
- Frontmatter-Parsing (gray-matter).
- Hot-Reload bei Änderung der Files.
- Skill-Resolution: wenn der Agent „/api-design" triggert, lese `SKILL.md` und injiziere `Procedure`-Section in den Prompt.

### 8.6 `clients/jetbrains` — JetBrains Plugin

**Module:**
- `ToolWindow` — IntelliJ ToolWindowFactory, Compose-UI im Panel.
- `Sidecar` — `KillableProcessHandler`, JSON-RPC via `vscode-jsonrpc/jvm` (oder eigener kleiner JSON-RPC-Klient).
- `Editor Actions` — `AnAction`-Klassen für „Ask about selection", „Fix this", „Explain this".
- `Diff Viewer` — `DiffManager.showDiff` mit `SimpleDiffRequest` für jeden Edit.
- `File Listener` — `BulkFileListener` propagiert File-Changes an Sidecar für Index-Update.
- `Settings` — `Configurable` für API-Keys, Provider, Permission-Defaults.

**plugin.xml-Highlights:**
```xml
<idea-plugin>
  <id>app.event4u.agent</id>
  <name>event4u Agent</name>
  <vendor email="dev@event4u.app">event4u</vendor>
  <depends>com.intellij.modules.platform</depends>
  <extensions defaultExtensionNs="com.intellij">
    <toolWindow id="event4u-agent" anchor="right"
                factoryClass="app.event4u.agent.toolwindow.AgentToolWindowFactory"/>
    <projectService serviceImplementation="app.event4u.agent.sidecar.SidecarService"/>
  </extensions>
</idea-plugin>
```

**Compose Multiplatform vs. Swing:**
Compose ist moderner und teilt UI-Konzepte mit dem VS-Code-Webview, hat aber höhere Bundle-Size und ist bei manchen alten IntelliJ-Versionen instabil. **Vorschlag MVP:** Swing für die ersten 2 Sprints, dann Migration auf Compose, sobald JetBrains JBCef-Webview als Render-Target stabil ist (ähnlich Cody).

### 8.7 `clients/vscode` — VS Code Extension

**Module:**
- `extension.ts` — Activation, Sidecar-Spawn.
- `webview/` — Preact-Webview für Chat. Wir nutzen `@vscode/webview-ui-toolkit` für native-Look-Components.
- `commands.ts` — Command-Palette-Einträge: `event4u: Open Chat`, `event4u: Ask about selection`, `event4u: Index Workspace`.
- `diff.ts` — `vscode.diff` API für Diff-Preview.
- `inlineDecorator.ts` — Inline-Marker im Editor während Agent arbeitet.

**package.json-Highlights:**
```json
{
  "name": "event4u-agent",
  "engines": { "vscode": "^1.90.0" },
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {"command": "event4u.openChat", "title": "event4u: Open Chat"},
      {"command": "event4u.askAboutSelection", "title": "event4u: Ask about selection"}
    ],
    "keybindings": [
      {"command": "event4u.askAboutSelection", "key": "ctrl+shift+a", "mac": "cmd+shift+a"}
    ],
    "configuration": {
      "title": "event4u Agent",
      "properties": { ... }
    }
  }
}
```

### 8.8 Chat-UX — Collapsible Action Cards (Cross-IDE)

> **Leitprinzip:** Der Chat soll auch bei langen Agent-Runs übersichtlich bleiben. Jede Agent-Aktion (Tool-Call, File-Read, File-Edit, Thought, Terminal-Run) wird als **kompakte Card mit Summary-Zeile** gerendert, **default eingeklappt**. Beim Aufklappen sieht der User den vollständigen Inhalt — Diff, Command-Output, Datei-Inhalt, Reasoning. Dieses Pattern ist plattformübergreifend identisch in JetBrains und VS Code.

#### 8.8.1 Action-Card-Typen + Badge-Icons

| Typ | Icon | Summary-Format | Expanded Content |
|---|---|---|---|
| **Thought** | 💭 / 🧠 | „Now I'm checking the existing wizard state…" + `›` chevron | Vollständiger Reasoning-Block (Markdown) |
| **Terminal** | `>_` | `Terminal $ <command-preview, 80 chars>` + Elapsed-Time + `🔗`-Pill bei Sync | Live-PTY-Stream mit ANSI-Color, Spinner, Waiting-for-input-Banner mit Inline-Input-Feld, Exit-Code. **Volle Architektur in §8.9 — PTY-basiert mit Multi-Surface-Sync zu IDE-Built-in-Terminal** |
| **Read File** | 📄 | `Read lines 275–330` + Sprache-Tag (`ts`, `php`, …) + Pfad-Chip | Datei-Inhalt mit Syntax-Highlight, optional Highlight der gelesenen Range |
| **Glob / Search** | 🔍 | `Search "tokenize" → 8 matches in 3 files` | Match-Liste mit File-Pfad + Line-Number |
| **Created File** | 📄✨ | `Created file` + Pfad-Chip + Sprache-Tag | Vollständiger Datei-Inhalt mit Syntax-Highlight |
| **Edited File** | 📄✏ | `Edited file` + Pfad-Chip + Diff-Stats `+12 -3` | Inline-Diff (rot/grün), pro Hunk Accept/Reject-Buttons |
| **Deleted File** | 📄🗑 | `Deleted file` + Pfad-Chip | Letzter Inhalt, Confirm-Dialog beim Senden |
| **Skill Invocation** | 🧩 | `Skill › api-design` + Argument-Preview | Skill Procedure + Output |
| **MCP Tool Call** | 🔌 | `MCP › github:list_prs` + Argument-Preview | Tool-Response (JSON-prettified oder formatiert) |
| **Web Fetch** | 🌐 | `GET <hostname>/<path>` | Response-Snippet (Markdown), Status, Cookies blacked-out |
| **Permission Request** | 🔐 | `Allow run: <command>` | Inline-editable Scope + 4 Action-Buttons (siehe §8.8.11) |
| **Halt / Question** | ❓ | `Question: Should I proceed with X?` | Numerierte Optionen als klickbare Buttons + Free-Text-Input (siehe §8.8.12) |
| **Cost / Usage Footer** | 💰 | `⏱ 4.2s • In: 18k (cache 14k) • Out: 487 • $0.0156` | Detail-Breakdown pro Step |
| **Correction (mid-stream)** | ⚠ | `Wait — the merge-json projection test is wrong…` | Korrektur-Reasoning |

#### 8.8.2 Anatomie einer Card (Layout)

```
┌──────────────────────────────────────────────────────────────────────┐
│ <Icon>  <Summary line> <sprache> <pfad-chip>      +12 -3  ⚖  ●      │
│         ▲                                          ▲      ▲   ▲      │
│         klickbar: toggelt expand/collapse          │      │  Status  │
│                                          Diff-Stats Badge  │         │
│                                                    Numeric-Badge (opt)│
│                                                                      │
│   ┌──────────── (expanded content) ─────────────────────┐            │
│   │                                                     │            │
│   │   <Diff / Code / Output>                            │            │
│   │                                                     │            │
│   └─────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────┘
```

**Drei rechts-bündige Badges** (alle immer sichtbar, auch im collapsed-State):

##### Badge 1 — Diff-Stats `+N -N` (für File-Operations)

| Card-Typ | Anzeige | Farben |
|---|---|---|
| **Edited File** | `+12 -3` | Plus: Grün (`#2da44e`) · Minus: Rot (`#cf222e`) |
| **Created File** | `+217` | nur Grün |
| **Deleted File** | `-180` | nur Rot |
| **Multi-File-Edit (Batch)** | `+45 -12` (summiert über alle Files) | Grün + Rot |
| **Multi-String-Replace** | `+8 -8` (je geänderter Block) | Grün + Rot |

- **Pill-Form** mit dezentem Hintergrund (wie GitHub-Style)
- **Hover-Tooltip** zeigt Detail: `12 Zeilen hinzugefügt · 3 Zeilen entfernt · 5 Zeilen unverändert berührt`
- **Klickbar** — öffnet die Card expanded, fokussiert auf Diff-Section
- Bei sehr großen Diffs wird der größere Wert mit Tausender-Suffix gekürzt: `+1.2k -340`

##### Badge 2 — Numeric Counter (kontextabhängig)

Manche Card-Typen brauchen einen eigenen Zähler, der nicht in `+/−`-Form passt:

| Card-Typ | Counter-Anzeige | Beispiel |
|---|---|---|
| **Read File** | Anzahl gelesener Zeilen | `217 lines` |
| **Search / Glob** | Match-Count + File-Count | `8 in 3` |
| **Terminal** | Output-Zeilen oder Exit-Code | `exit 0` · `127 lines` |
| **MCP Tool Call** | nicht angezeigt (Tool-spezifisch) | — |
| **Web Fetch** | HTTP-Status + KB-Größe | `200 · 12 KB` |
| **Skill Invocation** | Step-Count im Skill | `4 steps` |
| **Halt** | Anzahl Optionen | `3 options` |

##### Badge 3 — Status-Dot (immer)

| Farbe | Bedeutung |
|---|---|
| 🔵 Blau (animiert) | In progress / streaming |
| 🟢 Grün | Erfolgreich abgeschlossen |
| 🟡 Gelb | Warning (z.B. tool returned partial result, oder Edit teilweise rejected) |
| 🔴 Rot | Failed (mit Tooltip: Fehler-Reason) |
| ⚪ Grau | Skipped / cancelled / pending-user-decision |
| 🟣 Lila | User hat manuell editiert nach Apply (Diff drifted) |

##### Badge-Reihenfolge (links → rechts)

```
[ Diff-Stats? ]  [ Numeric? ]  [ Status-Dot ]
   +12 -3          217 lines       ●
```

Diff-Stats und Numeric sind **optional** je nach Card-Typ. Status-Dot ist **immer** da. Reihenfolge ist fix, damit der Blick des Users konsistent „nach rechts" auf den Status wandert.

##### Sonderfall — Diff-Stats für Per-Hunk-Acceptance

Wenn der User einzelne Hunks akzeptiert/abgelehnt hat, ändern sich die Stats live:

```
Vor User-Action:   +12 -3   ●  (Status: pending user review)
2 Hunks akzeptiert:  +8 -2   🟡 (partial accept — gelber Dot, kursive Stats)
Alle akzeptiert:    +12 -3   🟢 (final)
Alle abgelehnt:     +0 -0    ⚪ (skipped, gestrichene Stats)
```

Das gibt dem User auf einen Blick die Information „Wieviel von dem Vorschlag habe ich übernommen?".

#### 8.8.3 Default-Collapse-Verhalten

| Card-Typ | Default-State |
|---|---|
| Thought | collapsed (mit Summary-Line) |
| Terminal | collapsed wenn exit=0, **expanded wenn exit≠0** |
| Read File | collapsed |
| Search/Glob | collapsed wenn <5 matches, expanded sonst |
| Created File | collapsed |
| **Edited File** | **expanded** (User will den Diff sofort sehen — kritisch für Approval-Workflow) |
| Skill / MCP / Web Fetch | collapsed |
| Halt / Question | **immer expanded** (User-Input nötig) |
| Cost / Usage Footer | inline (one-liner, kein expand) — Klick öffnet Drawer |
| Correction (mid-stream) | expanded (wichtige Info) |

User kann das pro Card-Typ in den Settings überschreiben: `chatUx.cardDefaults.readFile = "collapsed"`.

#### 8.8.4 Bulk-Operationen

In der Chat-Toolbar:
- **`Collapse all`** — alle expandierten Cards in der aktuellen Konversation einklappen
- **`Expand all`** — alles aufklappen
- **`Show only edits`** — Filter, der nur File-Edits zeigt (für PR-Review-Vor-Check)
- **`Show only errors`** — Filter auf rote Status-Dots

Keyboard-Shortcuts (in beiden IDEs):
- `Cmd+]` / `Ctrl+]` — Expand currently focused card
- `Cmd+[` / `Ctrl+[` — Collapse
- `Cmd+Shift+]` / `Ctrl+Shift+]` — Expand all
- `Cmd+Shift+[` / `Ctrl+Shift+[` — Collapse all

#### 8.8.5 Mid-Stream Corrections

Wenn der Agent während des Streams seine Hypothese korrigiert (siehe Screenshot: „Wait — the merge-json projection test is wrong…"), wird das als eigene **`correction`-Card** gerendert, **default expanded**, mit warning-Icon ⚠. Das hilft dem User zu verstehen, dass der Agent selbst gemerkt hat, dass etwas nicht stimmte — kein verstecktes Verhalten.

#### 8.8.6 Diff-Rendering im Edit-Card

```
┌──────────────────────────────────────────────────────────┐
│ 📄✏  Edited file  WizardConflicts.test.tsx tests/ui  +1 -1 ●│
│                                                          │
│   it('projects merge-json as merge for mergeable…', () =>│
│     const r = renderConflicts({ conflicts: batchCon…    │
│ -   expect((within(mergeable).getByLabelText('Skip'))    │
│ +   expect((within(mergeable).getByLabelText('Merge'))   │
│     const nonMerge = r.getByRole('radiogroup', { …      │
│                                                          │
│   [ Accept Hunk ] [ Reject Hunk ] [ Open in Editor ]    │
└──────────────────────────────────────────────────────────┘
```

- Diff-Renderer nutzt **Monaco DiffEditor** im Webview (JetBrains: JBCef-Embed; VS Code: native).
- **Per-Hunk Accept/Reject** statt nur per-File.
- Klick auf den File-Pfad-Chip öffnet die Datei in IDE-Editor mit Cursor an der Stelle.
- Beim Hover über eine Zeile: kleiner "Show in Editor" Knopf.

#### 8.8.7 File-Pfad-Chip Design

Aus dem Screenshot übernommen — kompakter, klickbarer Chip mit:
- **Dateiname** (fett)
- **Pfad-Teil** (gedimmt, optional gekürzt mit Ellipsis)
- **Sprache-Tag** (kleines Icon oder Buchstaben-Badge, z.B. `ts`, `php`, `kt`)

Hover-Tooltip zeigt vollständigen Absolut-Pfad. Klick → öffnet Datei im IDE-Editor.

#### 8.8.8 Streaming-Animation

Während Tokens reinkommen:
- **Status-Dot blinkt blau**
- **Summary-Line zeigt Live-Progress** (z.B. „Reading file… 187 lines so far")
- **In Cost-Footer läuft Token-Counter live** (siehe §14.4)

Sobald der Step fertig ist:
- Dot wird grün
- Summary-Line fixiert sich (`Read lines 1–217`)
- Card kollabiert auto auf den Default-State (Edit-Cards bleiben expanded)

#### 8.8.9 Persistenz & Replay

Card-States werden pro Konversation persistiert (`conversation.cardStates[stepId] = "expanded" | "collapsed"`). Beim Re-Öffnen der Konversation behält jede Card ihren letzten State. Trace-Replay (§14.9) nutzt das gleiche Card-Layout für die Wiedergabe.

#### 8.8.10 Implementation

- **Card-Komponente** liegt in `packages/shared/ui/Card.tsx` als plattformneutrale Preact-Komponente.
- **JetBrains-Client** hostet sie im JBCef-Webview (gleiche Codebasis wie VS-Code-Webview).
- **CSS-Variablen** synchronisieren sich mit IDE-Theme (JBColor / VS Code Theme API).
- **Virtualisierung** mit `react-virtuoso` für sehr lange Konversationen (Performance bei 500+ Steps).

#### 8.8.11 Permission-Cards — inline-editable Scope (Claude-Code-Style)

> **Pattern:** Wenn der Agent ein Tool aufrufen will, das eine Permission braucht (Shell-Command, Datei-Write außerhalb des Workspaces, Web-Fetch zu nicht-allowlisted Domain, etc.), erscheint **inline im Chat** eine Permission-Card. Der User entscheidet pro Card — und kann den **Scope vor der Bestätigung inline editieren**.

##### Layout der Permission-Card

```
┌───────────────────────────────────────────────────────────────────┐
│ 🔐  Allow command                                              ●  │
│                                                                   │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │ $ git status --short                                        │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│   Working directory: /Users/.../event4u/agent-config              │
│   Reason from agent: "I need to see uncommitted changes before…"  │
│                                                                   │
│   ▼ Edit scope before approving                                   │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │ Pattern: [ git status* ]              ← inline editable     │ │
│   │ Working dir: [ /Users/.../event4u/* ] ← inline editable     │ │
│   │ Time: [ This session ▼ ]                                    │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│   [ Allow once ]  [ Allow for session ]  [ Always ]  [ Deny ]    │
│                            ▲                                      │
│                  Default-Fokus (Enter aktiviert)                  │
└───────────────────────────────────────────────────────────────────┘
```

##### Die vier Approval-Buttons

| Button | Wirkung | Persistenz |
|---|---|---|
| **Allow once** | Genau dieser eine Call läuft. Beim nächsten gleichen Call fragt der Agent erneut. | Keine — wird nicht gespeichert |
| **Allow for session** | Pattern wird als Allowlist-Eintrag für die aktuelle Plugin-Session gespeichert | `agents/runtime/state/session-permissions.json` (live, wird beim IDE-Restart geleert) |
| **Always** | Pattern wird permanent in `.agent-settings.yml` `permissions.allow` eingetragen | Persistent, projekt-scoped (kann global gemacht werden) |
| **Deny** | Call wird abgebrochen. Bei „Deny for session" wird das Pattern auf Block-Liste gesetzt | je nach Variante |

`Deny` hat eine eigene kleine Subaktion mit Long-Press oder Dropdown:
- Deny once
- Deny for session
- Deny always (Pattern blockt zukünftige Anfragen ohne Frage)

##### Inline-editierbare Scope-Felder

Genau wie in Claude Code: **vor** dem Klick auf einen Approval-Button kann der User den Scope verfeinern oder erweitern:

| Feld | Beispiel-Input | Pattern-Syntax |
|---|---|---|
| **Pattern** | `git status*` → `git *` → `git status --short` (exact) | Glob-Pattern auf Command-String |
| **Working dir** | `/Users/.../event4u/*` → `/Users/.../event4u/agent-config/**` | Glob-Pattern auf cwd |
| **Time** | `Once` · `This session` · `Today` · `Always` | Dropdown |
| **Args-Allowlist** (advanced) | `--short, --porcelain` | Komma-Liste, nur diese Flags erlaubt |

Beispiel-Flow:
1. Agent fragt nach: `$ git status --short`
2. User klickt ins Pattern-Feld, ändert es zu `git status*` (statt exact match)
3. User klickt „Allow for session"
4. → Ab jetzt laufen `git status`, `git status -s`, `git status --short`, etc. ohne erneute Frage

##### Permission-Scope-Konfig

```yaml
# .agent-settings.yml
permissions:
  default_policy: ask           # ask | allow_safe | strict_deny
  per_tool_defaults:
    read_file: allow            # immer ok
    write_file: ask
    run_shell: ask
    web_fetch: ask
  allow:                        # User-bestätigte Allowlist
    - tool: run_shell
      pattern: "git status*"
      cwd: "/Users/.../event4u/**"
      scope: project
      added_at: "2026-05-26T07:42:00Z"
      added_via: "ui"
    - tool: run_shell
      pattern: "npm test*"
      cwd: "/Users/.../event4u/**"
      scope: project
  deny:
    - tool: run_shell
      pattern: "rm -rf*"
      scope: global
      reason: "Hard floor — never allow recursive deletes"
  hard_floor:                   # Nie überschreibbar, auch nicht durch Always-Buttons
    - "git push origin main"
    - "git push --force*"
    - "DROP TABLE*"
    - "TRUNCATE*"
    - "rm -rf /"
    - "*: --no-verify"
```

##### Settings-Seite — Permission Manager

Eigene Sub-Sektion in den Plugin-Settings: **„Permissions & Allowlists"**. Zeigt alle aktiven Permissions in einer Tabelle:

```
Active Permissions                     [+ Add]  [Export]
──────────────────────────────────────────────────────────
Tool          Pattern            Scope     Added    Actions
run_shell     git status*        project   May 26   [Edit] [Revoke]
run_shell     npm test*          project   May 24   [Edit] [Revoke]
run_shell     docker compose*    session   today    [Edit] [Revoke]
web_fetch     api.github.com/*   global    Apr 12   [Edit] [Revoke]
write_file    src/**             session   today    [Edit] [Revoke]
──────────────────────────────────────────────────────────
Denied Patterns
──────────────────────────────────────────────────────────
run_shell     rm -rf*            global    (Hard Floor — locked)
run_shell     git push origin m… global    (Hard Floor — locked)
```

Jede Zeile ist inline-editierbar (Doppelklick auf Pattern). „Revoke" entfernt sie.

##### Hard-Floor — nie via Always überschreibbar

Bestimmte Patterns sind **Hard Floor** (aus dem agent-config `non-destructive-by-default`-Rule):

- `git push origin <main|master|prod>` und Aliase
- `git push --force*`, `git push -f*`
- `git reset --hard <pushed-ref>`
- `DROP TABLE*`, `TRUNCATE*`, `DELETE FROM * WHERE 1*`
- `rm -rf /` und Varianten ohne klare Ziel-Bound
- `--no-verify` auf git-Operationen
- Touching prod-DBs / prod-Configs

Diese Patterns lösen **immer** eine Permission-Card aus, **auch wenn** sie auf der Allowlist stehen würden — sind also strenger als „Always". Die Card hat dann nur die Buttons `Allow once` und `Deny`, und im Card-Header steht ein roter Banner: ⚠ **„Hard Floor — bewusst entschieden"**.

##### Bulk-Permission-Card (für Multi-File-Edits)

Wenn der Agent gleichzeitig 12 Files patcht, soll der User nicht 12-mal eine Permission-Card sehen. Stattdessen eine **gruppierte Card**:

```
┌─────────────────────────────────────────────────────────┐
│ 🔐  Allow batch — 12 file edits                     ●   │
│                                                         │
│   Files (click to preview each diff):                   │
│     ✓ src/auth/login.ts        +24 -8                  │
│     ✓ src/auth/session.ts      +12 -3                  │
│     ✓ tests/auth/login.test.ts +45 -0                  │
│     … 9 more                                            │
│                                                         │
│   Apply scope:                                          │
│     ● All 12 files                                      │
│     ○ Only selected (checkboxes above)                  │
│     ○ Per-file approval                                 │
│                                                         │
│   [ Apply ]  [ Apply for session ]  [ Deny ]           │
└─────────────────────────────────────────────────────────┘
```

#### 8.8.12 Halt / Question Cards — Click-or-Type (Claude-Desktop-Style)

> **Pattern:** Wenn der Agent eine Klärungsfrage hat, erscheint eine Card mit **numerierten Optionen als klickbare Buttons** UND einem **Free-Text-Input** darunter. User wählt entweder per Klick oder tippt eine eigene Antwort.

##### Layout der Halt-Card

```
┌──────────────────────────────────────────────────────────┐
│ ❓  Question                                         ●   │
│                                                          │
│   Should I add a new migration or modify the existing    │
│   one? The existing migration is already merged to main. │
│                                                          │
│   ┌────────────────────────────────────────────────────┐ │
│   │ 1   Add a new migration (recommended)              │ │
│   ├────────────────────────────────────────────────────┤ │
│   │ 2   Modify the existing one (breaks main)          │ │
│   ├────────────────────────────────────────────────────┤ │
│   │ 3   Roll back the merged migration first           │ │
│   └────────────────────────────────────────────────────┘ │
│                                                          │
│   Or type your own answer:                               │
│   ┌────────────────────────────────────────────────────┐ │
│   │ │                                                  │ │
│   └────────────────────────────────────────────────────┘ │
│                                            [Send ⇧⏎]    │
└──────────────────────────────────────────────────────────┘
```

##### Interaktionen

| Aktion | Reaktion |
|---|---|
| **Klick auf Option-Button** | Antwort wird sofort gesendet, Card kollabiert, Agent setzt fort |
| **Tasten `1`, `2`, `3`** während Card-Fokus | Wählt Option, sendet sofort (wenn Cursor nicht im Text-Input ist) |
| **Tippen ins Text-Feld** | Free-Text-Modus, Options bleiben sichtbar aber nicht selected |
| **`⇧⏎` / Klick Send** | Free-Text wird als Antwort gesendet |
| **`Esc`** | Cancelt aktuelle Auswahl, nichts wird gesendet |
| **Hover über Option** | Highlight + Tooltip mit erweitertem Hinweis (falls vom Agent gesetzt) |

##### Recommendation-Marker

Wenn der Agent eine Empfehlung hat, wird die empfohlene Option markiert:

- **Linke Badge** „🎯 Recommended" oder einfach Pfeil ›
- **Default-Fokus** liegt auf dieser Option (Enter sendet sie sofort)
- Im Markdown-Body kann der Agent kurz begründen: „Ich empfehle Option 1, weil …"

##### Multi-Select-Variante

Manche Fragen erlauben Multi-Select („Welche Skills willst du laden?"):

```
┌──────────────────────────────────────────────────────────┐
│ ❓  Multi-select                                     ●   │
│                                                          │
│   Which skills do you want to load for this task?        │
│                                                          │
│   ☑ 1   api-design                                       │
│   ☑ 2   api-testing                                      │
│   ☐ 3   security-review                                  │
│   ☐ 4   migration-architect                              │
│                                                          │
│                                       [Send selection]   │
└──────────────────────────────────────────────────────────┘
```

Tasten `1`–`9` toggeln je eine Option. `Enter` sendet die Selection.

##### Embedded Form-Variante

Für komplexere Inputs (z.B. „Welchen Branch-Namen?") erlaubt der Halt-Type `form` strukturierte Eingaben:

```
┌──────────────────────────────────────────────────────────┐
│ ❓  Form input                                       ●   │
│                                                          │
│   I'm about to create a branch. Please confirm:          │
│                                                          │
│   Branch name:  [ feature/csv-export-endpoint____ ]      │
│   Base:         [ main ▼ ]                              │
│   Push remote:  [ origin ▼ ]                            │
│                                                          │
│                              [Confirm]  [Cancel]         │
└──────────────────────────────────────────────────────────┘
```

##### Protokoll-Schema (im Halt-Event)

```typescript
type HaltEvent = {
  type: "halt";
  haltType: "single-select" | "multi-select" | "form" | "free-text";
  question: string;             // Markdown
  options?: {
    id: string;
    label: string;
    detail?: string;            // Hover-Tooltip
    recommended?: boolean;
  }[];
  formFields?: FormField[];     // für haltType="form"
  allowFreeText: boolean;       // Toggle für Free-Text-Input darunter
  defaultSelection?: string | string[];
  timeout?: number;             // ms — Agent fährt mit Default fort wenn keine Antwort
};
```

Das Schema ist Teil des JSON-RPC-Protocols (siehe §8.9).

##### Persistente vs Ephemeral

Halt-Cards bleiben im Chat-Verlauf sichtbar — auch nach Beantwortung — damit man später sieht, welche Entscheidung getroffen wurde. Antwort-Wahl wird inline angezeigt:

```
❓  Question                                          ●
   Should I add a new migration or modify the existing one?
   ➤ You chose: 1. Add a new migration (recommended)
```

Klick auf die Card öffnet sie expanded zur Inspektion der ursprünglichen Optionen.

### 8.9 Live-Terminal-Execution & Dual-Surface-Sync

> **Leitprinzip:** Wenn der Agent ein Shell-Command oder ein interaktives Script ausführt, soll der User dieselbe „lebendige" Sicht haben wie in Claude Code CLI — Live-Output-Streaming mit ANSI-Farben, sichtbare Elapsed-Time, Spinner während des Laufens, klarer Exit-Status am Ende. Bei interaktiven Scripts (z. B. `npm init`, ein Python-Setup-Wizard, ein TS-Migrationsskript mit Rückfrage) soll der User die Frage **gleichzeitig in beiden Surfaces** beantworten können: im IDE-Plugin-Chat **und** im IDE-eigenen Terminal-Tool — beide spiegeln denselben Prozess-State.
>
> **Differenziator:** Weder Augment noch SweepAI haben das so. Augment hat `TerminalInfo` (Read-only Snapshot), Sweep hat `BackgroundBashExecutor` (asynchron mit Transcript-Copy). Echte PTY-basierte Live-Interaktion mit Multi-Surface-Sync ist neu.

#### 8.9.1 Was die Live-View kann (Feature-Liste)

**Für nicht-interaktive Commands** (`echo`, `git status`, `npm test`, `composer install`):

| Element | Verhalten |
|---|---|
| **Live stdout/stderr** | Token-by-token Streaming, ANSI-Color-Codes werden gerendert (rote Fehler, grüne Häkchen, etc.) |
| **Elapsed Time im Header** | `Terminal — running for 14s` — Counter aktualisiert pro Sekunde |
| **Spinner-Animation** | Animierter Status-Dot (blauer Puls) während des Laufens |
| **Auto-Resize-Hint** | Wenn Output > 50 Zeilen, Card zeigt `… 124 more lines (expand to see all)` |
| **Exit-Code-Banner** | Nach Beendigung: `✓ exit 0 in 14.2s` (grün) oder `✗ exit 1 in 14.2s` (rot) |
| **Auto-Collapse-Verhalten** | Auto-collapsed wenn exit=0, **bleibt expanded wenn exit≠0** (siehe §8.8.3) |
| **Step-Cost-Footer** | Wenn der Command von einem LLM-Tool-Call ausgelöst wurde, Footer zeigt die Token-Cost des auslösenden LLM-Roundtrips |

**Für interaktive Commands** (Scripts, die `read()` auf stdin machen):

| Element | Verhalten |
|---|---|
| **„Waiting for input"-Banner** | Erscheint im Card, wenn Detection (siehe §8.9.3) eine Eingabe-Erwartung erkennt |
| **Inline-Input-Feld** | Direkt in der Card, mit Cursor-Fokus |
| **Sync zu IDE-Built-in-Terminal** | Wenn der User die Card öffnet, kann ein „Attach to IDE Terminal"-Button gedrückt werden — Output erscheint parallel im IDE-Terminal, Input ist von dort auch möglich |
| **Sync-Indikator** | Kleiner Pill `🔗 synced with IDE Terminal` im Card-Header, wenn Multi-Surface aktiv |
| **Conflict-Hinweis** | Wenn beide Surfaces gleichzeitig Input senden: first-write-wins, andere Surface zeigt Toast `Input already submitted from <other surface>` |

#### 8.9.2 Architektur

```
┌──────────────────────────────────────────────────────────────────┐
│                         Agent Core (Sidecar)                     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TerminalSessionManager                                 │    │
│  │  ───────────────────────                                │    │
│  │  Map<commandId, TerminalSession>                        │    │
│  │                                                         │    │
│  │  TerminalSession {                                      │    │
│  │    commandId, command, cwd, env                         │    │
│  │    status: pending | running | waiting-input | done     │    │
│  │    startTime, endTime, exitCode                         │    │
│  │    output: RingBuffer<Chunk>                            │    │
│  │    ptyProcess: IPty (node-pty)                          │    │
│  │    pendingInputPrompt: string | null                    │    │
│  │    subscribers: Set<SubscriberId>                       │    │
│  │  }                                                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│         ▲                                            ▲           │
│         │ stdout/stderr chunks                       │ stdin     │
│         │                                            │           │
│         ▼                                            │           │
│  ┌──────────────────────┐                            │           │
│  │  node-pty (real PTY) │ ← spawns child process     │           │
│  │  echo / git / python │   with TTY allocation      │           │
│  └──────────────────────┘                            │           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Broadcast Bus (JSON-RPC notifications)                 │    │
│  │   • terminal.output(commandId, chunk)                   │    │
│  │   • terminal.statusChange(commandId, newStatus)         │    │
│  │   • terminal.inputRequested(commandId, prompt)          │    │
│  │   • terminal.exit(commandId, exitCode, durationMs)      │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────┬────────────────────────┬────────────────────────────────┘
         │                        │
         ▼                        ▼
┌────────────────────┐  ┌────────────────────┐
│ JetBrains Chat-Card│  │ VS Code Chat-Card  │
│ (xterm.js renderer)│  │ (xterm.js renderer)│
└────────┬───────────┘  └────────┬───────────┘
         │                        │
         │ optional bridge        │ optional bridge
         ▼                        ▼
┌────────────────────┐  ┌────────────────────┐
│ JetBrains Terminal │  │ VS Code Terminal   │
│ (IDE-native, via   │  │ (IDE-native, via   │
│ TerminalView API)  │  │ Terminal Pseudoter-│
│                    │  │ minal API)         │
└────────────────────┘  └────────────────────┘
```

**Kern-Eigenschaften:**

| Eigenschaft | Bedeutung |
|---|---|
| **Single PTY** | Pro Command existiert genau **eine** PTY im Sidecar. Alle Surfaces sind reine Renderer dieses einen Streams. Das ist exakt `tmux`/`screen`-Pattern — bewährt, kein neuer Architektur-Bau. |
| **Output Ring-Buffer** | Letzte ~5000 Zeilen werden im Sidecar gepuffert, damit eine Surface, die nach 2 s eines Commands aufgemacht wird, den bisherigen Output noch nachholen kann |
| **Input-Multiplexing** | Stdin-Writes von jeder Surface werden serialisiert (FIFO-Queue) und an die PTY geschickt |
| **Reconnect-fähig** | Wenn die JetBrains-IDE neu startet, der Sidecar bleibt — die Card im Chat zeigt nach Reconnect den bisherigen Output und den Live-State |

#### 8.9.3 „Waiting for input"-Detection — drei kombinierte Strategien

Niemand löst das mit nur einer Strategie. Wir kombinieren:

| Strategie | Wie | Latenz | Zuverlässigkeit |
|---|---|---|---|
| **(a) Heuristik-Regex** | Letzte ~200 Bytes Output gegen Pattern: `\(y\/n\)`, `\[Y\/n\]`, `\? `, `Password:`, `: $`, `> $` | < 50 ms | False-Positives möglich (z. B. ein `?` in einer Output-Zeile) |
| **(b) PTY-stdin-Readiness** | Über `node-pty` Event-Hook: wenn Child gerade in `read()` hängt und seit > 200 ms keine Bytes von Child kamen | ~200 ms | Sehr zuverlässig, aber langsam |
| **(c) Idle-Timeout** | Wenn seit > 800 ms kein Output kommt **und** Heuristik schon getriggert hat → bestätigte „Waiting" | ~800 ms | Bestätigt, lässt Banner dauerhaft erscheinen |

UI-Flow:
1. Heuristik triggert → Banner erscheint **mit Animation** („Möglicherweise erwartet das Script Input")
2. Idle-Timeout bestätigt → Banner wird **solid** („Script wartet auf Input")
3. Output kommt wieder → Banner verschwindet automatisch

Das verhindert nervöses Auf-und-zu-Blinken bei Output-Pausen.

#### 8.9.4 Mockup

```
┌────────────────────────────────────────────────────────────────────┐
│ >_ Terminal — running for 14s        🔗 synced w/ IDE Terminal  ●  │
│                                                                    │
│   $ python scripts/setup-env.py                                    │
│                                                                    │
│   ✓ Loaded config from .env                                        │
│   ✓ Verified Python 3.11+                                          │
│   • Setting up database connection...                              │
│                                                                    │
│   ┌─ ⏸  Script waiting for input ───────────────────────────────┐  │
│   │ Database host (default: localhost):                         │  │
│   │ ┌─────────────────────────────────────────────────────────┐ │  │
│   │ │ db-staging.event4u.app                                  │ │  │
│   │ └─────────────────────────────────────────────────────────┘ │  │
│   │                                              [Send ⏎]      │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│   💡 Du kannst auch im IDE-Terminal antworten — beide Surfaces    │
│      sind synchron. Tipp: ESC öffnet das IDE-Terminal direkt.     │
└────────────────────────────────────────────────────────────────────┘
```

Nach erfolgreichem Senden des Inputs:

```
┌────────────────────────────────────────────────────────────────────┐
│ >_ Terminal — running for 28s                                  ●   │
│                                                                    │
│   $ python scripts/setup-env.py                                    │
│   ✓ Loaded config from .env                                        │
│   ✓ Verified Python 3.11+                                          │
│   • Setting up database connection...                              │
│   Database host (default: localhost): db-staging.event4u.app       │
│   ✓ Connection established                                         │
│   • Running migrations...                                          │
└────────────────────────────────────────────────────────────────────┘
```

#### 8.9.5 Dual-Surface-Sync — wie genau

**Two-way bridge zwischen Chat-Card und IDE-Built-in-Terminal:**

| Surface | Wie sie an die PTY hängt |
|---|---|
| **JetBrains Chat-Card** | xterm.js im JBCef-Webview (oder Compose-Terminal-Component) — Read/Write via JSON-RPC zum Sidecar |
| **JetBrains IDE-Terminal** | `TerminalView.executeCommand` exists, aber wir brauchen Mehr: per `JBTerminalWidget` mit `TtyConnector`, der auf unsere Sidecar-Pipe gemapped ist. **Spike erforderlich** (siehe §0.3) — alternativ in v1.0: nur Read-only-Mirror, kein Schreibzugriff vom IDE-Terminal |
| **VS Code Chat-Card** | xterm.js im Webview (Standard-Pattern) |
| **VS Code IDE-Terminal** | `vscode.window.createTerminal` mit `Pseudoterminal`-Provider, der unsere Sidecar-Pipe wrappt — wohldokumentiert, bewährt |

**Conflict-Resolution bei parallelem Input:**

- FIFO-Queue im Sidecar
- First-write-wins für den nächsten `read()`-Block im Child
- Andere Surfaces sehen Toast: `Input already submitted from <surface name>` mit Timestamp
- Bei Multi-Line-Sessions (wie Python REPL): jede Surface kann „beanspruchen" und für `claim_duration` Sekunden exklusiv schreiben — nach Inaktivität freigegeben

#### 8.9.6 Permission-Gate-Integration

Der `run_shell`-Tool-Call passiert **vor** der Live-View, durch das normale Permission-Gate (§8.8.11):

```
1. Agent: ich möchte `python scripts/setup-env.py` ausführen
2. Permission-Card erscheint (§8.8.11)
3. User: „Allow once"
4. Card kollabiert, neue Terminal-Card mit Live-View erscheint
5. Live-View bleibt bis Exit, ggf. mit interaktiven Banner zwischendurch
```

**Auto-Approve für interaktive Folge-Prompts:** Wenn ein Script mehrere Fragen stellt (z. B. ein `npm init`), wird **nicht** für jede einzelne Frage eine Permission-Card gezeigt — der Container-Command wurde approved, die Fragen sind Teil davon. Hard-Floor-Patterns (z. B. „Delete database? (y/n)") werden **trotzdem** als Confirmation gerendert, weil sie destruktiv sein können — diese Detection läuft auf demselben Heuristik-Stack wie 8.9.3.

#### 8.9.7 Externer-Claude-CLI-Attach (v1.5+, kein MVP, kein v1.0)

Idee: Wenn der User parallel `claude` im Terminal laufen hat (z. B. den Workflow, den der Screenshot in der Ausgangsfrage zeigt), könnte unser Plugin als **dritte Surface** an Claude-Code-CLIs Session attachen — beide Surfaces zeigen denselben Agent-State, User kann von beiden antworten.

Realistische Bewertung: das setzt voraus, dass Claude Code CLI ein stabiles Hook-/Socket-API exponiert (`~/.claude/hooks/`, IPC-Socket, oder ein `--attach`-Flag). Das ist derzeit **nicht** dokumentiert. Mögliche Wege:

1. **`PostToolUse`-Hooks** in Claude Code (siehe Augment-Hook-Mechanismus, der bereits Error-Messages im User-Screenshot zeigt) — wir registrieren Hooks, die Tool-Calls in unseren Sidecar spiegeln
2. **JSONL-Tail** auf `~/.claude/sessions/<id>.jsonl` — read-only Mirror, kein bidirektionaler Input möglich
3. **Claude-Code-CLI-PR an Anthropic**: ein offizielles `--attach` mit IPC-Socket

→ **Tracked als v1.5 Feature.** Erforderlich: Phase 0 Spike „Claude-Code-CLI Hook-Mechanik probieren" — kommt nach MVP.

#### 8.9.8 Was im MVP, was in v1.0, was in v1.5

| Stufe | Was funktioniert |
|---|---|
| **MVP** | Naive Tool-Card mit gestreamtem Output (kein PTY — einfaches Pipe-Spawn), Elapsed-Time-Counter, Exit-Code. Interaktive Scripts schlagen fehl mit klarer Message: „This command appears to need interactive input — not supported in MVP, use IDE-Terminal." |
| **v1.0** | PTY-Allokation, ANSI-Color, Spinner, Waiting-for-input-Detection (alle 3 Strategien), Inline-Input-Card. **Sync mit VS-Code-IDE-Terminal** funktioniert (Pseudoterminal-API ist robust). **JetBrains-IDE-Terminal-Sync nur read-only**, wenn der Spike in §0.3 schlechte Ergebnisse liefert. |
| **v1.5** | JetBrains-IDE-Terminal-Sync full read/write (`TtyConnector`-Implementation). Externer-Claude-CLI-Attach via Hooks. |

#### 8.9.9 Performance & Edge-Cases

| Szenario | Verhalten |
|---|---|
| Sehr hoher Throughput (`yes | head -1000000`) | Ring-Buffer wird zur Sicherheit auf 10 MB / 50k Zeilen gecapped. Bei Cap-Hit: Banner „Output truncated — see full log in IDE Terminal" |
| Command läuft > 10 Min ohne Output | Banner „No output for 10m — script may be stuck. [Abort]" |
| User schließt IDE während Command läuft | Sidecar bleibt am Leben, Command läuft weiter (sofern nicht via Settings „kill on disconnect" aktiviert). Beim Re-Open der IDE: Card wird mit aktuellem State wieder gerendert |
| Multi-Byte-UTF-8 mitten in Chunk-Boundary | Standard-Chunked-Decoder wartet auf vollständige Sequenz, kein Mojibake |
| Windows-Specifics (CRLF, fehlende ANSI-Support in alten cmd.exe) | Wir setzen `TERM=xterm-256color` und nutzen ConPTY (Windows 10 1809+); Fallback auf line-buffered für ältere Windows |

### 8.10 `packages/protocol` — JSON-RPC Schema

Zod-Schemas als Source-of-Truth → Codegen für Kotlin-DTOs.

**Beispiel-Schema (Chat):**
```typescript
export const ChatTurnRequest = z.object({
  conversationId: z.string(),
  message: z.string(),
  attachments: z.array(Attachment).optional(),
});

export const ChatTurnEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({ type: z.literal("tool_call"), tool: ToolCall }),
  z.object({ type: z.literal("halt"), question: z.string(), options: z.array(z.string()) }),
  z.object({ type: z.literal("done"), usage: Usage }),
]);
```

**Beispiel-Schema (Terminal — für §8.9):**
```typescript
export const TerminalOutputEvent = z.object({
  type: z.literal("terminal.output"),
  commandId: z.string(),
  chunk: z.string(),              // ANSI-encoded bytes as UTF-8 string
  stream: z.enum(["stdout", "stderr"]),
  seq: z.number(),                // monotonic sequence for replay
});

export const TerminalStatusEvent = z.object({
  type: z.literal("terminal.status"),
  commandId: z.string(),
  status: z.enum(["pending", "running", "waiting-input", "done"]),
  elapsedMs: z.number(),
  exitCode: z.number().optional(),
  pendingPrompt: z.string().optional(),    // Heuristik-erkannter Prompt-Text
});

export const TerminalInputRequest = z.object({
  type: z.literal("terminal.input"),
  commandId: z.string(),
  data: z.string(),               // Bytes that will be written to PTY stdin
  source: z.enum(["chat-card", "ide-terminal", "external-cli"]),
});

export const TerminalSubscribe = z.object({
  type: z.literal("terminal.subscribe"),
  commandId: z.string(),
  replayFromSeq: z.number().optional(),    // Reconnect-after-restart
});
```

Codegen läuft im CI; Kotlin-Counterpart ist `data class ChatTurnRequest(val conversationId: String, val message: String, ...)`.

---

## 9. LLM-Provider-Strategie — Dual Mode (API + CLI)

> **Kern-Idee:** Augment und SweepAI verkaufen ihren eigenen Cloud-Dienst. Wir wollen das Gegenteil: Der User entscheidet pro Modell, ob er **die offizielle API** (Token-Billing) oder **die installierte CLI** (oft Subscription-basiert und günstiger) nutzt. Das schaltet User-vorhandene Subscriptions (Claude Pro/Max, ChatGPT Plus, etc.) als Backend frei.

### 9.1 Zwei Backend-Modi pro Modell

| Modus | Beschreibung | Auth | Pricing |
|---|---|---|---|
| **API** | Direkter HTTP-Call zur Provider-API | API Key | Pay-per-token |
| **CLI** | Wrapper um lokal installiertes CLI (Subprozess mit stdio/JSON) | CLI's eigene Auth (OAuth, Subscription) | Subscription |

Ein Modell wie *claude-sonnet-4-6* kann via beide Wege aufrufbar sein. Im Chat-Fenster ist die Wahl pro Konversation toggleable.

### 9.2 Unterstützte Provider (Matrix)

| Provider | API-Mode | CLI-Mode | CLI-Binary | CLI-Auth-Quelle | Status |
|---|---|---|---|---|---|
| **Anthropic** | ✅ Messages API mit Tool Use | ✅ `claude` (Claude Code CLI) | `claude` (npm `@anthropic-ai/claude-code`) | Pro/Max-Subscription oder API-Key | MVP |
| **OpenAI** | ✅ Responses API | ✅ `codex` (OpenAI Codex CLI) | `codex` (Beta) | ChatGPT Plus/Pro/Team oder API-Key | MVP |
| **Google Gemini** | ✅ Gemini API | ✅ `gemini` (Gemini CLI) | `gemini` (npm `@google/gemini-cli`) | Gemini Code Assist Subscription oder API-Key | v1.0 |
| **OpenAI-compat** | ✅ Beliebige Endpoints | — | — | — | MVP |
| **Ollama** | ✅ `localhost:11434` | n/a (Ollama ist lokal) | — | — | v1.0 |
| **Aider** | — | ✅ `aider` (Multi-Provider-CLI) | `aider` (pip) | Aiders eigene API-Auth | v1.0 |
| **Cline (CLI)** | — | ✅ falls Cline CLI verfügbar | `cline` | Cline-eigene | v1.5 |
| **Custom HTTP** | ✅ konfigurierbar | — | — | — | v1.0 |
| **Custom CLI** | — | ✅ via Subprozess-Wrapper | beliebig | beliebig | v1.5 |

### 9.3 Backend-Abstraktion

```typescript
// packages/core/llm/backend.ts

interface LLMBackend {
  readonly id: string;                  // "anthropic-api", "anthropic-cli", "openai-api", ...
  readonly providerId: string;          // "anthropic", "openai", ...
  readonly mode: "api" | "cli";
  readonly displayName: string;
  readonly capabilities: Capabilities;
  readonly isAvailable: () => Promise<AvailabilityCheck>;

  send(req: ChatRequest, opts: SendOptions): AsyncIterable<StreamEvent>;
  cancel(requestId: string): Promise<void>;

  // Pricing surface (API: exact, CLI: best-effort)
  pricingMode: "exact" | "estimated" | "subscription-flat";
  estimateCost(usage: Usage): CostEstimate;
}

interface AvailabilityCheck {
  available: boolean;
  reason?: string;
  setupAction?: () => Promise<void>;    // "Install CLI", "Sign in", etc.
}

interface Capabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  longContext: boolean;
  thinking: boolean;
  contextCaching: boolean;
}
```

### 9.4 CLI-Detection (automatisch beim Plugin-Start)

Beim Plugin-Start läuft ein `CliDetectionService`, der für jeden bekannten CLI prüft:

1. **Binary-Auflösung:** `which <binary>` (POSIX) / `where <binary>` (Windows) im User-`PATH`.
2. **Version-Check:** `<binary> --version` mit Mindest-Version-Match (Semver-Range pro CLI).
3. **Auth-Check (best-effort, ohne Login):** für Claude Code `claude config get`, für `codex` analog. Falls signed-in → CLI-Backend als „active" markieren.
4. **Capability-Probe:** prüft, ob CLI strukturierte Outputs unterstützt (`--output-format=stream-json` etc.).

Ergebnis wird in der Settings-Page und im Chat-Modell-Picker angezeigt:

```
Anthropic
  Claude Sonnet 4.6
    ✅ API (key set)
    ✅ CLI: claude v0.10.2 (signed in as user@example.com)   ← Toggle als Default
  Claude Opus 4.6
    ✅ API
    ✅ CLI

OpenAI
  GPT-5
    ⚠️ API (no key)
    ✅ CLI: codex v0.4.0 (signed in)

Google
  Gemini 2.5 Pro
    ⚠️ API (no key)
    ❌ CLI not installed   [Install Gemini CLI]
```

### 9.5 API-Mode Implementation

Pro Provider eine konkrete Klasse:

```typescript
class AnthropicApiBackend implements LLMBackend {
  mode = "api";
  pricingMode = "exact";

  async *send(req: ChatRequest, opts: SendOptions) {
    const stream = anthropic.messages.stream({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      system: req.system,
      max_tokens: opts.maxTokens,
    }, { signal: opts.signal });

    for await (const event of stream) {
      yield mapAnthropicEventToCommon(event);
    }
  }
}
```

Prompt-Caching wird automatisch aktiviert (Anthropic-`cache_control` Header auf System-Prompt und Tools — bringt 90% Kostenreduktion bei wiederholten Calls).

### 9.6 CLI-Mode Implementation

Pro CLI eine Adapter-Klasse, die das CLI als Subprozess startet:

```typescript
class ClaudeCliBackend implements LLMBackend {
  mode = "cli";
  pricingMode = "subscription-flat";  // bekannt: keine direkte Token-Kosten, aber Tracking trotzdem

  async *send(req: ChatRequest, opts: SendOptions) {
    // Claude Code CLI unterstützt --output-format=stream-json
    const child = spawn("claude", [
      "-p", "--output-format=stream-json", "--input-format=stream-json"
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });

    // Schreibe Prompt + Messages als JSONL nach stdin
    child.stdin.write(serializeChatRequest(req));
    child.stdin.end();

    for await (const line of readJsonLines(child.stdout)) {
      yield mapClaudeCliEventToCommon(line);
    }
  }

  estimateCost(usage: Usage) {
    return {
      amount: 0,
      currency: "USD",
      note: "Counted against Claude Pro/Max subscription (no per-call cost)",
      tokenBreakdown: usage,
    };
  }
}
```

**Wichtig:** Auch im CLI-Modus tracken wir die **Token-Mengen** (CLI emittiert die in den JSON-Events), nur die **monetäre Umrechnung** ist 0 (oder ein berechneter Anteil der Monats-Subscription, siehe §14.5).

### 9.7 Chat-Window: Mode-Toggle, Stop & Sessions

Im Chat-Header steht der Modell-Picker, das Mode-Toggle, ein **Zahnrad-Icon** mit CLI-spezifischen Controls (§9.11), ein **Stop-Button** (§9.12) und oben rechts ein **Sessions-Button** (§9.13) — analog zu Augments Sessions-Liste:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  💬 New Chat                                              [📚 Sessions]  │
│  Model: [Claude Sonnet 4.6  ▼]   Mode: ( API | CLI ⚡) ⚙                │
│                                              ▲          ▲                │
│                                    aktiv (CLI)   per-CLI gear (§9.11)   │
│  ──────────────────────────────────────────────────────────────────────  │
│  [running…  3.4s   18,422 in / 312 out so far]                ⏹ Stop ESC│
│                                                                ▲         │
│                                                       §9.12 Stop-Button  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **`📚 Sessions`** oben rechts: öffnet den Session-Browser (§9.13) als Overlay oder als linke Sidebar — User-Wahl in Settings
- **`⚙` neben Mode**: erscheint nur wenn Mode=CLI, öffnet das per-CLI Settings-Panel (§9.11) inline
- **`⏹ Stop`**: erscheint nur wenn etwas läuft, mit ESC-Shortcut-Hint, immer sichtbar während Streaming/Tool-Calls (§9.12)

Mode-Wahl ist **pro Konversation** (nicht global). Default kommt aus `.agent-settings.yml`:

```yaml
llm:
  default_provider: anthropic
  default_mode: cli       # "api" | "cli" | "auto"  ("auto" = CLI wenn verfügbar, sonst API)
  cli_preferred_when_available: true
  models:
    anthropic:
      models:
        - id: claude-sonnet-4-6
          api:
            enabled: true
            api_key_env: ANTHROPIC_API_KEY
          cli:
            enabled: auto   # "auto" = detect + use
            binary: claude
            args_extra: []
    openai:
      models:
        - id: gpt-5
          api:
            enabled: true
          cli:
            enabled: auto
            binary: codex
```

### 9.8 Tool-Calling-Normalisierung

Da jeder Provider (und sogar API vs CLI desselben Providers) ein eigenes Tool-Format hat, normalisiert der Core auf ein gemeinsames Schema. Beispiel: Anthropic API gibt `tool_use` blocks, Claude Code CLI emittiert `event: tool_use` JSONL — beide werden zum selben `NormalizedToolCall` übersetzt.

```typescript
type NormalizedToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  source: "api" | "cli";
};
```

### 9.9 Failures & Fallbacks

| Szenario | Verhalten |
|---|---|
| CLI nicht installiert | Mode-Picker zeigt CLI als grau, Toggle auf API |
| CLI signed out | Banner im Chat: „Run `claude login` to use CLI mode" |
| CLI Version zu alt | Banner mit Update-Hinweis |
| CLI hängt > Timeout | Auto-Cancel + Fallback-Vorschlag „Try API mode" |
| API Key abgelaufen | Settings-Deeplink + Banner |
| Rate-Limit erreicht | Bei Auto-Mode → automatischer Switch zu CLI (oder umgekehrt) |
| Beide nicht verfügbar | Chat ist disabled, klare Anweisung |

### 9.10 Custom-LLM-Endpoints (event4u)

Wenn event4u später einen eigenen LLM-Endpoint (proxied, gehärtet, mit Logging) anbietet, ist das einfach ein weiterer `CustomApiBackend`:

```yaml
custom_endpoints:
  - id: event4u-internal
    base_url: https://llm.event4u.app
    auth:
      type: bearer
      env: EVENT4U_LLM_TOKEN
    api: openai-compat   # oder anthropic-compat oder custom
    models:
      - id: event4u-coder-v1
        max_tokens: 200000
        supports_tools: true
        pricing:
          input_per_1m: 0      # interner Endpoint, Kostenstelle separat
          output_per_1m: 0
```

Custom CLIs werden analog als `CustomCliBackend` registriert.

### 9.11 Per-CLI Backend Controls — das Zahnrad-Icon

> **Idee:** Jede CLI hat ein eigenes Set an Modes, Flags und Inline-Befehlen (Claude Code: ESC/Shift+Tab/`/clear`; Codex: eigene Flags; Aider: `/architect`, `/code`; Gemini: andere). Statt eine Lowest-Common-Denominator-UI zu bauen, deklariert jedes CLI-Backend ein **Capability-Manifest**, und das Zahnrad rendert genau die Controls, die diese CLI unterstützt — nicht mehr und nicht weniger.

#### 9.11.1 Capability-Manifest pro Backend

```typescript
// packages/core/llm/cli/capabilities.ts

interface CliCapabilities {
  cliId: string;                              // "claude", "codex", "gemini", "aider"
  binaryName: string;
  versionRange: string;                        // semver für unterstützte Range

  // Abort-Mechanik
  abort: {
    method: "sigint" | "esc-via-stdin" | "json-rpc-cancel";
    keystroke: string;                         // z. B. "ESC" oder "Ctrl+C"
    cleanupTimeoutMs: number;                  // max wait für graceful shutdown
  };

  // Auto-Modes (was Claude Code mit Shift+Tab durchschaltet)
  autoModes?: {
    modes: Array<{
      id: string;
      label: string;
      description: string;
      cliFlag?: string;                        // z. B. "--permission-mode acceptEdits"
    }>;
    cycleKeystroke?: string;                   // "Shift+Tab" für Claude Code
  };

  // Inline-Befehle, die das CLI versteht
  slashCommands?: Array<{
    command: string;                           // "/clear", "/compact", "/undo"
    label: string;
    description: string;
    sendAs: "stdin" | "flag";
  }>;

  // Modell-Switching mid-session
  modelSwitch?: {
    supported: boolean;
    availableModels: string[];
    switchVia: "flag-restart" | "stdin-command";
  };

  // Permission-Modes (was Claude Code's `--permission-mode` macht)
  permissionModes?: Array<{
    id: string;                                // "default", "acceptEdits", "plan", "bypassPermissions"
    label: string;
    description: string;
    danger?: "safe" | "moderate" | "dangerous";
  }>;

  // Verbosity-Level
  verbosityLevels?: string[];

  // Session-Management (für §9.13)
  sessionFiles: {
    location: string;                          // z. B. "~/.claude/projects/<project>/sessions/*.jsonl"
    format: "jsonl" | "json" | "sqlite" | "custom";
    parserModule: string;                      // welcher Adapter parsed die Files
    resumeFlag: string;                        // z. B. "--resume <id>"
  };

  // Working-Directory-Handling
  cwdControl: {
    canChangeViaFlag: boolean;
    flag?: string;                             // z. B. "--cwd <path>"
  };
}
```

#### 9.11.2 Konkrete Manifests (kuratiert auf Stand Mai 2026 — Drift möglich)

```typescript
const CLAUDE_CODE_CAPABILITIES: CliCapabilities = {
  cliId: "claude",
  binaryName: "claude",
  versionRange: ">=0.10.0",

  abort: { method: "sigint", keystroke: "ESC", cleanupTimeoutMs: 2000 },

  autoModes: {
    modes: [
      { id: "manual", label: "Manual", description: "Approve each tool call" },
      { id: "acceptEdits", label: "Accept Edits", description: "Auto-approve file edits, ask for shell",
        cliFlag: "--permission-mode acceptEdits" },
      { id: "auto", label: "Full Auto", description: "All tools auto-approved (use with care)",
        cliFlag: "--permission-mode bypassPermissions" },
      { id: "plan", label: "Plan only", description: "No edits, just produce a plan",
        cliFlag: "--permission-mode plan" },
    ],
    cycleKeystroke: "Shift+Tab",
  },

  slashCommands: [
    { command: "/clear", label: "Clear context", description: "Forget conversation history", sendAs: "stdin" },
    { command: "/compact", label: "Compact", description: "Summarize earlier turns to free context window", sendAs: "stdin" },
    { command: "/cost", label: "Show cost", description: "Show running cost in chat", sendAs: "stdin" },
    { command: "/resume", label: "Resume session", description: "Resume a past session", sendAs: "flag" },
  ],

  modelSwitch: {
    supported: true,
    availableModels: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    switchVia: "flag-restart",
  },

  permissionModes: [
    { id: "default", label: "Default", description: "Ask before any non-trivial action", danger: "safe" },
    { id: "acceptEdits", label: "Accept Edits", description: "Auto-approve file writes", danger: "moderate" },
    { id: "plan", label: "Plan-only", description: "No execution, no edits", danger: "safe" },
    { id: "bypassPermissions", label: "Bypass All", description: "DANGEROUS — auto-approves everything including shell", danger: "dangerous" },
  ],

  verbosityLevels: ["quiet", "normal", "verbose"],

  sessionFiles: {
    location: "~/.claude/projects/<cwd-hash>/sessions/*.jsonl",
    format: "jsonl",
    parserModule: "@event4u-agent/cli-adapters/claude-code",
    resumeFlag: "--resume",
  },

  cwdControl: { canChangeViaFlag: true, flag: "--cwd" },
};

// Analog für CODEX_CAPABILITIES, GEMINI_CAPABILITIES, AIDER_CAPABILITIES — siehe packages/core/llm/cli/manifests/
```

> **Wartung:** CLIs ändern sich häufig. Wir tracken die Manifests gegen die offiziellen Docs der jeweiligen CLI (Stand pro CLI in `cli/manifests/<cli>.ts` als Kommentar dokumentiert: "Verified against claude vX.Y.Z on 2026-MM-DD"). Im Plugin zeigt der Settings-Dialog: *"Capabilities last validated against `claude` v0.10.2 (your installed: v0.10.3) — minor drift, may have new features."*

#### 9.11.3 Zahnrad-Panel-Mockup

Klick auf `⚙` neben dem Mode-Toggle öffnet inline ein Panel:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙ Claude Code CLI · v0.10.2                              ✕    │
│  ────────────────────────────────────────────────────────────   │
│                                                                 │
│  Auto-Mode                              Shift+Tab cycles ↻      │
│   ○ Manual           — Approve each tool call                   │
│   ● Accept Edits     — Auto-approve file edits                  │
│   ○ Full Auto        — All tools auto (use with care)           │
│   ○ Plan only        — No edits, just plan                      │
│                                                                 │
│  Model                                                          │
│   [ Claude Sonnet 4.6  ▼ ]   (switch restarts CLI session)     │
│                                                                 │
│  Verbosity                                                      │
│   ○ Quiet  ● Normal  ○ Verbose                                  │
│                                                                 │
│  Inline-Befehle (auch via `/` im Chat-Input)                    │
│   [ /clear ]   [ /compact ]   [ /cost ]                         │
│                                                                 │
│  Permissions  ▼                                                 │
│   ☑ Allow file reads                                            │
│   ☑ Allow file writes (after diff approval)                     │
│   ☐ Allow shell commands without prompt                         │
│   ☐ ⚠ Bypass all permissions (dangerous!)                       │
│                                                                 │
│  Keyboard im Chat                                               │
│   • ESC = abort current generation                              │
│   • Shift+Tab = cycle Auto-Modes                                │
│   • Ctrl+Z = undo last edit (if CLI supports)                   │
│                                                                 │
│  Session                                                        │
│   ID: clz-2026-05-27-a14f8b                                     │
│   [ View JSONL ]  [ New Session ]  [ Resume other… ]           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Wenn der User auf **Mode=API** umschaltet, ändert sich das Zahnrad-Panel-Inhalt entsprechend zu API-spezifischen Controls (Temperature, Top-P, Max Tokens, Cache Control, etc.) — gleicher Mechanismus, anderes Manifest.

#### 9.11.4 Fallback bei unbekannter CLI-Version

Wenn der User eine CLI installiert hat, die **neuer** ist als unser Capability-Manifest, zeigen wir:

```
⚠ Your `claude` v0.12.0 is newer than our last validated version (v0.10.2).
   Controls below may be incomplete. Some new flags might not be exposed.
   [ Open raw CLI args field ]   [ Report manifest gap ]
```

Der „Raw CLI args" Escape-Hatch erlaubt dem User, beliebige zusätzliche Flags an den Subprozess zu hängen — abgesichert durch eine Allowlist (kein `-c` Code-Injection).

### 9.12 Stop / Abort — über alle Modi konsistent

> **Pflicht-Feature, in MVP.** Ohne kann man eine teure Conversation oder einen hängenden Tool-Loop nicht killen. Muss zu 100 % zuverlässig sein und auf jedes Backend wirken.

#### 9.12.1 Drei Cancellation-Layer

Eine Stop-Aktion läuft durch drei Layer, in Reihenfolge:

```
User klickt Stop / drückt ESC
      │
      ▼
┌──────────────────────────────────────┐
│ Layer 1: Plugin-UI                   │  Sofort: Stop-Button → "stopping…"
│ • Abort-Controller-Signal an Sidecar │  ESC-Shortcut nur wenn Chat-Focus
└──────────────────────────────────────┘
      │ JSON-RPC: chat.cancel(turnId)
      ▼
┌──────────────────────────────────────┐
│ Layer 2: Agent-Core (Sidecar)        │  Stoppt Phase-Machine
│ • AbortController in JS              │  Lässt aktuelle Tool-Calls beenden (max 2s grace)
│ • Cleanup-Phase startet              │  Persistent PTY-Children kriegen SIGINT
└──────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────┐
│ Layer 3: Backend                     │  Pro Backend-Typ unterschiedlich:
│ • API: HTTP request abort()          │  → schließt Stream
│ • CLI: gemäß CliCapabilities.abort   │  → SIGINT / ESC-via-stdin / RPC-cancel
│ • Tool-PTY: SIGTERM → SIGKILL nach   │  
│   2s wenn nicht clean exit           │  
└──────────────────────────────────────┘
```

#### 9.12.2 Was passiert mit teilweisem Output

Bei einem Stop **mitten in einem Stream**:

| Zustand | Verhalten |
|---|---|
| LLM streamt Tokens | Bisher empfangene Tokens bleiben in der Assistant-Card, mit Footer `⚠ Stopped — partial response` |
| Tool-Call läuft (read_file) | Tool-Call wird als „cancelled" markiert, Card zeigt `⚪ cancelled` Status-Dot |
| Tool-Call läuft (run_shell mit PTY) | PTY-Process bekommt SIGINT, dann nach 2 s SIGKILL. Card zeigt letzten Output, Exit-Code 130 (SIGINT) oder 137 (SIGKILL) |
| Multi-Step-Agent-Loop läuft, gerade in Phase „Plan" | Phase wird abgebrochen, Plan-Card zeigt `⚪ cancelled mid-plan`, kein File-State angefasst |
| Multi-Step-Agent-Loop, gerade in „Edit"-Phase, 2 von 5 Files bereits geschrieben | Files 3–5 werden NICHT geschrieben. Files 1–2 bleiben (sind committed). Banner: "Partial apply — 2 of 5 files written. [ Revert applied edits ]" |
| API-Call wurde gerade gestartet, noch kein Token zurück | Request wird abgebrochen, **Cost-Tracker bucht trotzdem die geschätzten Input-Tokens** falls der Provider sie berechnet (Anthropic: ja, OpenAI: meist nein) — wir loggen das als `cost: estimated-pre-abort` |

#### 9.12.3 Stop-Knopf-Verhalten im UI

```
[ ⏹ Stop ESC ]              ← initial, immer sichtbar wenn etwas läuft
       │ click
       ▼
[ ⏳ Stopping…  ]            ← 0–2s, "graceful cancel" Phase
       │ wenn nach 2s nicht durch
       ▼
[ 💀 Force Stop ]            ← zeigt Force-Kill-Optionen
       │ click
       ▼
SIGKILL auf PTY-Children, harter API-Abort
```

ESC im Chat-Eingabe-Feld triggert den **Stop nur wenn etwas läuft** — sonst hat ESC normale Funktion (Editor-Fokus zurück). Damit kein Konflikt mit normaler IDE-ESC-Funktion.

#### 9.12.4 Multi-Conversation-Stop

Falls mehrere Konversationen parallel laufen (theoretisch möglich, in v1.0+):
- Stop wirkt pro Conversation (nicht global)
- Im Sessions-Tab (§9.13) zeigt jeder Eintrag mit laufendem State einen eigenen kleinen ⏹ Inline-Button

### 9.13 Session History & Resume — der Sessions-Button

> **Idee:** Augment hat einen Sessions-Knopf oben in der Tool-Window-Toolbar, der eine Liste vergangener Konversationen zeigt. Wir bauen das **unified über alle Backends**: API-Sessions aus unserer `tracking.db`, plus **CLI-Sessions aus den Session-Files der jeweiligen CLIs**. Der User sieht eine einzige Liste, kann filtern, Session anklicken → Resume.

#### 9.13.1 Session-Quellen (was wir aggregieren)

| Quelle | Wo liegen die Files | Format | Wer sieht sie |
|---|---|---|---|
| **Unsere API-Sessions** | `.event4u-agent/chats/<id>.json` + `tracking.db` `conversation_summaries` | Eigenes JSON-Format | Plugin-eigene Conversations |
| **Claude Code CLI** | `~/.claude/projects/<cwd-hash>/sessions/*.jsonl` | JSONL (Anthropic-Format) | Alle Claude-CLI-Sessions, **auch die außerhalb des Plugins** (z. B. wenn User parallel `claude` im Terminal nutzte) |
| **Codex CLI** | `~/.codex/sessions/*.jsonl` (Stand Mai 2026) | JSONL | Alle Codex-CLI-Sessions |
| **Gemini CLI** | `~/.gemini/sessions/*` | proprietär, Adapter nötig | Alle Gemini-CLI-Sessions |
| **Aider** | `.aider.chat.history.md` pro cwd | Markdown | Alle Aider-Sessions im aktuellen Repo |

Jeder Quell-Typ hat einen Adapter-Modul, der eine **`SessionSummary`** liefert:

```typescript
interface SessionSummary {
  id: string;                           // intern unique
  source: "api" | "claude-cli" | "codex-cli" | "gemini-cli" | "aider";
  provider: string;
  model?: string;
  title: string;                        // Auto-derived (erste User-Message, getrimmt)
  startedAt: number;                    // epoch ms
  lastMessageAt: number;
  messageCount: number;
  totalCostUsd?: number;                // null für sub-flat / unbekannt
  totalTokens?: number;
  cwd?: string;                         // wo wurde die Session geführt
  status: "active" | "completed" | "interrupted" | "unknown";
  rawFilePath?: string;                 // damit User "Open raw" kann
}
```

#### 9.13.2 Session-Browser-Mockup (Overlay-Variante)

Klick auf `[📚 Sessions]` öffnet einen Overlay über dem Chat-Panel:

```
┌─────────────────────────────────────────────────────────────────────┐
│  📚 Sessions                                                   ✕    │
│  ─────────────────────────────────────────────────────────────────  │
│  Filter:  [All sources ▼]  [All time ▼]  [🔍 search…           ]   │
│                                                                     │
│  🟢 Active now (1)                                                  │
│   ⏺ /implement-ticket PROJ-789      Claude CLI · acceptEdits        │
│      28 messages · $0.42 shadow · started 14m ago                   │
│      cwd: /Users/.../event4u-main      [ Switch to ]  [ ⏹ Stop ]   │
│                                                                     │
│  📅 Today (5)                                                       │
│   • Refactor auth middleware        API · Sonnet 4.6                │
│      14 messages · $0.18 · 2h ago                                   │
│      [ Resume ]  [ Open raw JSON ]                                  │
│                                                                     │
│   • Fix race condition in queue     Claude CLI                      │
│      9 messages · $0.04 shadow · 4h ago                             │
│      [ Resume ]  [ Open .jsonl ]                                    │
│                                                                     │
│   • npm test debugging              Codex CLI                       │
│      6 messages · $0.02 shadow · 6h ago                             │
│      [ Resume ]                                                     │
│                                                                     │
│   • Quick question about Zod        API · Haiku 4.5                 │
│      3 messages · $0.001 · 8h ago                                   │
│      [ Resume ]  [ Delete ]                                         │
│                                                                     │
│  📅 Yesterday (12) ▶                                                │
│  📅 Last week (47) ▶                                                │
│  📅 Older (213) ▶                                                   │
│                                                                     │
│  ───────────────────────────────────────────────────────────────── │
│  📁 External sessions detected                                      │
│   18 Claude-CLI sessions from terminal (not started in plugin)      │
│   [ Import & show ]  [ Hide forever ]                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Wichtige UX-Details:**

| Detail | Verhalten |
|---|---|
| **Sortierung** | Nach `lastMessageAt` desc, mit Datums-Gruppen-Headern |
| **„Active now"-Abschnitt** | Gepinnt oben, zeigt alle laufenden Sessions inkl. inline Stop-Button |
| **Source-Filter** | Multi-Select: `Plugin (API)`, `Claude CLI`, `Codex CLI`, `Gemini CLI`, `Aider`, `External (außerhalb Plugin geführt)` |
| **Filter „External"** | Sessions, die nicht im Plugin gestartet wurden (User hat parallel `claude` im Terminal genutzt) werden separat geführt — Augments-Style trennt das nicht; wir machen es transparent |
| **„Resume"** | Verhalten je Source — siehe 9.13.3 |
| **„Open raw"** | Öffnet die underlying JSONL/JSON-File im IDE-Editor (read-only Tab) — für Debugging und Audit |
| **Bulk-Delete** | Nur für Plugin-eigene Sessions; CLI-Sessions können wir nicht aus den CLI-Files löschen (das täte die CLI-Tools beschädigen) — wir bieten an, sie **aus unserer Anzeige zu blenden**, mit Toast „File untouched, only hidden from list" |

#### 9.13.3 Resume — wie es technisch funktioniert

| Source | Resume-Mechanik |
|---|---|
| **Plugin-API-Session** | Conversation-State aus `.event4u-agent/chats/<id>.json` laden, Messages in Chat-UI rendern, neuer User-Turn wird normaler API-Call mit voller History |
| **Claude Code CLI** | Spawn `claude --resume <session-id>` als neuer Subprozess. Output wird gestreamt, User-Input geht an stdin. Plugin merkt sich, dass diese Conversation an einer externen Session hängt — beim Senden einer neuen Nachricht stoppen wir den Prozess nicht, sondern füttern stdin |
| **Codex CLI** | Analog: `codex --resume <id>` (Flag-Name kann variieren — Capability-Manifest §9.11 hält das aktuelle) |
| **Aider** | Aider arbeitet historisch über die Markdown-File. Resume = spawn `aider --restore-chat-history` mit existierender File. Bei v1.0 vermutlich Read-only Anzeige, kein Live-Resume — Aider-Adapter ist v1.5 |
| **Externe Sessions (nicht im Plugin gestartet)** | Identisch zu CLI-Resume — wir können jede Claude-CLI-Session resumen, egal ob sie ursprünglich im Plugin oder im Terminal gestartet wurde |

**Wichtiger Edge-Case:** Wenn der User eine externe CLI-Session resumed und der Sidecar-Process der gleichen CLI-ID schon läuft, zeigen wir einen Konflikt-Dialog: *"Session is already attached to another window/instance. [Take over] [Open read-only]"*.

#### 9.13.4 Live-Detection & Watch

- Beim Plugin-Start: scan aller bekannten Session-File-Locations (mit `chokidar` Watcher), Manifest pro CLI weiß wo sie liegen
- Sessions, die seit dem letzten Start dazugekommen sind, werden mit kleinem `NEW` Badge versehen
- Aktualisierung in Echtzeit: wenn der User in einem externen Terminal `claude` startet und tippt, sehen wir die neue Session sofort und sie erscheint unter „Active now"

#### 9.13.5 Storage-Größe & Cleanup

CLI-Session-Files können groß werden (mehrere MB pro langer Session). Wir lesen sie **lazy**: erst der Header (für Summary), erst beim Resume der volle Inhalt.

Cleanup-Policy in Settings:

```yaml
sessions:
  scan:
    enabled: true
    locations:
      - "~/.claude/projects/**/sessions/*.jsonl"
      - "~/.codex/sessions/*.jsonl"
      - "{cwd}/.aider.chat.history.md"
  display:
    max_listed: 500                       # älter wird gepruned in der UI (Files bleiben)
    show_external: prompt-first-time       # zeigt erst nach explizitem User-OK
  cleanup:
    plugin_chats_after_days: 90            # nur unsere eigenen Files
    cli_files: never                        # niemals löschen — gehören der CLI
```

---

## 10. agent-config Integration — der eigentliche Differenziator

> **Leitprinzip:** Dieses Plugin ist primär ein **IDE-Host für `@event4u/agent-config`**, sekundär ein generischer Coding-Agent. Ohne agent-config gäbe es kein Plugin — dann würden wir Continue.dev forken. Mit agent-config hat das Plugin einen klaren Existenzgrund: **kuratiertes Domain-Wissen direkt im Editor, ohne dass User es manuell prompten müssen.**
>
> Alle anderen Features (LLM-Provider-Abstraktion, Cost-Tracking, Diff-Apply) sind Mittel zum Zweck — sie sind nötig, damit agent-config-Skills überhaupt ausgeführt werden können. Sie sind nicht der Grund, warum das Plugin existiert.

### 10.0 Was diese Integration konkret leistet

| Mechanismus | Wirkung im Plugin | Warum das ein Vorteil gegenüber Augment/Continue ist |
|---|---|---|
| **Skills als first-class Tools** | Jeder Skill (z. B. `api-design`, `migration-architect`) erscheint im Slash-Command-Picker und kann vom Agent selbst über das `skill_lookup` MCP-Tool aufgerufen werden | Augment muss generisches API-Design-Wissen raten; wir haben kuratierte Procedure-Steps |
| **Rules als immer-aktive Constraints** | Rules werden ans System-Prompt vorne gehängt, sodass jeder LLM-Call die event4u-Konventionen kennt | Continue.dev hat keine kuratierte Rule-Library — User müssen alles selbst in System-Prompts schreiben |
| **Commands als ausführbare Workflows** | `/commit`, `/work`, `/implement-ticket` etc. — versionierte, getestete Workflows | Cline hat „Custom Modes" aber keine zentral kuratierte Command-Library |
| **Personas als Review-Lenses** | Agent kann im selben Code mit verschiedenen Lenses arbeiten (Senior Engineer, QA, Security) | Niemand anders bietet Persona-System auf diese Granularität |
| **Hooks für sessionStart/End/Stop** | Plugin respektiert agent-config-Hooks (z. B. Pre-flight-Check, Post-Run-Audit) | Eigenes Hook-System statt es vom Plugin zu replizieren |
| **Trust-Level-Konzept** | `core` / `community` / `experimental` Skills bekommen unterschiedliche Approval-Defaults | Sicherheits-Floor, der direkt aus dem Content kommt — nicht aus Plugin-Code |

**Praktisches Beispiel:** Ein event4u-Entwickler schreibt einen neuen Laravel-Endpoint. Statt zu prompten *„Wie baue ich einen REST-Endpoint in unserem Stil?"* tippt er `/api-design`. Der Skill liefert dem LLM den vollständigen Procedure-Block (Route-Registration, Request-Validation, Response-Shape-Konvention, Test-Pattern), den event4u für genau diesen Repo etabliert hat. Das LLM muss nicht raten — es hat den Kontext.

### 10.1 Pull-Request an `agent-config`

Damit das Plugin als first-class Tool in der „Supported tools"-Tabelle erscheint (✅ statt 📌), brauchen wir:

1. **Eigene Projection-Pipeline** in `agent-config`:
   - Quelle: `.agent-src.uncompressed/`
   - Ziel: `.event4u-agent/` (analog `.augment/`, `.claude/`, etc.)
   - Pipeline: vermutlich Pipeline B oder C — vorzugsweise neue Pipeline E mit eigenem Dokument unter `docs/architecture/event4u-agent-projection.md`.
2. **`.event4u-agent-plugin/` Marker** in agent-config (analog `.augment-plugin/` und `.claude-plugin/`):
   ```json
   {
     "name": "event4u-agent-config",
     "marketplaces": ["jetbrains", "vscode"]
   }
   ```
3. **PR-Schritte:**
   - ADR unter `agent-config/docs/decisions/ADR-event4u-agent-host.md` schreiben.
   - Pipeline-Doc unter `docs/architecture/event4u-agent-projection.md`.
   - `scripts/install.sh` um `--tools=...,event4u-agent,...` erweitern.
   - README-Tabelle aktualisieren.
   - Test in `tests/test_event4u_agent_projection.py`.

### 10.2 Plugin-Seite — was wir lesen

Bei Plugin-Aktivierung scannen wir das Projekt-Root nach (in Reihenfolge):
1. `.event4u-agent/` (Plugin-spezifische Projection)
2. `.augment/` (Augment-kompatible Projection — Fallback bei bestehenden agent-config-Installationen, wo das Plugin noch nicht als Tool registriert ist)
3. `.agent-src/` (npm-package-Tree, falls explizit konfiguriert)

Felder, die wir konsumieren:
- `skills/*/SKILL.md` — über Skill-Registry verfügbar machen
- `rules/*.md` — als „always-active" prepended an System-Prompt
- `commands/*.md` — als Slash-Commands im Chat-Input vorschlagen
- `personas/*.md` — als Review-Lenses im Agent-Loop
- `dist/router.json` — Tier-1/Tier-2 Routing-Logik übernehmen

### 10.3 Settings-Mapping

`.agent-settings.yml` Felder, die wir respektieren:

| Feld | Wirkung im Plugin |
|---|---|
| `profile.id` | Bestimmt Default-Skill-Set, Persona |
| `agent_config_version` | Validiert kompatible Skill-Schemata |
| `roles.active_role` | Default-Persona (senior-engineer / qa / advisory) |
| `llm.default_provider` | Default-LLM beim Chat-Start |
| `commands.suggestion.*` | Slash-Command-Vorschläge an/aus |
| `telemetry.artifact_engagement.enabled` | Engagement-Log schreiben (lokal) |

Schreiben darf das Plugin nicht eigenmächtig — Settings werden nur via expliziter Settings-Seite editiert.

---

## 11. Context Engine Design

### 11.0 Was wir bewusst NICHT bauen — Erwartungsmanagement

> **Wichtige Klarstellung:** Eine frühere Version dieses Plans listete „Augment-Niveau bei Kontext-Engine" als Ziel. Das war nicht realistisch und ist herausgenommen. Augments Context Engine ist deren USP und das Ergebnis von 2+ Jahren ML-Arbeit mit eigenem Cloud-Backend. „Augment-Niveau" lokal zu erreichen ist strukturell nicht möglich. Diese Sektion macht explizit, was *außerhalb* unseres Scopes liegt — und warum.

Drei Dinge werden gerne unter „zentrales Gedächtnis" zusammengeworfen, sind aber unterschiedliche Probleme mit unterschiedlichen Trade-offs:

| Aspekt | Was Augment macht | Was wir machen | Begründung |
|---|---|---|---|
| **(a) Geteilter Vektor-Index pro Repo** (alle Team-Mitglieder fragen denselben Server-Index ab) | Cloud-Backend mit shared Embeddings — einmal indexieren, alle profitieren | **Lokales Indexing pro User.** Re-Index nach Clone/Pull ist lokal. | Privacy: kein Sourcecode verlässt das Gerät. Kein Backend-Betrieb in v1.0. Optional als self-hosted Team-Backend in v2.0. |
| **(b) Cross-Repo-Lernen** (Wissen aus Repo X hilft in Repo Y) | Proprietär, vermutlich aus impliziten ML-Signalen (welche Files werden zusammen gelesen) | **Kein impliziter Cross-Repo-Vektor-Transfer.** Stattdessen: kuratierte agent-config-Rules sind explizit cross-Repo gültig. | Explizite Rules sind sicherer (kein implizites Drift), und wir haben mit agent-config schon den richtigen Kanal dafür. |
| **(c) Persistente Conversation-Memory** („wir haben letzte Woche über die Auth-Migration gesprochen") | Server-seitig in Augment-Backend | **Lokal in `.event4u-agent/`** + optional via `@event4u/agent-memory` MCP-Backend (das es bereits gibt) | Saubere Trennung von (a). User entscheidet, ob Memory ans MCP-Backend geht. |

**Konkret heißt das:**

- **Kein server-seitiger Index.** Re-Indexing nach Clone/Pull läuft komplett lokal.
- **Kein Cross-Repo-Vector-Sharing.** Cross-Repo-Wissen geht ausschließlich über kuratierte agent-config-Rules.
- **Kein ML-getriebenes Cross-User-Ranking.** Ranking ist deterministisch: BM25 + Cosine + RRF + lokales Cross-Encoder-Rerank.

**Wo wir Augment trotzdem erreichen oder schlagen können:**

- Auf event4u-Codebases sind wir **besser**, weil agent-config-Skills/Rules kuratiertes Domain-Wissen tragen, das Augments generisches Modell raten muss.
- Auf Random-Repos (z. B. ein Open-Source-Projekt, das wir noch nie gesehen haben) sind wir **ungefähr gleich** wie Continue.dev/Cline — strukturell unterlegen gegenüber Cloud-augmented Engines.

**Was wir in v2.0 evaluieren (Non-Goal in v1.0):**

Ein selbst-gehostetes Team-Backend für (a) — shared Vektor-Index pro Repo, intern auf event4u-Infrastruktur. Das wäre der Punkt, ab dem „Augment-Niveau" technisch realistisch wird, aber nur mit klarem Bedarf und einem dedizierten Backend-Build-out. Siehe §7.4.

### 11.1 Goals

- 100k+ Dateien indizierbar ohne UI-Stall.
- Initiales Indexing < 5 min für Standard-Laravel-Repo (≈20k Dateien).
- Inkrementelles Update < 200ms bei Single-File-Save.
- Retrieval-Latenz < 100ms p99 für Top-20-Snippets.

### 11.2 Indexing-Pipeline

```
File Watcher (chokidar) ─▶ Debounce 2s ─▶ Worker Pool
                                          │
                                          ├─▶ Tree-sitter parse
                                          │     ├─▶ Symbol Index (sqlite FTS5)
                                          │     └─▶ Chunk extraction
                                          │
                                          └─▶ Embedder (ONNX, lokal)
                                                └─▶ sqlite-vec
```

### 11.3 Retrieval

```
Query ──▶ Embedding ──┐
                      ├─▶ Hybrid Search ──▶ RRF ──▶ Top-K ──▶ Rerank ──▶ Context Snippets
Query ──▶ BM25 ──────┘                              (LLM call optional)
```

**Rerank-Optionen:**
- Cross-encoder lokal (ms-marco-MiniLM, ~50MB) — Default.
- LLM-Rerank — toggelbar (höhere Qualität, höhere Kosten).

### 11.4 Kontext-Injection in den Prompt

```
SYSTEM:
  <agent-config rules>
  <persona instructions>
  <skill procedures (matched)>

USER (mit Context-Block):
  [Context: top-10 snippets from codebase]
  [Recent files: opened in last 30 minutes]
  [Open editors: currently-visible buffers]

  <user message>
```

Context-Block hat ein Token-Budget (Default 20% des Modell-Context-Windows). Bei Überschreitung: Summarization der weniger relevanten Snippets.

### 11.5 `.augmentignore`-Kompatibilität

Wir respektieren `.augmentignore` als zusätzliche Ignore-Regel neben `.gitignore`. Macht das Migration für Augment-Nutzer trivial.

---

## 12. Tool-Calling & MCP

### 12.1 MCP Client

`@modelcontextprotocol/sdk` als JSON-RPC-Client. Plugin kann arbitrary MCP servers verbinden:

```yaml
# .agent-settings.yml
mcp:
  servers:
    - id: agent-config
      command: npx
      args: ["@event4u/agent-config", "mcp"]
    - id: github
      command: npx
      args: ["@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: ${GITHUB_TOKEN}
```

Tools aus MCP-Servern erscheinen im Agent als reguläre Tools mit Prefix `<server-id>:<tool-name>` (z.B. `agent-config:skill_lookup`).

### 12.2 agent-config MCP-Tools

`@event4u/agent-config` shippt bereits einen MCP-Server (siehe `docs/mcp-server.md`). Tools, die wir aus diesem Server bekommen (zumindest in Lite-Modus):

- `memory_lookup` — User-Memories abfragen
- `chat_history_read` — Frühere Konversationen lesen
- `list_skills`, `list_rules`, `list_commands` — Inventar
- `skill_read`, `rule_read`, `command_read` — einzelne Inhalte holen

→ **Wir nutzen den agent-config MCP-Server als kanonischen Pfad** statt eigene File-System-Reader zu bauen. Vorteil: weiter funktioniert auch im Cloud-Setup.

### 12.3 Permissions-Matrix

| Tool-Quelle | Default-Permission | Override |
|---|---|---|
| Built-in `read_file`, `list_dir`, `grep` | low | nein |
| Built-in `write_file` | requires_diff_approval | per Workspace toggeln |
| Built-in `run_shell` | requires_approval | per-Pattern allowlist möglich |
| MCP `*` | requires_approval | per-tool allowlist |
| Web `*` | requires_approval | per-Domain allowlist |

---

## 13. Sicherheit, Privacy & Compliance

### 13.1 Sensitive Data

- **API-Keys** werden in OS-Keychain gespeichert (IntelliJ `CredentialStore`, VS Code `secrets` API), nicht in `.agent-settings.yml`.
- **Provider-Calls** standardmäßig direkt vom Client zum Provider — kein eigenes Backend.
- **Index-DB** liegt lokal in `.event4u-agent/index.db` (zu `.gitignore` hinzufügen).
- **Chat-History** lokal in `.event4u-agent/chats/` (per Workspace).

### 13.2 Prompt Injection Defense

> **Ehrlichkeit voraus:** Prompt-Injection ist ein **laufendes, ungelöstes Risiko**, nicht ein Feature, das wir „abhaken". Defensive Maßnahmen reduzieren die Angriffsfläche, eliminieren sie nicht. Wir tracken neue Injection-Techniken als ongoing Concern in §18.

Was wir umsetzen (mit klaren Grenzen):

| Maßnahme | Wirkung | Bekannte Grenze |
|---|---|---|
| Kein Tool-Call basierend auf Inhalt aus Web-Fetches ohne User-Approval | Klassischer indirekter Injection-Vektor entschärft | Schützt nicht vor Injection aus File-Content im Repo (z. B. README mit „Ignore previous instructions") |
| Tool-Outputs werden auf Instruction-ähnliche Strings gescannt; verdächtige Inhalte werden gewrappt | Reduziert direkte Injection-Versuche aus Tool-Outputs | False-Positive-Rate ist signifikant — wir kalibrieren konservativ (lieber zu viele Warnungen). False-Negative bleibt bei neuartigen Encodings/Sprachen möglich |
| Hard-Floor-Liste (siehe §8.8.11) blockiert destruktive Befehle | `git push origin main`, `rm -rf /`, `DROP TABLE` etc. werden geblockt — auch auf User-Befehl | Pattern-basiert, kann durch obfuskierte Varianten umgangen werden — daher kombiniert mit zusätzlicher LLM-Tool-Safety-Klassifikation in v1.0 |
| Permission-Cards für alle nicht-allowlisted Aktionen | User-in-the-loop bleibt finale Defense-Line | User-Müdigkeit ist ein realer Faktor — wir tracken Approve-Raten in Telemetry (opt-in) und warnen, wenn jemand >80 % aller Approvals durchklickt |

**Was wir explizit NICHT als „gelöst" markieren:**
- Multi-Stage-Injections (Tool-Output beeinflusst späteres Tool-Selection-Verhalten)
- Adversarial-Prompts in Source-Files, die Teil des Context-Window werden
- Side-Channel-Injektionen via MCP-Tool-Responses

Diese sind in §18 als Top-Risk getrackt und bekommen Quarterly-Review.

### 13.3 GDPR / DSGVO

- Telemetry ist opt-in, default off.
- Kein Sourcecode verlässt das Gerät außer in Provider-Requests (vom Nutzer bewusst konfiguriert).
- Wenn ein Custom-Endpoint (z.B. event4u-internal) genutzt wird: Plugin zeigt Banner „Code geht an event4u-Endpoint".
- Hosted-Backend (v2.0) bekommt eigenes DPA + AVV-Template.

### 13.4 Code-Signing & Plugin-Verifizierung

- JetBrains: Plugin wird signiert (JetBrains Marketplace Cert).
- VS Code: über Marketplace mit Microsoft-Cert signiert.
- GitHub Actions: SLSA-Provenance für Releases.

---

## 14. Token-Tracking, Cost-Transparenz & Telemetry

> **Leitprinzip:** Keine negativen Überraschungen. Der User sieht *vor* jedem Request, was es kosten könnte, *während* des Requests, was es gerade kostet, und *nach* dem Request einen lückenlosen Breakdown. Alles funktioniert sowohl im API- als auch im CLI-Modus.

### 14.1 Tracking-Granularität (4 Ebenen)

| Ebene | Was wird getrackt | Wo angezeigt |
|---|---|---|
| **Step** | Pro einzelnem LLM-Roundtrip (Input/Output/Cache/Thinking-Tokens, Tool-Calls, Latenz) | Inline im Chat unter jedem Assistant-Block |
| **Request** | Pro User-Turn (Summe aller Steps für eine User-Nachricht) | Chat-Header der Konversation |
| **Conversation** | Gesamte Konversation (alle Turns) | Conversation-Sidebar + Statusbar-Widget |
| **Session / Daily / Monthly** | Über alle Konversationen aggregiert, pro Provider, pro Mode | Cost-Dashboard im Tool-Window-Tab |

### 14.2 Datenmodell

```typescript
// packages/core/tracking/types.ts

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;     // Anthropic cache_creation_input_tokens
  cacheReadTokens: number;         // Anthropic cache_read_input_tokens
  thinkingTokens: number;          // Anthropic extended thinking
  reasoningTokens?: number;        // OpenAI o-series reasoning
}

interface StepEvent {
  id: string;
  requestId: string;
  conversationId: string;
  timestamp: number;
  provider: string;
  model: string;
  mode: "api" | "cli";
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  ttftMs?: number;                 // Time to first token
  toolCalls: ToolCallSummary[];
  contextSnippets: ContextSnippetMeta[];
  promptTokensEstimated?: number;  // pre-flight estimate
  rateLimited?: boolean;
}

interface CostBreakdown {
  amountUsd: number;
  breakdown: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    thinking: number;
  };
  pricingMode: "exact" | "estimated" | "subscription-flat";
  pricingSource: string;           // "anthropic-pricing-v1", "user-defined", "subscription-claude-pro"
  note?: string;
}
```

Persistiert in SQLite unter `.event4u-agent/tracking.db`:

```sql
CREATE TABLE step_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  provider TEXT,
  model TEXT,
  mode TEXT,                       -- "api" | "cli"
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  thinking_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  ttft_ms INTEGER,
  pricing_mode TEXT,
  raw_json TEXT                    -- vollständiger Event als JSON
);

CREATE INDEX idx_step_ts ON step_events(ts);
CREATE INDEX idx_step_conv ON step_events(conversation_id);
CREATE INDEX idx_step_provider_mode ON step_events(provider, mode);

CREATE TABLE conversation_summaries (
  conversation_id TEXT PRIMARY KEY,
  title TEXT,
  started_at INTEGER,
  last_message_at INTEGER,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cost_usd REAL,
  step_count INTEGER
);
```

### 14.3 Pre-Flight Cost Estimate

> **Erwartungs-Management:** Token-Schätzung ist nicht exakt. Verschiedene Provider zählen Tokens unterschiedlich (Anthropic vs. OpenAI vs. lokale Tokenizer), und unsere Output-Projektion ist konservativ-heuristisch. Realistische Fehlerrate: **±15–30 %** auf den projizierten Gesamt-Cost. Das Estimate wird als *Range mit explizitem ≈* angezeigt, nie als harte Zahl — sonst gibt es beim ersten Abrechnungs-Cycle Vertrauensbruch.

Vor jedem Send:

1. **Eingabe-Token zählen** mit Provider-spezifischem Tokenizer:
   - Anthropic: `@anthropic-ai/sdk` `messages.countTokens()` (exakt für Input)
   - OpenAI: `tiktoken` (exakt für Input)
   - Andere: `js-tiktoken` (heuristisch, **wird mit Range ±15 % angezeigt**)
2. **Output projizieren**: konservative Schätzung basierend auf Modell-Default + History — explizit als Range (z. B. 500–3000 Output-Tokens).
3. **Kosten berechnen** mit aktuellem Pricing-Book als **Range** (Lower-Bound mit Min-Output + Cache-Hit-Annahme, Upper-Bound mit Max-Output + Cache-Miss).
4. **Schwellwert-Check** auf der **Upper-Bound** (nicht auf der Mitte!): über `$0.50` Single-Step → Confirm-Dialog.

UI im Chat-Input (mit klar erkennbarem Range, keine Punkt-Zahl):

```
┌──────────────────────────────────────────────────────────┐
│ Type your message...                                     │
│                                                          │
│ ──────────────────────────────────────────────────────── │
│ Context: ≈14,238 tok  •  Est. cost: $0.02 – $0.12        │
│ (~$0.04 typical, depends on output length)  •  [Send ⇧⏎]│
└──────────────────────────────────────────────────────────┘
```

Hover-Tooltip auf „≈" erklärt die Unsicherheits-Quelle: *„Schätzung kann ±15–30 % abweichen. Realer Cost siehe Step-Footer nach Antwort."*

Im CLI-Modus zeigt das Estimate:
```
Estimated tokens: ≈14,238 in + 500–3,000 out  •  Subscription mode (Claude Pro)
Shadow-API cost: ~$0.02 – $0.12 (informational only — your subscription covers this)
```

**Reconciliation nach Antwort:** Step-Footer zeigt die tatsächliche Zahl. Falls die reale Zahl die obere Estimate-Range um >50 % überschreitet, loggen wir das als Calibration-Event — sammeln über Zeit Kalibrations-Daten, um die Heuristik zu verbessern.

### 14.4 Real-time Streaming Counter

Während des Streamings läuft im Chat-Header ein Live-Counter:

```
🟢 Streaming…  In: 14,238 / Out: 412  •  $0.0089 so far  •  Cancel
```

Bei Tool-Calls (Multi-Step) wird der Counter pro Step inkrementiert und im Chat als Inline-Badge angezeigt:

```
🔧 read_file (src/auth.ts)  ›  +218 input tokens  ›  +47 output tokens  •  $0.0012
```

### 14.5 Subscription-Tracking (CLI-Modus)

Auch im CLI-Modus ohne direkten $-Betrag pro Call tracken wir Token-Mengen, weil:
- Subscription-Pläne haben Quotas (z.B. Claude Pro: ~45 Messages/5h, Max: 200/5h)
- User will sehen, ob er gegen sein Limit läuft
- Vergleichbarkeit zur API: „Hätte mich via API $X gekostet"

**Subscription-Cost-Approximation:**

```typescript
function approximateSubscriptionCost(usage: TokenUsage, plan: SubscriptionPlan): CostBreakdown {
  // 1. „Hätte via API gekostet" — Schatten-Berechnung mit API-Pricing
  const shadowApiCost = computeApiCost(usage, plan.providerId, plan.model);

  // 2. Anteil am Monats-Budget (basierend auf typischer Nutzung)
  const monthlyFee = plan.monthlyFeeUsd;
  const monthlyTokenAllowance = plan.estimatedMonthlyTokens;
  const allocatedCost = (usage.inputTokens + usage.outputTokens) / monthlyTokenAllowance * monthlyFee;

  return {
    amountUsd: 0,                        // realer Out-of-pocket: 0
    shadowApiCost,                       // „what it would have cost"
    allocatedSubscriptionCost: allocatedCost,
    note: `Subscription mode (${plan.name}). Shadow-API cost: $${shadowApiCost.toFixed(4)}`,
  };
}
```

### 14.6 Hard Caps & Confirms (Schutz vor Überraschungen)

Konfigurierbar in `.agent-settings.yml`:

```yaml
tracking:
  caps:
    single_step:
      warn_above_usd: 0.10
      confirm_above_usd: 0.50
      hard_block_above_usd: 5.00
    per_conversation:
      warn_above_usd: 1.00
      confirm_above_usd: 5.00
      hard_block_above_usd: 20.00
    daily:
      warn_above_usd: 5.00
      confirm_above_usd: 20.00
      hard_block_above_usd: 100.00
    monthly:
      warn_above_usd: 50.00
      hard_block_above_usd: 500.00
  per_provider_caps:
    anthropic:
      monthly_block_above_usd: 200.00
    openai:
      monthly_block_above_usd: 100.00
```

Bei Cap-Hit:
- **warn**: gelbe Banner im Chat
- **confirm**: modaler Dialog vor Send — User muss explizit klicken
- **hard_block**: Send wird blockiert, mit Hinweis auf Setting + CLI-Mode-Fallback-Vorschlag

### 14.7 Cost-Dashboard (vollwertiger Tool-Window-Tab)

Ein eigener Tab **"📊 Usage"** im Tool-Window neben "Chat" und "Tasks". Layout ist explizit am Augment/Sweep-Style ausgerichtet (siehe Augments interne Org-Dashboards), aber **immer single-user-scoped**: ein einzelner User sieht nur seine eigenen Zahlen — keine "by-user"-Aufschlüsselung, weil im Plugin per Definition nur ein User pro Installation aktiv ist.

#### 14.7.1 Dashboard-Layout (3 × N Grid)

```
┌────────────────────────────────────────────────────────────────────────┐
│ 📊 Usage & Costs   [Today│7 days│30 days│Custom▼]   [Export]  [⚙]    │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ ┌──────────────────────────────┐  ┌──────────────────────────────┐    │
│ │ Daily Token Consumption      │  │ Consumption by Resource       │    │
│ │                              │  │                              │    │
│ │   1M ┤    ╭╮      ╭╮         │  │     ╭─────╮     Claude Sonnet │    │
│ │ 800k ┤   ╭╯ ╰╮  ╭─╯ ╰╮       │  │   ╭╯     ╲╮    4.6  ████ 68%  │    │
│ │ 600k ┤  ╭╯   ╰──╯    ╰──╮    │  │  │       │    Claude Opus 4.6 │    │
│ │ 400k ┤ ╭╯               ╰╮   │  │   ╲     ╱     ███ 14%         │    │
│ │ 200k ┤╭╯                 ╰   │  │     ╰───╯     CLI (sub-flat) ▒ │    │
│ │      └─────────────────────  │  │               ███ 8%          │    │
│ │       Apr28 May5 May12 May26 │  │               GPT-5 ██ 6%     │    │
│ └──────────────────────────────┘  │               Local ▏ 4%       │    │
│                                   └──────────────────────────────┘    │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐│
│ │ Daily Token Consumption — stacked by Model                         ││
│ │   1M ┤  ░░░  ▓▒░    ░ ▒░    ▓░     ▓░    ░ ▓░░                    ││
│ │ 800k ┤ ███  ███   ████ ░  ███     ███  ███ ░░                    ││
│ │ 600k ┤████ ████  █████░  ████    ████ █████░                    ││
│ │ 400k ┤████ ████  █████  █████   █████ █████                     ││
│ │ 200k ┤████ ████  █████  █████   █████ █████                     ││
│ │      └───────────────────────────────────────                      ││
│ │       Apr30  May5  May10  May15  May20  May26                     ││
│ │ Legend ■ Sonnet 4.6  ■ Opus 4.6  ■ GPT-5  ■ Haiku 4.5  ■ Local    ││
│ └────────────────────────────────────────────────────────────────────┘│
│                                                                        │
│ ┌──────────────────────────────┐  ┌──────────────────────────────┐    │
│ │ Consumption by Activity       │  │ Consumption by Mode           │    │
│ │     ╭─────╮  Agent       82%  │  │    ╭───╮     API      62%    │    │
│ │    │     ╲  Chat         8%   │  │   ╭╯   ╲    CLI       38%    │    │
│ │    │      │ Skill exec   4%   │  │  │     │   (sub-shadow:     │    │
│ │     ╲    ╱  Inline compl 3%   │  │   ╰───╯    $18.40 if API)   │    │
│ │      ╰──╯   Context comp 2%   │  │                              │    │
│ │            CLI agent    1%   │  │                              │    │
│ │            System        <1%  │  │                              │    │
│ └──────────────────────────────┘  └──────────────────────────────┘    │
│                                                                        │
│ ┌──────────────────────────────────────────────────────────────────┐  │
│ │ Top Conversations (last 7 days)                                  │  │
│ │ 1. "Refactor auth middleware"      $4.20  •  3.2M tok  •  May 22│  │
│ │ 2. "/implement-ticket PROJ-789"    $2.80  •  1.9M tok  •  May 21│  │
│ │ 3. "Investigate prod incident"     $1.65  •  980k tok  •  May 18│  │
│ │ 4. "Add CSV export endpoint"       $0.80  •  610k tok  •  May 14│  │
│ │ 5. "Fix race condition in queue"   $0.42  •  320k tok  •  May 12│  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│ ┌──────────────────────────────────────────────────────────────────┐  │
│ │ Quota Status                                                     │  │
│ │ Today          ▌█████████████░░░░░░░░░░  $4.27 / $20 (cap)      │  │
│ │ This Month     ▌███████░░░░░░░░░░░░░░░░  $34.50 / $200 (cap)    │  │
│ │ Claude Pro     ▌█████████░░░░░░░░░░░░░░  42 / 200 msg (5h win)  │  │
│ │ ChatGPT Plus   ▌███░░░░░░░░░░░░░░░░░░░░  18 / 80 msg (3h win)   │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

#### 14.7.2 Dashboard-Widgets im Detail

| Widget | Datenquelle | Vergleich Screenshot |
|---|---|---|
| **Daily Token Consumption** (Line Chart) | `step_events` Tabelle, aggregated by day, summed `input + output + thinking + cache` | ✅ Wie "Daily Credit Consumption" |
| **Consumption by Resource** (Donut) | `step_events` group by `provider:model` + Anteil zum Total | ✅ Wie "Credit Consumption by Resource" (Claude Opus 4.7, Sonnet 4.6, …) |
| **Daily Stacked by Model** (Stacked Bar) | `step_events` group by day × model | ✅ Wie "Daily Credit Consumption by User" — nur statt User: Modell (weil single-user-installation) |
| **Consumption by Activity** (Donut) | `step_events` group by `activity` | ✅ Wie "Credit Consumption by Activity" — siehe Activity-Taxonomie unten |
| **Consumption by Mode** (Donut) | `step_events` group by `mode` (api / cli) | 🆕 Uns einzigartig — Augment hat keine API-vs-CLI-Unterscheidung |
| **Top Conversations** (Tabelle) | `conversation_summaries` ORDER BY cost DESC LIMIT 5 | Augment hat eine ähnliche „Recent Activity"-Liste |
| **Quota Status** (Progress Bars) | Caps aus `.agent-settings.yml` + Subscription-Quota-Tracking | Augments „Credits left" |

#### 14.7.3 Activity-Taxonomie (eigene Erweiterung gegenüber Augment)

Augments Activity-Taxonomie aus dem Screenshot zeigt: `Agent`, `Chat`, `Context Compression`, `System`, `CliAgent`, `Prism planner`. Wir übernehmen das Pattern mit unseren Activities:

| Activity-ID | Wann wird so gezählt | Was steht dahinter |
|---|---|---|
| `agent` | Multi-Step-Agent-Run (`/work`, `/implement-ticket`, autonomer Tool-Loop) | Hauptverbrauch — Augment ist hier auch bei 95% |
| `chat` | Single-Turn-Q&A ohne Tool-Use | Schnelle Fragen |
| `cli-agent` | Agent-Call im CLI-Modus (`claude`, `codex`, `gemini`) | Auch wenn Subscription-flat, tracken wir Tokens |
| `inline-completion` | Ghost-Text-Completion (v1.5+) | Sehr hochvolumig — eigener Bucket |
| `skill` | Direkter Skill-Aufruf aus agent-config | Discoverable per Activity |
| `context-compression` | Background-Call zur Prompt-Komprimierung (langes Gespräch wird zusammengefasst) | Erklärt warum lange Chats nicht explodieren |
| `inline-edit` | `Cmd+I` Prompt-Bar Selection-Edit (SweepAI-Style) | Schnelle gezielte Edits |
| `review` | PR-Review / Code-Review Skill | Tracking damit man weiß was Reviews kosten |
| `system` | Plugin-interne Housekeeping-Calls (Index-Reindex etc.) | Sollte <1% sein, wenn höher → Bug-Signal |

`activity` wird beim Step-Event mitgeschrieben — eigene Spalte in `step_events.activity`. Filterbar im Dashboard.

#### 14.7.4 Filter & Drill-Down

Filter-Leiste oben rechts (im Screenshot „[Today│7 days│30 days│Custom▼]"):
- **Zeitraum:** Today / Yesterday / Last 7 / 30 / 90 days / Custom date range
- **Provider:** alle / einer / Multi-Select
- **Modell:** Multi-Select
- **Mode:** API / CLI / beide
- **Activity:** Multi-Select
- **Conversation:** Free-Text-Suche (Title)

Klick auf einen Donut-Slice → filtert das ganze Dashboard auf diesen Slice. Klick auf eine Konversation in „Top Conversations" → öffnet die Konversation mit allen Steps und ihrem Cost-Footer.

#### 14.7.5 Tech-Implementation

- **Renderer:** JBCef-Webview (gleicher Code-Pfad wie VS-Code-Extension) — Charts in **Chart.js 4.x**, weil bereits in agent-config UI bewährt.
- **Datenquelle:** read-only SQL gegen `.event4u-agent/tracking.db`.
- **Refresh:** Auto-Refresh alle 10s während aktiver Konversation, sonst manueller Refresh-Knopf.
- **Performance:** Vor-aggregierte Materialized-View für „Daily" Daten (Trigger schreibt täglichen Rollup). Bei < 100k Rows direkt aus `step_events` querybar, darüber Rollup.

#### 14.7.6 Export-Optionen

- **CSV** (`event4u-usage-<from>-<to>.csv`) — alle Step-Events der Zeitspanne, Spalten: ts, provider, model, mode, activity, input_tok, output_tok, cache_*, cost_usd, conversation_id
- **Markdown-Report** (`event4u-usage-<from>-<to>.md`) — formatierter Report mit Charts als ASCII oder eingebettete PNGs, für Buchhaltung
- **JSON** (`event4u-usage-<from>-<to>.json`) — raw events für eigene Integration
- **PDF** (v1.5) — formatiert für Vorlage beim Buchhalter

#### 14.7.7 Multi-Plan-Tracking (falls User mehrere Subscriptions hat)

Im Screenshot sieht man, dass es einen "Promo"-Tarif gibt ("Claude Opus 4.7 promo"). Unser System unterstützt das:

```yaml
# .agent-settings.yml
subscriptions:
  - id: claude-pro-personal
    plan: claude-pro
    cli_binary: claude
    note: "Persönlicher Account"
  - id: claude-max-team
    plan: claude-max-20x
    cli_binary: claude-team    # zweites Binary, eigene Auth
    note: "event4u-Team Plan"
  - id: chatgpt-plus
    plan: chatgpt-plus
    cli_binary: codex
```

Dashboard zeigt dann pro Subscription eine eigene Quota-Bar.

#### 14.7.8 Was bewusst NICHT im Dashboard ist (vs Augment Org-Dashboard)

- **Kein "by User"-Breakdown** — Plugin ist single-user, der "M.Berg, Of, J.Brenner, …" Style ist Team-Feature und damit out-of-scope für v1.0
- **Kein "Credits"-Konzept** — wir sind nicht Augments Cloud, also keine internen Credits. Wir zeigen **echte Tokens und echte USD**.
- **Kein zentrales Team-Reporting** — kommt erst mit dem optionalen Self-Hosted Team-Backend in v2.0 (siehe §7.4)

### 14.8 Step-Level Inline-Anzeige im Chat

Jeder Assistant-Block bekommt einen Cost-Footer:

```
[Assistant — Claude Sonnet 4.6 via CLI]
   ich schaue mir die Datei an …
   🔧 read_file(src/auth.ts) → 217 lines
   🔧 grep(„token") → 8 matches
   ich sehe das Problem in Zeile 142 …

   ────────────────────────────────────
   ⏱  4.2s  •  In: 18,422 (cache: 14,200)  •  Out: 487  •  $0.0156
   3 steps   3 tool calls   TTFT 412ms
```

Klick auf den Footer öffnet einen Detail-Drawer mit allen Step-Events des Turns.

### 14.9 Trace-Replay

Analog zu agent-config `explain last`:
- Jeder Agent-Run schreibt `agents/runtime/state/run-<id>.jsonl`
- UI hat einen „Replay last run"-Knopf im Conversation-Menü
- Inhalt: route · memory · council · halts · provider · diff · token-events
- Replay-View zeigt einen Step-für-Step-Slider mit Cost-Akkumulator

### 14.10 Pricing Book (Single Source of Truth)

Lokal versioniert in `packages/core/pricing/prices.yml`:

```yaml
version: "2026-05-26"
providers:
  anthropic:
    claude-opus-4-6:
      input_per_1m: 15.00
      output_per_1m: 75.00
      cache_creation_per_1m: 18.75
      cache_read_per_1m: 1.50
    claude-sonnet-4-6:
      input_per_1m: 3.00
      output_per_1m: 15.00
      cache_creation_per_1m: 3.75
      cache_read_per_1m: 0.30
    claude-haiku-4-5:
      input_per_1m: 1.00
      output_per_1m: 5.00
  openai:
    gpt-5:
      input_per_1m: 5.00
      output_per_1m: 15.00
    o4-mini:
      input_per_1m: 1.10
      output_per_1m: 4.40

subscriptions:
  claude-pro:
    monthly_fee_usd: 20
    estimated_monthly_tokens: 5000000   # ~5M Tokens/Monat avg
  claude-max:
    monthly_fee_usd: 100
    estimated_monthly_tokens: 30000000
  claude-max-20x:
    monthly_fee_usd: 200
    estimated_monthly_tokens: 60000000
  chatgpt-plus:
    monthly_fee_usd: 20
    estimated_monthly_tokens: 3000000
  chatgpt-pro:
    monthly_fee_usd: 200
    estimated_monthly_tokens: 100000000
```

Updates kommen als reguläres Plugin-Update (Pricing-Book versioniert, mit Auto-Refresh-Hook via npm-Registry für Patch-Updates ohne IDE-Restart).

#### 14.10.1 Supply-Chain-Sicherheit des Pricing Book

> **Sicherheits-Frage, die der Pricing-Book-Mechanismus aufwirft:** Wenn das `@event4u/pricing-book`-npm-Package kompromittiert wird (z. B. Konto-Übernahme eines Maintainers), kann ein Angreifer Caps wirkungslos machen und User in unbeschränkte Kosten laufen lassen. Ein Auto-Update-Mechanismus, der das Package blind nachlädt, ist daher **nicht akzeptabel**.

Gegenmaßnahmen — Pflicht ab v1.0:

| Maßnahme | Wirkung |
|---|---|
| **Sigstore-/cosign-Signatur** auf jedem Pricing-Book-Release | npm-Package wird nur akzeptiert, wenn Signatur gegen unseren Public Key valid ist |
| **In-Plugin baseline pricing** als Fallback | Bei Update-Fehler oder Signatur-Mismatch: weiter mit gebundeltem Pricing — Plugin bleibt funktional |
| **Update-Diff sichtbar im Settings-UI** | Vor Apply zeigt Settings: „Pricing für claude-sonnet-4-6: $3.00/M → $0.30/M — ungewöhnlicher Drop, manuell bestätigen?" |
| **Hard-Block bei >50 % Preis-Drop** | Verdächtig große Reduktionen lösen Manual-Approval aus (Angreifer-Pattern: Preise auf 0 setzen, Caps wirkungslos machen) |
| **`pricing-book-version`-Lock in `.agent-settings.yml`** | Teams können Updates explizit pinnen, automatische Updates abschalten |

Empfehlung Default: **opt-in für Auto-Updates**, Default ist „Plugin-Release-gebunden" (Pricing-Book kommt mit dem Plugin-Update).

### 14.11 Token-Extraktion im CLI-Modus

Pro CLI eine Strategie zur Token-Extraktion:

| CLI | Strategie | Zuverlässigkeit |
|---|---|---|
| `claude` (Claude Code) | JSON-Events haben `usage` field in `result`-Events | Exakt |
| `codex` | `--output-format=json` zeigt usage am Ende | Exakt |
| `gemini` | analog | Exakt |
| `aider` | parsed aus `/tokens`-Output oder finalem Status | Best-effort |
| Custom CLI | regex-konfigurierbar in `.agent-settings.yml` | User-defined |

Falls die Extraktion fehlschlägt, wird der Step als „tokens unknown" markiert und im Dashboard ausdrücklich nicht in die Summen aufgenommen — der User sieht die Lücke, nicht eine falsche Null.

### 14.12 Lokale Logs

Alle Plugin-Logs werden unter `.event4u-agent/logs/` rotiert geschrieben (max 10 MB pro Datei, 5 Files). Format: JSONL.

Tracking-DB (`.event4u-agent/tracking.db`) ist separat vom Index-DB.

### 14.13 Opt-in Telemetry

Wenn `telemetry.artifact_engagement.enabled: true`:
- Welche Skills wurden konsultiert
- Welche Tools wurden aufgerufen
- Latenzen pro Phase
- *Niemals* Code-Inhalte, *niemals* Prompts/Completions
- Daten bleiben lokal als JSONL; Plugin-Befehl `event4u: Export Telemetry Report` erzeugt einen Markdown-Report.

Telemetry und Tracking sind getrennt: Tracking ist immer an (rein lokal, für den User), Telemetry ist opt-in (Engagement-Logs, für Verbesserung).

### 14.14 Export & Audit

- **CSV-Export** aller Step-Events für Buchhaltung
- **Markdown-Report** monatlich (Cost-Übersicht, Top-Conversations, Top-Tools)
- **JSON-Export** für Integration in eigene Dashboards
- **Audit-Log** in `agents/runtime/state/audit-<date>.jsonl` (immutable)

---

## 15. Testing-Strategie

### 15.1 Core (TypeScript)

- **Unit**: Vitest, jeder Provider/Tool/Phase einzeln, mit Recorded HTTP fixtures (`@anthropic-ai/sdk` recordings).
- **Integration**: Headless Agent-Run gegen Mini-Repo-Fixture (`tests/fixtures/laravel-mini/`).
- **Coverage-Floor**: 80% für `agent/`, `llm/`, `tools/`.

### 15.2 JetBrains Plugin

- **UI Tests**: `intellij-ui-test-framework` (Remote-Robot).
- **Headless**: `BasePlatformTestCase` für Editor-Actions.
- **Manual Test Matrix**: PhpStorm 2024.1/2024.2, IntelliJ Ultimate 2024.x, Android Studio Koala+.

### 15.3 VS Code

- **Unit**: Vitest auf Extension-Logik.
- **E2E**: `@vscode/test-electron` mit fixture-Workspace.

### 15.4 Cross-Repo-Tests

Snapshot-Tests gegen `agent-config`-Skill-Frontmatter-Format — wenn upstream das Schema ändert, schlägt unser Test fehl und wir wissen, dass wir nachziehen müssen.

---

## 16. Distribution & Release

### 16.1 Channels

| IDE | Channel |
|---|---|
| JetBrains | [Marketplace](https://plugins.jetbrains.com/) — `app.event4u.agent` |
| VS Code | [Marketplace](https://marketplace.visualstudio.com/) + [OpenVSX](https://open-vsx.org/) — `event4u.event4u-agent` |
| Core (sidecar) | npm `@event4u/agent-core` |

### 16.2 Versionierung

SemVer. Plugin-, Core- und Protocol-Version sind alle gleich (Mono-Repo-Lockstep). Major-Bumps reservieren wir für Protocol-Brüche.

### 16.3 Release-Workflow

```bash
task release:patch    # bumps version, generates CHANGELOG entry from conventional commits,
                      # builds jar + vsix + tarball, signs, drafts GitHub Release.
task release:publish  # tags v<version>, GitHub Action uploads to all 3 marketplaces.
```

### 16.4 Auto-Update

- IDEs handhaben Plugin-Updates selbst.
- Der **Sidecar** wird bei Plugin-Update mit-aktualisiert (im Plugin-Paket gebundelt) — kein separater Updater.
- Optional: in-process Update-Check gegen npm-Registry; bei verfügbarem Patch-Update Toast „Update ready, restart IDE".

---

## 17. Konkreter Phasen-Plan

> **Verweis:** Phase 0 ist in §0 als eigene Top-Level-Sektion ausgeführt (Build-vs-Fork-Spike, Positionierungs-Entscheidung, 3 technische Spikes). Dieser Abschnitt deckt Phase 1 bis 4 ab. **Falls Phase 0 zum Fork-Pfad führt, ist Phase 1 hier komplett neu zu zeichnen.**

### Phase 1 — MVP (13 Wochen Sprint-Work + 1–3 Wochen Puffer = 14–16 Wochen kalendarisch)

> Vier Sprints: 3 × 3 Wochen (Sprint 1–3) + 1 × 4 Wochen (Sprint 4) = **13 Wochen reine Sprint-Zeit**. Puffer von 1–3 Wochen ist explizit eingeplant für Spike-Findings, krankheitsbedingte Ausfälle, überlaufende Items aus Sprint 4 (der vollste). Kalendarisch realistisch: **14–16 Wochen**.

> **Demo-Ziel:** ein PhpStorm-Plugin und eine VS-Code-Extension, die einen Chat zeigen, **nur** mit Anthropic (API *und* Claude-CLI) reden, **Single-File-Edits** mit Diff-Approval machen, und **einen** `agent-config`-Command (`/commit`) Single-Shot ausführen, mit funktionierendem 4-Ebenen-Cost-Tracking + Hard Caps.
>
> Bewusst NICHT im MVP: Multi-Step Loop, Multi-File-Edit, Codex/Gemini CLI, OpenAI-API, SweepAI-Style Inline-Edit, Intention-Action, Pre-flight Estimate, Context Engine v0, volle Action-Card-Badges. Begründung siehe §7.1.

**Sprint 1 (3 Wochen)** — Skeleton & RPC-Baseline
- T-101 Mono-Repo Bootstrap (pnpm, Taskfile, tsconfig.base.json)
- T-102 Agent Core Echo-Server (JSON-RPC over stdio)
- T-103 JetBrains-Plugin-Skeleton mit Tool Window
- T-104 VS Code Extension Skeleton mit Webview
- T-105 Core ↔ Client RPC Hello-World in beiden IDEs
- T-106 GitHub Actions CI (Lint + Build für alle Targets)
- T-107 Phase-0-Spike-Ergebnisse einarbeiten (UI-Stack-Wahl, ggf. Sidecar-Skip)

**Sprint 2 (3 Wochen)** — Chat mit *einem* Provider
- T-201 Anthropic API Backend mit Streaming (**nur** Anthropic — OpenAI in v1.0)
- T-202 Chat UI JetBrains (Markdown + Codeblock-Highlight, vereinfachte Action Cards)
- T-203 Chat UI VS Code (Preact-Webview)
- T-204 Settings UI: Provider-Wahl, API-Key, Modell
- T-205 OS-Keychain Integration für API-Keys
- T-206 Pricing Book v0 (nur Anthropic-Modelle + Claude-Pro/Max-Subscriptions)
- T-207 Token-Counter + Cost-Anzeige in Statusbar (real-time, ohne Pre-flight Estimate)
- T-208 `.agent-settings.yml` Reader v0 (nur MVP-relevante Felder)

**Sprint 3 (3 Wochen)** — Single-Shot Agent + Single-File-Edit
- T-301 Tool-Calling Normalisierung (nur Anthropic-Tool-Use, kein OpenAI-Format-Support im MVP)
- T-302 Tools: `read_file`, `list_dir`, `glob`, `grep`
- T-303 Tool: `write_file` (**Single-File**) mit Diff-Preview
- T-304 Permission-Gate v0 — Hard-Floor-Liste, simple Allow/Always/Deny-Buttons (kein inline-editable Scope-UI im MVP)
- T-305 Chat Halt-Protocol Rendering (klickbare Optionen + Free-Text)
- T-306 Action „Ask about selection" in beiden IDEs (eine einzige Editor-Action, keine Intention/Right-Click)

**Sprint 4 (4 Wochen)** — agent-config v0 + CLI-Mode + Tracking
- T-401 **agent-config Tree-Walker** (`.event4u-agent/` mit `.augment/`-Fallback)
- T-402 **Slash-Command-Picker** im Chat-Input (read-only Inventory)
- T-403 **`/commit` als erstes lauffähiges agent-config-Command** (Single-Shot, kein Loop)
- T-404 Rules als „always-active" prepended an System-Prompt
- T-405 **CLI-Detection Service** (nur `claude`, andere CLIs in v1.0)
- T-406 **Claude Code CLI Backend** (`--output-format=stream-json`)
- T-407 **Mode-Toggle im Chat-Header** (API ↔ CLI per Conversation)
- T-408 **Token-Tracking SQLite-Persistenz** (Step-Events + Conversation-Summary)
- T-409 **Real-time Streaming Counter im Chat-Header**
- T-410 **Step-Level Cost-Footer pro Assistant-Block**
- T-411 **Hard Caps + Confirm-Dialog** (single-step, daily)
- T-412 **Stop-Button + ESC-Shortcut** (§9.12) — alle drei Cancellation-Layer (UI → Agent-Core → Backend). Pflicht für MVP, ohne kann keine teure Run gestoppt werden
- T-413 Audit-Log Schreibpfad (auch wenn Dashboard erst in v1.0 kommt)
- T-414 **Internal demo to event4u team** — Acceptance-Kriterien: Demo-Ziel oben funktioniert in PhpStorm UND VS Code, **Stop wirkt sauber**

### Phase 2 — v1.0 (Sprint 5–15, 27 Wochen Sprint-Work + Puffer = ~6,5–7,5 Monate nach MVP)

> 10 Sprint-Items (Sprint 5–15) mit insgesamt **27 Wochen reiner Sprint-Zeit**, plus eingebauter Puffer-Sprint 15 (2–3 Wochen) für überlaufende Items, Integration-Testing und finale Release-Polish. Kalendarisch realistisch: **6,5–7,5 Monate nach MVP-Demo.**
>
> Reihenfolge ist nicht beliebig — Sprint 5 zieht MVP-Lücken nach, Sprint 6 ist Voraussetzung für Sprint 7 (Multi-Step muss vor Card-UI für Multi-Step da sein), Sprint 8 (Live-Terminal) ist Voraussetzung für Sprint 9 (IDE-Tiefe nutzt Terminal-Hooks). Innerhalb dieser Reihenfolge können einzelne Sprints bei Bedarf parallel laufen, falls ein zweiter Entwickler dazukommt.

**Sprint 5 (2–3 Wochen)** — Nachzieh-Sprint: was aus MVP raus war
- OpenAI API Backend mit Streaming
- Codex CLI Backend + Gemini CLI Backend
- CLI-Detection für alle 3 CLIs
- **Capability-Manifests für alle 3 CLIs** (§9.11) — wartbare Source-of-truth pro CLI

**Sprint 6 (3 Wochen)** — Multi-Step Loop + Multi-File-Edit
- Agent Loop State Machine (plan → exec → verify) mit Halt-Protokoll
- Multi-File-Edit mit Bulk-Permission-Card und atomic rollback
- Inline-editable Permission-Scope (Claude-Code-Style, §8.8.11)

**Sprint 7 (3 Wochen)** — Volle Card-UI + Cost-Polish
- Volle Action-Card-Implementation mit allen Badges (Diff-Stats, Numeric, Status-Dot, Permission-Cards)
- Pre-flight Cost Estimate mit Range-Anzeige (§14.3)
- Cost-Dashboard im Tool-Window-Tab (§14.7)
- Trace-Replay (§14.9)

**Sprint 8 (3 Wochen)** — Live-Terminal (§8.9)
- node-pty Integration im Sidecar, prebuilds für 6 Architekturen
- Terminal-Session-State im Agent-Core (Ring-Buffer, Subscribers, FIFO-Input-Queue)
- JSON-RPC Terminal-Events (siehe §8.10) + Replay-from-Seq
- xterm.js-Renderer in beiden Chat-Surfaces, ANSI-Color, Spinner, Elapsed-Time
- Waiting-for-input-Detection (alle 3 Strategien)
- Inline-Input-Card mit Send-Aktion
- VS-Code-IDE-Terminal-Pseudoterminal-Bridge (Read/Write)
- JetBrains-IDE-Terminal-Mirror (Read-only in v1.0)

**Sprint 9 (3 Wochen)** — Native IDE-Tiefe (SweepAI-Style)
- Inline-Edit Prompt Bar (`Cmd+I`)
- Diff-Accept Shortcuts (`Cmd+Y`/`Cmd+N`/`Cmd+Enter`/`Cmd+Shift+Backspace`)
- Right-Click `EditorPopupMenu` Group + Floating-Toolbar
- Intention Action (Alt+Enter „Fix with event4u-agent")
- Find-Action Integration

**Sprint 10 (2 Wochen)** — Per-CLI Controls + Session Browser (§9.11 + §9.13)
- Zahnrad-Panel-UI mit Capability-Manifest-Renderer
- Session-Adapter pro CLI (Claude/Codex/Gemini Session-File-Parser)
- Unified Session-Browser-Overlay
- Chokidar-Watcher auf alle Session-File-Locations
- Resume-Logik pro Source (`--resume <id>` für CLIs, JSON-Load für API)
- "External sessions detected"-Onboarding-Flow beim Erstanlauf

**Sprint 11 (2 Wochen)** — Context Engine v0 (Tree-sitter + BM25)
- Walker, Symbol-Index (sqlite FTS5), Chunk-Extraktion
- BM25-Retrieval mit Pfad-Token-Boosting
- Inkrementelles Re-Indexing on file change (debounced 2 s)
- Token-Budget-Management für Context-Block-Injection

**Sprint 12 (2 Wochen)** — Context Engine v1 (Embeddings + Hybrid)
- Embedder (ONNX local, BGE oder ähnlich)
- sqlite-vec als persistenter Store
- Hybrid Retrieval: BM25 + Vector → RRF
- Lokales cross-encoder Rerank (ms-marco-MiniLM)

**Sprint 13 (3 Wochen)** — MCP + Volle agent-config Coverage
- MCP-Client für arbitrary servers
- agent-config MCP-Server vollständig konsumieren
- Alle 136 Commands aufrufbar
- Memories (lokal + @event4u/agent-memory MCP-Backend)
- Hooks (sessionStart/End/Stop) — kompatibel agent-config

**Sprint 14 (3 Wochen)** — UX-Polish + Release-Vorbereitung
- Persisted Chat History, Conversation-Forking, Checkpoints
- Statusbar-Widget mit Index-Status
- Abort-able Streaming
- Pricing-Book Sigstore-Signature-Verification (§14.10.1)
- Telemetry opt-in
- Doku komplett (User Guide, Contributing, FAQ, ADR-Sammlung)

**Sprint 15 — Puffer & Beta-Release (2–3 Wochen)** — *explizit eingeplanter Puffer*
- Aufholarbeit aus überlaufenden Items
- End-to-End-Integration-Tests über alle Targets (PhpStorm 2024.2+, 2025.x, VS Code Stable/Insiders)
- Cross-Platform-Verifikation (macOS Intel/ARM, Linux x64/ARM, Windows x64/ARM)
- Performance-Regression-Tests
- Bug-Fix-Sprint nach erster Internal-Beta-Welle
- **Beta-Release an event4u-internal** — Acceptance-Kriterien aus §0.2 prüfen, Positionierungs-Entscheidung B/C ggf. festziehen

**Wenn Sprint 15 nicht voll gebraucht wird:** Items aus v1.5 (siehe §7.3) vorgezogen — bewusst keine Sprint-Zeit-Verschwendung. Wenn er voll gebraucht wird oder überläuft: v1.5 verschiebt sich um die Differenz nach hinten.

### Phase 3 — v1.5 Public Beta (Sprint 16–21, ~12 Wochen, nur falls Positionierung B/C aus §0.2)

- Inline-Autocomplete
- Refactoring-Skills (cross-file)
- Linear/Jira/GitHub Issue-Reader
- Web-Tool (Search, Fetch)
- Tasks-Liste persistent
- Customization-UI
- Public Beta Release (JetBrains Marketplace + VS Code Marketplace)

### Phase 4 — v2.0 (TBD)

- Self-hosted Team-Backend
- Eigene Embedding-Pipeline
- Speech-to-Text
- Enterprise-Features (SSO, Audit-Log)

---

## 18. Risiken & offene Entscheidungen

### 18.1 Risiken (sortiert nach Impact × Wahrscheinlichkeit)

| Risiko | W'keit | Impact | Mitigation |
|---|---|---|---|
| **Build-statt-Fork ist die falsche Wahl** — wir bauen 6 Monate Infrastruktur, die Continue.dev bereits hätte | mittel | sehr hoch | Phase 0 Spike 0.1 ist die einzige saubere Mitigation. Wenn Phase 0 hier nicht klar entscheidet, ist der Rest des Plans gefährdet. |
| **MVP-Scope wird trotz Halbierung überdehnt** | hoch | hoch | Scope-Cuts in §7.1 sind die Mitigation. Stehen-bleiben-bei: harte Sprint-Reviews, „cuttable backlog" für Sprint 4 |
| **Positionierungs-Frage wird nicht früh getroffen** | mittel | hoch | §0.2 — ADR-002 ist Phase-0-Deliverable. Ohne diese Entscheidung treibt Sprint 5+ in eine Richtung, die nicht zur tatsächlichen Zielgruppe passt |
| **JBCef-Theme-Sync, JSON-RPC, CLI-Pipe instabil** | mittel | hoch | §0.3 Spikes adressieren das. Jeder Spike hat Pass/Fail-Kriterien |
| Prompt-Injection bleibt offenes Risiko (siehe §13.2) | hoch | mittel | Multi-layered defense, Telemetry zu Approval-Raten, **explizit als laufendes Risiko getrackt** statt „gelöst" |
| Pricing-Book npm-Supply-Chain-Angriff | niedrig | sehr hoch | Sigstore-Signature, Hard-Block bei >50 % Preis-Drops, In-Plugin-Baseline (§14.10.1) |
| Token-Schätzung im Pre-flight ist ±15–30 % daneben, User sieht „harte Zahl" und ist später frustriert | mittel | mittel | Range-Anzeige statt Punkt-Zahl, Reconciliation-Logging (§14.3) |
| Provider-API-Changes (Anthropic/OpenAI) brechen Tool-Use | mittel | mittel | Provider-Adapter-Pattern; Fixture-Tests gegen reale Responses |
| Tree-sitter-Performance bei großen Repos | mittel | hoch | Worker Pool, Inkrementelle Updates, Skip-Liste für Build-Outputs |
| agent-config-Upstream-Breaking-Change | mittel | hoch | Pin `agent_config_version`, snapshot tests, frühe PR-Koordination (siehe §0.5) |
| LLM-Cost-Explosion bei Multi-Step-Agent | mittel | hoch | Hard cost cap per session, Context-Pruning, Confirm-Dialog auf Upper-Bound |
| **Augment-Niveau-Erwartung im Team** (jemand erwartet Cloud-Backend-Qualität) | mittel | mittel | §2.3 Erwartungs-Management, §11.0 Non-Goals — explizit kommunizieren |
| Marktplatz-Review (JetBrains) verzögert Release | mittel | niedrig | Frühe Beta-Submission via private channel |
| Reverse-Engineering-IP-Risiko | niedrig | hoch | Wir replizieren *Features* aus public sources, *kein* Code-Copy |
| Sidecar startet nicht (Pfad-/Permission-Probleme) | hoch | hoch | Bundled Node, Diagnostics-Command, Fallback-Modus |
| **node-pty prebuilds fehlen für eine Architektur** (z. B. Win-ARM) | mittel | mittel | Prebuild-Matrix in CI, Fallback auf Pipe-Spawn (kein interaktiver Mode, Banner zeigt Limitation an) |
| **JetBrains-`TtyConnector`-Integration brüchig** (v1.5-Feature für full read/write IDE-Terminal-Sync) | hoch | niedrig | v1.0 liefert nur Read-only-Mirror; full Bridge wird im Phase-0-Spike validiert, bevor v1.5 committed wird |
| **Conflict-Resolution-Bugs bei Dual-Surface-Input** (Race-Conditions auf PTY-stdin) | mittel | mittel | FIFO-Queue im Sidecar, Property-basierte Tests mit simultanen Writes, Telemetry zählt Conflicts |
| **Heuristik-False-Positives in Waiting-for-input-Detection** (Banner blinkt bei jedem `?` im Output) | mittel | niedrig | Stufige Detection (siehe §8.9.3): erst „möglicherweise", dann „bestätigt" nach Idle-Timeout |
| **CLI-Capability-Manifest-Drift** — Claude Code / Codex / Gemini ändern Flags, Modes, Session-File-Format ohne Vorwarnung | hoch | mittel | Per-Version-Pinning + Drift-Banner in UI (§9.11.4 — „Your CLI is newer than last-validated version"). Quarterly-Refresh-Workflow in §19. Escape-Hatch „Raw CLI args" für Power-User |
| **Externe CLI-Session-Files ändern Schema** (Anthropic ändert ~/.claude JSONL-Felder) | hoch | mittel | Defensive Parser pro Adapter; Snapshot-Tests gegen reale Files; bei Parse-Fail wird Session als „raw-only, no resume" markiert statt komplett zu verlieren |
| **Stop-Button wirkt nicht zuverlässig auf hängenden Tool-Call** (PTY-Process ignoriert SIGTERM) | mittel | hoch | Drei-Stufen-Cancellation (§9.12.1) mit SIGINT → 2 s grace → SIGKILL. End-to-end-Tests mit absichtlich blockierenden Scripts |
| **Session-Browser performance bei 1000+ Sessions** | mittel | niedrig | Lazy-Parsing (nur Header für Summary), Virtual-Scrolling im Overlay, Datums-Gruppen sind collapsed by default außer „Today" |
| `since-build="242"` schließt Team-Mitglieder mit älterer PhpStorm-Version aus | mittel | niedrig | §0.4 — vor Sprint 1 im Team validieren |
| Multi-Stage-Prompt-Injection durch File-Content im Repo | mittel | hoch | Quarterly-Review-Item in §13.2, Tool-Safety-Klassifikation in v1.0 |
| **Solo-Entwickler-Bottleneck** — Krankheit/Urlaub stoppt das Projekt | mittel | hoch | Code-Review-Buddy aus dem Team einplanen, ADRs als Wissens-Persistierung |

### 18.2 Offene Entscheidungen (Phase 0 oder vor Phase 1)

| Frage | Optionen | Empfehlung | Wann zu entscheiden |
|---|---|---|---|
| **Build oder Fork (Continue.dev)?** | A) Neu-Bau · B) Fork · C) Hybrid (Provider-Layer übernehmen, agent-config-Host eigen) | offen — siehe §0.1 | **Phase 0** (Pflicht) |
| **Positionierung intern vs. public?** | A) Intern · B) Public, event4u-first · C) Public, generisch | B als Default — siehe §0.2 | **Phase 0** (Pflicht) |
| **Bottom-up UI-Stack** nach Spike 0.3 | A) Sidecar + JBCef · B) Kotlin-nativ + JBCef für Dashboards · C) Compose-only | offen, abhängig von Spike-Ergebnis | **Phase 0** (Pflicht) |
| Sidecar bundled Node oder requires existing Node? | A) bundled (~50MB) · B) require user-installed · C) Bun-runtime | A für Robustheit; C evaluieren in v1.5 | Sprint 1 |
| Eigener `.event4u-agent/` Projection-Tree in agent-config oder `.augment/` re-use? | A) Eigen · B) Re-use | A — sauber, langfristig wartbar | Sprint 4 |
| Default-Backend-Mode im MVP? | A) API only · B) CLI preferred when available · C) Ask user | B — User soll maximalen Wert aus Subscription ziehen | Sprint 4 |
| Vector-Store (für v1.0): sqlite-vec, LanceDB, oder Qdrant? | A) sqlite-vec · B) LanceDB · C) Qdrant | A — zero-dep, embed-in-process | Sprint 9 |
| Embedding-Modell: ONNX local, Voyage, OpenAI? | A) ONNX local · B) Voyage · C) OpenAI | A als Default (privacy-friendly), B/C optional | Sprint 9 |
| Lizenz | A) MIT · B) Apache 2.0 · C) BSL | A — konsistent mit agent-config | Sprint 1 |
| Mono-Repo-Tooling | A) pnpm + Taskfile · B) Nx · C) Turborepo | A — konsistent mit agent-config | Sprint 1 |
| **Naming des Plugins (intern + public)** | siehe §18.3 | Phase 0 Entscheidung — Positionierung gibt den Rahmen | **Phase 0** (Pflicht, nicht Sprint 10!) |
| Pricing-Book-Update-Mechanik | A) im Plugin gebundelt · B) Remote-Fetch mit Sigstore | A als Default, B opt-in mit Sigstore — siehe §14.10.1 | Sprint 12 |
| Subscription-Cost-Approximation aktiv? | A) ja, als „shadow API cost" · B) nein, nur tokens | A — gibt User Vergleichbarkeit | Sprint 4 |
| Hard-Caps Defaults | konservativ vs. liberal | konservativ — User muss aktiv hochsetzen | Sprint 4 |

### 18.3 Naming-Frage — in Phase 0 zu klären

> **Wichtige Korrektur zum älteren Plan:** Der Name sollte **nicht** erst in Sprint 10 fallen, sondern in **Phase 0** zusammen mit der Positionierungs-Entscheidung (§0.2). Wenn der Name in Sprint 10 fällt, weiß man bis dahin nicht, wer die Zielgruppe ist — und das ist ein Symptom, kein Detail. Marketplace-Distribution, Code-Signing und Public-Beta-Aufwand sind ohne Positionierung nicht skaliert.

| Name | Pro | Contra | Passt zu Positionierung |
|---|---|---|---|
| `event4u Agent` | direkter Brand-Bezug | nur interner Markt | A (Internal) |
| `event4u Coder` | klingt nach Coding-Tool | unspezifisch | A oder B |
| `Galawork Agent` | breiterer Markt | weniger Recognition | B oder C |
| **„Domain"-Name + „by event4u"** (z. B. `Forge`, `Atelier`, `Bauplan`) | freier Markt, brand-halo für event4u | mehr Marketing-Aufwand | B oder C |

Empfehlung: **Wenn Phase 0 zu Positionierung A führt → `event4u Agent`. Wenn B oder C → Brand-Name in Phase 0 evaluieren, mit Marketing-Input.**

---

## 19. Augment- und SweepAI-JAR-Analyse — Status & Wiederholung

> **Status:** ✅ erledigt für beide Plugins. Augment v0.466.6-stable und SweepAI v1.29.3 wurden direkt aus den lokal installierten JARs analysiert. Ergebnisse fließen durchgängig in §3 und §3.5 ein.
>
> Dieser Abschnitt dokumentiert, **wie man die Analyse wiederholt**, wenn die Plugins ein größeres Update bekommen oder ein drittes Vergleichs-Plugin (z. B. Cline, Continue) dazukommt.

### Was bereits analysiert wurde

| Plugin | Version | Pfad zum JAR | Wichtige Findings |
|---|---|---|---|
| Augment Code | 0.466.6-stable | `~/.../JetBrains/PhpStorm2026.1/plugins/intellij-augment/lib/` (153 MB) | Sidecar + JBCef-Webview, gRPC zu Cloud, BYOK (Anthropic/OpenAI/Bedrock), 12 Settings-Sections, 19 native Tools-Klassen, Hooks, MCP-OAuth |
| SweepAI | 1.29.3 | `/agent-plugin/sweepai/lib/jetbrains-1.29.3.jar` (15 MB) | Pure Kotlin, kein Sidecar, AnthropicClient direkt, jgit + SQLite, 19 native Kotlin-Tools, Intention-Action, ergonomische Shortcuts |

### Wiederholungsanleitung (für nachfolgende Augment-Releases)

1. **JARs in ein zugängliches Verzeichnis kopieren** (z.B. `<projekt>/_augment-analysis/`):
   ```bash
   cp -r "~/Library/Application Support/JetBrains/PhpStorm2026.1/plugins/intellij-augment/lib" \
         "/Users/mathiasberg/projects/galawork/galawork-packages/event4u/agent-plugin/_augment-analysis/"
   ```

2. **`plugin.xml` extrahieren** — gibt Aufschluss über Tool Windows, Actions, Extensions, Module-Dependencies, Settings-Pages:
   ```bash
   unzip -p intellij-augment-*-stable.jar META-INF/plugin.xml
   ```

3. **Klassen-Inventar erstellen** (ohne Dekompilation):
   ```bash
   unzip -l intellij-augment-*-stable.jar | awk '{print $NF}' | grep -E "^com/augmentcode/.*\.class$"
   ```

4. **Domain-Modelle aus Klassennamen ableiten** — Augments `com.augmentcode.api.*` enthält alle Request-/Response-Schemas. Für jede neue Klasse: Name → Vermutung über Zweck → Verifikation durch Klassen-Inhalts-Inspektion mit `javap`:
   ```bash
   javap -p com.augmentcode.api.ChatRequest
   ```

5. **Sidecar inspizieren**:
   ```bash
   unzip -p intellij-augment-*-stable.jar sidecar/index.cjs | head -200    # Größe + erste Bytes
   unzip -l intellij-augment-*-stable.jar | awk '{print $NF}' | grep "^sidecar/" | grep -v node_modules
   ```

6. **Webview-Assets prüfen** — Vite-Bundle, also alle JS/CSS hat Hash im Namen:
   ```bash
   unzip -l intellij-augment-*-stable.jar | awk '{print $NF}' | grep "^webviews/assets/" | sort
   ```

7. **Optional: Dekompilation mit CFR oder Procyon** (nur falls Detail-Verständnis nötig):
   ```bash
   curl -L -o cfr.jar https://github.com/leibnitz27/cfr/releases/download/0.152/cfr-0.152.jar
   java -jar cfr.jar intellij-augment-*-stable.jar --outputdir decompiled/
   ```

8. **Netzwerk-Sniffing während Plugin-Nutzung** (Charles Proxy mit MITM-Cert):
   - welche Endpoints werden gerufen?
   - welche Request-Bodies (Prompt-Format, Context-Block-Shape)?
   - **Wichtig:** rein zum Verstehen des Schemas, *keine* 1:1-Übernahme.

9. **Ergebnisse dokumentieren** unter `docs/research/augment-analysis-v<version>.md` und §3/§3.5 dieses Plans aktualisieren.

### Wichtiger rechtlicher Hinweis

Augment Code ist proprietär. **Wir kopieren keinen Code, keine Strings, keine Klassennamen.** Wir analysieren die Architektur und User-Experience, um sie aus eigener Implementation zu replizieren. Das fällt unter „Clean-Room Re-Implementation" und ist zulässig, solange keine geschützten Implementationsdetails übernommen werden.

---

## 20. Glossar

| Begriff | Bedeutung |
|---|---|
| **Agent Loop** | Mehrstufige State-Machine, die ein Ziel durch wiederholte LLM-Calls + Tool-Calls erreicht |
| **Sidecar** | Separater Prozess (hier: Node.js), den die IDE als Subprozess startet |
| **Context Engine** | System aus Indexing + Retrieval, das pro User-Turn relevante Code-Snippets findet |
| **MCP** | Model Context Protocol — Anthropics offener Standard für Tool-Server |
| **Halt-Protokoll** | Strukturierter Stopp des Agents bei Ambiguität, mit Optionen für den User |
| **Permission-Gate** | Tool-Call blockiert bis User explizit zustimmt |
| **Projection-Pipeline** | In agent-config: Transformation der Source-Files in Tool-spezifische Formate |
| **Skill** | Strukturierte Expertise als SKILL.md mit YAML-Frontmatter |
| **Hard Floor** | Aktionen, die nie erlaubt sind — auch nicht mit User-Approval |
| **Hybrid Retrieval** | BM25 + Vector-Search mit Rank-Fusion |
| **RRF** | Reciprocal Rank Fusion — Methode, Rankings zu kombinieren |
| **JSON-RPC** | Lightweight RPC-Protokoll, das LSP und MCP nutzen |
| **JBCef** | JetBrains Chromium Embedded Framework — Webview in IntelliJ |

---

## Anhang A — Referenzimplementationen (Inspirationen + Fork-Kandidaten)

> **Wichtig:** Die ersten drei Einträge sind nicht nur Inspiration — sie sind **echte Build-vs-Fork-Kandidaten**, die in Phase 0 §0.1 evaluiert werden müssen. Wenn einer davon zu ≥ 60 % unser Ziel-System abbildet, ist Forken wahrscheinlich der bessere Pfad als Neu-Bau.

| Tool | Sprache | License | Was wir uns ansehen | Fork-Eignung |
|---|---|---|---|---|
| **[Continue.dev](https://github.com/continuedev/continue)** | TS + Kotlin | Apache 2.0 | Cross-IDE-Architektur (JetBrains + VS Code), Provider-Layer, MCP-Support, Context-Engine, Diff-Apply | **hoch** — primärer Fork-Kandidat in Phase 0 §0.1 |
| **[Cline](https://github.com/cline/cline)** | TS | Apache 2.0 | VS-Code-only, ohne Sidecar — exzellenter Agent-Loop, Custom Modes, MCP | **mittel** — gut für VS-Code-Only-Pfad, aber kein JetBrains-Client |
| [Cody](https://github.com/sourcegraph/cody) | TS + Kotlin | Apache 2.0 | Sidecar-Pattern, Context-Engine, Cross-IDE | mittel — stark Sourcegraph-gekoppelt, Re-Branding aufwändig |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | TS | Apache 2.0 | VS-Code-only, gute Agent-Mode-UX | mittel |
| [aider](https://github.com/Aider-AI/aider) | Python | Apache 2.0 | Multi-Provider-Layer, exzellent dokumentiert | niedrig — Python, kein IDE-Plugin |

**Entscheidungs-Regel zur Phase 0 §0.1:** Wenn Continue.dev ≥ 60 % unserer Zielarchitektur abbildet (siehe Prüfpunkt-Tabelle in §0.1), ist Forken wahrscheinlich der bessere Pfad als Neu-Bau. **Diese Frage darf nicht implizit weg-entschieden werden.**

---

## Anhang B — agent-config-Konsumtions-Vertrag (Draft)

```yaml
# Was unser Plugin von einem agent-config-Tree erwartet (Minimum-Set)

required_directories:
  - skills/        # min 1 Skill
  - rules/         # min 1 Rule
  - commands/      # min 1 Command

required_metadata_fields_per_skill:
  - name
  - description
  - trust.level    # core | community | experimental

# Optional, aber konsumiert wenn vorhanden:
optional:
  - personas/
  - templates/
  - dist/router.json
  - .agent-settings.yml

# Plugin nimmt sich raus:
# - parsed YAML frontmatter
# - markdown body (für Procedure-Sections)
# - lifecycle field (überspringt "deprecated")
# - install.default (filtert "removable: true" wenn explizit ausgeschlossen)
```

---

> **Letzter Stand:** Plan v2 — Feedback-Iteration. Phase 0 ist neu (siehe §0); MVP-Scope deutlich gekürzt (§7.1); agent-config-Integration als primäres Differenzierungsmerkmal (§10); Context Engine mit klaren Non-Goals (§11.0); Positionierungs- und Build-vs-Fork-Entscheidungen in Phase 0 statt Sprint 10 (§18). **Bevor Sprint 1 startet:** Phase 0 §0 abschließen — ohne diese Entscheidungen ist alles darunter spekulativ.
