---
phase: 0
step: Phase 7 Step 1
status: sketch-pending-maintainer-feedback
date: 2026-05-28
target_repo: event4u-app/agent-config
---

# agent-config PR Sketch — event4u-agent (IDE Plugin) integration

> **Purpose.** Make `event4u-agent` (this plugin) a first-class consumer of agent-config, alongside Claude Code / Cursor / Cline / Windsurf / Gemini CLI / Copilot / Roo Code / Codex / Continue / Aider / Augment / Claude Desktop. Equivalent to "Pipeline E" in the upstream pipeline taxonomy.
>
> **PR target.** `event4u-app/agent-config` — open as draft for maintainer feedback before formal PR. Maintainer is the user (solo-dev). Treat "maintainer feedback" as a self-review step before the implementation PR lands.

## What the upstream package currently does

From the agent-config README (snapshot 2026-05-28):

| Tool | Rules | Skills | Commands | How it works |
|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | Reads `.claude/` |
| Cursor | ✅ | — | ☑️ | Reads `.cursor/rules/` + commands via AGENTS.md |
| Augment (VSCode/IntelliJ) | 📌 | — | — | Global-only; project writes marker |

The plugin needs to land in this matrix as a **fully-native** entry — ideally `✅ ✅ ✅` like Claude Code — because the plugin hosts the agent-config tree itself (not as text-reference but as a parsed, indexed, slash-pickable surface).

## Proposed upstream changes

### 1. New projection: `.event4u-agent/`

A new pipeline target that the installer creates inside consumer projects when the user runs:

```bash
npx @event4u/agent-config init --tools event4u-agent
```

Layout (mirrors `.claude/` shape so the existing condensation pipeline rules apply with minimal new code):

```
.event4u-agent/
├── README.md                  # 5-line "what this is" + link upstream
├── skills/                    # symlinked from .agent-src/skills/
├── rules/                     # symlinked from .agent-src/rules/  (always-on subset filtered by Tier-A — see ADR-004)
├── commands/                  # symlinked from .agent-src/commands/
├── personas/                  # symlinked from .agent-src/personas/
└── manifest.json              # plugin discovery + version pin
```

`manifest.json` shape:

```json
{
  "name": "event4u-agent-config",
  "version": "1.0.0",
  "marketplaces": ["jetbrains", "vscode"],
  "minimum_plugin_version": "0.1.0",
  "agent_config_version": "v2.5+",
  "tier_filter": "ABC",
  "transports_supported": ["api", "cli"],
  "telemetry_opt_in_required": true
}
```

The marker (`.event4u-agent-plugin/marker.json`) tells the plugin "this project consents to be acted upon" (same pattern as the existing `.augment-plugin/` and `.claude-plugin/`).

### 2. New entry in "Supported tools" README table

```diff
 | **Claude Code** | ✅ | ✅ | ✅ | Reads `.claude/` |
+| **event4u Agent (JetBrains + VS Code)** | ✅ | ✅ | ✅ | Reads `.event4u-agent/` (native plugin from `event4u-app/agent-ide-plugin`) |
 | **Cursor** | ✅ | — | ☑️ | Reads `.cursor/rules/` + commands via AGENTS.md |
```

Plus a row in the badges block at the top of the README announcing event4u-agent native support.

### 3. Installer wiring (`scripts/install/` — adapt to actual installer entry point)

```typescript
// scripts/install/projections/event4u-agent.ts
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function projectEvent4uAgent(projectRoot: string, srcRoot: string) {
  const target = join(projectRoot, ".event4u-agent");
  mkdirSync(target, { recursive: true });

  for (const kind of ["skills", "rules", "commands", "personas"]) {
    symlinkSync(join(srcRoot, kind), join(target, kind), "dir");
  }

  writeFileSync(
    join(target, "manifest.json"),
    JSON.stringify(manifest(), null, 2),
  );

  mkdirSync(join(projectRoot, ".event4u-agent-plugin"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".event4u-agent-plugin", "marker.json"),
    JSON.stringify({ name: "event4u-agent-config", marketplaces: ["jetbrains", "vscode"] }, null, 2),
  );
}
```

### 4. Tier-A frontmatter migration (cross-reference Phase 4 / Spike 0.4)

Phase 4 Spike 0.4 surfaced the need for `tier: A | B | C` in each rule's frontmatter so the plugin can filter rule-injection at MVP scale. This migration is the **precondition** for the PR above — without it, the plugin's `.event4u-agent/rules/` symlink injects all 60k tokens of rules every session.

Two sub-PRs:

**Sub-PR (a) — schema:**
- Add `tier: A | B | C` to the rule frontmatter schema in `scripts/schemas/`.
- Add CI lint that fails if a rule lacks `tier:`.

**Sub-PR (b) — bulk classification:**
- Annotate all 77 rules with `tier:`.
- Tier-A (12 rules) is decided in Spike 0.4 / ADR-004.
- Tier-B / Tier-C classification needs a per-rule pass with the upstream maintainer (i.e., a self-review).

### 5. Test plan

```python
# tests/test_event4u_agent_projection.py — adapt to upstream's test conventions

def test_projection_creates_symlinks(tmp_project):
    project_event4u_agent(tmp_project.path, tmp_project.src)
    for kind in ["skills", "rules", "commands", "personas"]:
        assert (tmp_project.path / ".event4u-agent" / kind).is_symlink()

def test_manifest_pins_versions(tmp_project):
    project_event4u_agent(tmp_project.path, tmp_project.src)
    manifest = json.loads((tmp_project.path / ".event4u-agent" / "manifest.json").read_text())
    assert manifest["marketplaces"] == ["jetbrains", "vscode"]
    assert manifest["tier_filter"] == "ABC"
    assert manifest["transports_supported"] == ["api", "cli"]

def test_marker_present(tmp_project):
    project_event4u_agent(tmp_project.path, tmp_project.src)
    marker = json.loads((tmp_project.path / ".event4u-agent-plugin" / "marker.json").read_text())
    assert marker["name"] == "event4u-agent-config"

def test_tier_lint_blocks_missing_tier(tmp_project):
    # Rule without tier: → lint failure
    rule = tmp_project.src / "rules" / "missing-tier.md"
    rule.write_text("---\nname: missing-tier\n---\n\nbody\n")
    result = subprocess.run(["python3", "scripts/lint_rule_tier.py"], cwd=tmp_project.path)
    assert result.returncode != 0
```

### 6. Documentation updates

- `docs/architecture.md` — add event4u-agent to the pipeline diagram (currently shows Claude / Cursor / Augment).
- `docs/contracts/install-scopes.md` — add event4u-agent as a project-scope consumer.
- `docs/profiles.md` — add a hint that `developer` and `content_creator` profiles can use event4u-agent as their IDE host.

## What this PR does NOT do

- It does NOT change the source-of-truth tree `.agent-src.uncondensed/`. The projection reads from `.agent-src/` (condensed).
- It does NOT change the condensation pipeline (no new condensation rule, no new lint).
- It does NOT change the AGENTS.md text-reference pattern that VS Code / Cline / Cursor / etc. depend on. The plugin's native consumption is *additional*, not replacement.
- It does NOT touch the Continue.dev row (`☑️` text-ref + auto-discover via AGENTS.md). Continue gets discovery; our plugin gets native projection.

## Maintainer-feedback questions (self-review)

These are the questions the upstream maintainer (you, solo-dev) needs to answer before the PR can land:

1. **Marketplace name namespace.** Is `event4u-agent` the right name in the README's tools table? Or `event4u IDE Plugin` for clarity? The marketplace listing will use one of these.
2. **Symlink vs copy.** Should `.event4u-agent/` use symlinks (current sketch) or hard-copies? Symlinks are 0-cost but fail on Windows without dev-mode admin permissions; copies are 200 MB but Windows-friendly. Existing tools use a mix — check what `.claude/` does (looks like Hardcopy from inspection: rules and skills are real files in `.claude/skills/`, not symlinks).
3. **Tier migration ordering.** Land the Tier-A schema lint first (and let the 12 Tier-A rules get the field), or land all 77 at once? Big-bang is risky (lint fires everywhere); incremental needs a "tier is optional during migration" carve-out.
4. **manifest.json versioning.** Should the plugin pin to an agent-config version range (`>=2.5.0 <3.0.0`)? Or pin exact and force users to bump together?
5. **Installer flag name.** `--tools event4u-agent` vs `--tools event4u` vs `--tools agent-ide-plugin`. Pick once, commit forever.
6. **Tests location.** Existing tests likely in `tests/` (Python via pytest per `pyproject.toml`). Confirm conventions before adding.

## Maintainer-feedback notes (capture verbatim once self-review runs)

> _To be filled in when the user runs the self-review session._
>
> Q1 marketplace name: …
> Q2 symlink vs copy: …
> Q3 tier migration ordering: …
> Q4 manifest.json versioning: …
> Q5 installer flag name: …
> Q6 tests location: …
>
> Decision summary: …
> Tickets / sub-issues opened: …

## Acceptance for Phase 7 Step 2

This sketch is "shared" when:
- ✅ Drafted in `agents/analysis/agent-config-pr-sketch.md` (this file).
- ⚠️ Self-reviewed by the user (maintainer-feedback questions answered above).
- ⚠️ A draft PR opened against `event4u-app/agent-config` (or a tracking issue) — **out of scope for this autonomous session** because it requires the user's GitHub authentication on the agent-config repo and a "maintainer" intent that is the user's call.
