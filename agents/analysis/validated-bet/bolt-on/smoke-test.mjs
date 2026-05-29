#!/usr/bin/env node
/**
 * Walker smoke-test — proves loadAgentConfigSlashCommands() logic works against
 * the real agent-config tree, without needing Continue's full TS runtime.
 *
 * Mirrors agentConfigSlashCommand.ts byte-for-byte (parsing + path resolution
 * logic) but drops the TypeScript types + Continue's SlashCommandWithSource
 * type. Run: `node smoke-test.mjs` from any cwd.
 *
 * Pass criteria — should print 5 entries with non-empty name + description.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const AGENT_CONFIG_ROOT = path.join(
  os.homedir(),
  "projects/galawork/galawork-packages/event4u/agent-config/.agent-src",
);

const HANDPICKED = [
  { kind: "skill",   slug: "git-workflow" },
  { kind: "skill",   slug: "code-refactoring" },
  { kind: "rule",    slug: "commit-policy" },
  { kind: "rule",    slug: "scope-control" },
  { kind: "command", slug: "commit" },
];

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const [, fmBlock, body] = match;
  const fm = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    if (key !== "name" && key !== "description") continue;
    fm[key] = rawValue.replace(/^["']|["']$/g, "").trim();
  }
  return { frontmatter: fm, body };
}

function resolveArtefactPath(kind, slug) {
  let p;
  switch (kind) {
    case "skill":   p = path.join(AGENT_CONFIG_ROOT, "skills",   slug, "SKILL.md"); break;
    case "rule":    p = path.join(AGENT_CONFIG_ROOT, "rules",    `${slug}.md`);    break;
    case "command": p = path.join(AGENT_CONFIG_ROOT, "commands", `${slug}.md`);    break;
  }
  return fs.existsSync(p) ? p : null;
}

function loadAgentConfigSlashCommands() {
  if (!fs.existsSync(AGENT_CONFIG_ROOT)) {
    console.error(`AGENT_CONFIG_ROOT not found: ${AGENT_CONFIG_ROOT}`);
    return [];
  }
  const out = [];
  for (const { kind, slug } of HANDPICKED) {
    const filePath = resolveArtefactPath(kind, slug);
    if (!filePath) {
      console.warn(`[agent-config] artefact not found: ${kind}/${slug}`);
      continue;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    out.push({
      name: frontmatter.name ?? slug,
      description: `[${kind}] ${frontmatter.description ?? `${kind} from agent-config`}`,
      prompt: body.trim(),
      source: "agent-config",
      sourceFile: filePath,
    });
  }
  return out;
}

// -- Run + report -----------------------------------------------------------

const commands = loadAgentConfigSlashCommands();
console.log(`Found ${commands.length} / 5 expected agent-config slash commands.\n`);
console.log("idx | source-kind            | name                    | description (first 80 chars)");
console.log("----+------------------------+-------------------------+-----------------------------------------------------");
for (const [i, cmd] of commands.entries()) {
  const kind = path.basename(path.dirname(cmd.sourceFile.replace(`${AGENT_CONFIG_ROOT}/`, "").split("/")[0]));
  const trailingSeg = cmd.sourceFile.replace(`${AGENT_CONFIG_ROOT}/`, "").split("/")[0];
  const desc80 = cmd.description.replace(/\n/g, " ").slice(0, 80);
  console.log(`  ${i + 1} | ${trailingSeg.padEnd(22)} | ${cmd.name.padEnd(23)} | ${desc80}`);
}
console.log();
console.log("Prompt body lengths (chars):");
for (const cmd of commands) {
  console.log(`  ${cmd.name.padEnd(25)} → ${cmd.prompt.length.toString().padStart(6)} chars`);
}

process.exit(commands.length === 5 ? 0 : 1);
