---
phase: 0
step: Phase 7 Step 3
status: template-pending-team-input
date: 2026-05-28
---

# IDE-Version Survey — event4u team JetBrains compatibility check

> **Purpose.** Validate `sinceBuild="242"` (PhpStorm 2024.2+) against actual versions running on event4u-team machines. If anyone is on <2024.2, decide: lower `sinceBuild`, or push that team-member to upgrade.
>
> **This survey cannot be auto-run.** It requires asking team members or reading their JetBrains Toolbox config remotely.

## Why 2024.2 specifically

- Continue.dev's JetBrains plugin (the architectural reference per ADR-001 Hybrid verdict) declares `sinceBuild = "241"` and verifies against IC 2024.1, 2024.2, 2024.3, 2025.1, 2025.2 (per Spike 0-1 inspection of `extensions/intellij/build.gradle.kts`).
- The reworked Terminal lands as default in 2025.2 (per Spike 0-3d). Our own `JBTerminalWidget` instance stays on Classic across versions, so this is not a 2025.2-gating concern.
- JCEF out-of-process default is established in 2024.x → 2025.x. Going below 2024.x means handling in-process JCEF + the known leak tickets (per Spike 0-3a).

**Default target: `sinceBuild="241"` (2024.1+)** to match Continue's tested range. If any event4u-team member runs <2024.1, we have a real upgrade conversation; if they run 2024.2+, we're fine.

## Survey template (paste into Slack / email)

```
Subject: Quick: which JetBrains IDE version are you on?

I'm scoping the IDE plugin we're building for the event4u workflows. Need to know
the lowest IntelliJ-platform version anyone on the team is running, so the plugin's
"sinceBuild" doesn't accidentally lock people out.

Two ways to tell me:

  1. JetBrains Toolbox → settings of the IDE you use most → "About" → screenshot it,
     or just type the version (e.g. "PhpStorm 2024.3.5" or "IntelliJ IDEA 2025.1").

  2. From the IDE: Help → About → Build #. The number after "PS-" or "IU-" tells
     us the platform version (242.x = 2024.2, 243.x = 2024.3, 251.x = 2025.1,
     252.x = 2025.2). Send me that.

I need this from anyone who'd use the plugin. Reply by <DATE>; if you don't reply,
I'll assume you're on 2024.2+ and move on.

Thanks.
```

## Captured responses

> _Fill in here as responses come in._

| Team member | IDE | Version | Build # | Date |
|---|---|---|---|---|
| (TBD) | PhpStorm / IntelliJ / WebStorm / ... | 2024.x / 2025.x | 242.x / 243.x / 251.x / 252.x | YYYY-MM-DD |

## Decision matrix

| Survey outcome | `sinceBuild` decision | Action |
|---|---|---|
| All on 2024.2+ | `sinceBuild = "242"` (per roadmap default) | Keep |
| Someone on 2024.1 | `sinceBuild = "241"` | Lower; matches Continue's tested range |
| Someone on 2023.x | `sinceBuild = "233"` (2023.3) **or** ask them to upgrade | Surface trade-off to user (older API = more compat shims, smaller `untilBuild` window upstream) |
| Someone on <2023 | Ask them to upgrade | Sustaining a plugin on <2023 isn't viable solo-dev |

## Acceptance for Phase 7 Step 3 / Step 4

Phase 7 Step 3:
- ✅ Survey template drafted (this file).
- ⚠️ Cannot run team survey in autonomous session — requires user to send + collect responses (~1 week).

Phase 7 Step 4 (exit gate):
- ✅ PR sketch shared (drafted in `agent-config-pr-sketch.md`; awaits self-review).
- ⚠️ IDE survey complete — pending user execution.
