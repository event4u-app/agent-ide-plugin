/**
 * agent-config Slash-Command Source — Phase 2 bolt-on for road-to-validated-bet.md
 *
 * Walks the agent-config `.agent-src/` tree (hard-coded to event4u's checkout
 * for this bolt-on; production version would read from config.experimental.agentConfigPath)
 * and surfaces 5 hand-picked artefacts as SlashCommandWithSource entries.
 *
 * Time-of-write: 2026-05-29 · written for Trigger #2 measurement
 * (does Continue accept the agent-config tree as a slash-command source in ≤ 16 hours?).
 *
 * Known limitations (intentional for bolt-on, would be lifted for production):
 *   - Hard-coded root path (no IDE-config wiring).
 *   - Hand-picked 5 artefacts (no fuzzy / tier filtering yet).
 *   - Minimal frontmatter parsing (regex, not full YAML — fine for our subset).
 *   - No file-system watch (re-walked only on Continue restart).
 *   - No `.agent-src.uncondensed/` fallback.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SlashCommandWithSource } from "../..";

// -- Configuration -----------------------------------------------------------

const AGENT_CONFIG_ROOT = path.join(
  os.homedir(),
  "projects/galawork/galawork-packages/event4u/agent-config/.agent-src",
);

/**
 * The 5 artefacts surfaced by this bolt-on, per `road-to-validated-bet.md`
 * Phase 2 Step 2: 2 skills + 2 rules + 1 command. Hand-picked for relevance
 * to the demo target (the `/commit` flow from MVP Sprint 4).
 */
const HANDPICKED: Array<{ kind: "skill" | "rule" | "command"; slug: string }> = [
  { kind: "skill",   slug: "git-workflow" },
  { kind: "skill",   slug: "code-refactoring" },
  { kind: "rule",    slug: "commit-policy" },
  { kind: "rule",    slug: "scope-control" },
  { kind: "command", slug: "commit" },
];

// -- Frontmatter parsing -----------------------------------------------------

interface Frontmatter {
  name?: string;
  description?: string;
}

/**
 * Parse the leading `--- ... ---` YAML frontmatter block of a markdown file.
 * Minimal — extracts `name` and `description` only. Returns `{}` if no
 * frontmatter or no extraction. Multi-line strings / nested YAML are NOT
 * supported (out-of-scope for bolt-on).
 */
function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const [, fmBlock, body] = match;
  const fm: Frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    if (key !== "name" && key !== "description") continue;
    // Strip surrounding quotes if present.
    fm[key] = rawValue.replace(/^["']|["']$/g, "").trim();
  }
  return { frontmatter: fm, body };
}

// -- Path resolution ---------------------------------------------------------

function resolveArtefactPath(kind: "skill" | "rule" | "command", slug: string): string | null {
  let p: string;
  switch (kind) {
    case "skill":
      p = path.join(AGENT_CONFIG_ROOT, "skills", slug, "SKILL.md");
      break;
    case "rule":
      p = path.join(AGENT_CONFIG_ROOT, "rules", `${slug}.md`);
      break;
    case "command":
      p = path.join(AGENT_CONFIG_ROOT, "commands", `${slug}.md`);
      break;
  }
  return fs.existsSync(p) ? p : null;
}

// -- Public API --------------------------------------------------------------

/**
 * Walk the agent-config tree and produce SlashCommandWithSource entries for
 * the 5 hand-picked artefacts. Missing artefacts are silently skipped (logged
 * to stderr so the bolt-on doesn't crash a non-event4u Continue install).
 *
 * Returns [] if AGENT_CONFIG_ROOT does not exist.
 */
export function loadAgentConfigSlashCommands(): SlashCommandWithSource[] {
  if (!fs.existsSync(AGENT_CONFIG_ROOT)) {
    return [];
  }

  const out: SlashCommandWithSource[] = [];
  for (const { kind, slug } of HANDPICKED) {
    const filePath = resolveArtefactPath(kind, slug);
    if (!filePath) {
      // eslint-disable-next-line no-console
      console.warn(`[agent-config] artefact not found: ${kind}/${slug}`);
      continue;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const name = frontmatter.name ?? slug;
    const description = frontmatter.description ?? `${kind} from agent-config`;
    out.push({
      name,
      description: `[${kind}] ${description}`,
      prompt: body.trim(),
      source: "agent-config" as any, // cast — bolt-on extends SlashCommandSource via index.d.ts
      sourceFile: filePath,
    });
  }
  return out;
}
