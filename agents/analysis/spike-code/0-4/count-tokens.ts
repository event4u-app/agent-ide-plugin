// Spike 0-4 — exact token counts via Anthropic countTokens.
// Optional supplementary to the heuristic measurements in spike-0-4-agent-config.md.
// Requires ANTHROPIC_API_KEY in env.
//
// Run:
//   pnpm add @anthropic-ai/sdk
//   pnpm tsx count-tokens.ts

import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const client = new Anthropic();
const ROOT = process.env.AGENT_CONFIG_ROOT
  ?? `${process.env.HOME}/projects/galawork/galawork-packages/event4u/agent-config/.agent-src`;

function walk(dir: string, glob: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, glob));
    else if (glob.test(p)) out.push(p);
  }
  return out;
}

async function tokenize(label: string, content: string): Promise<number> {
  const res = await client.messages.countTokens({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content }],
  });
  console.log(`${label}: ${res.input_tokens} tokens`);
  return res.input_tokens;
}

async function main() {
  const rules = walk(`${ROOT}/rules`, /\.md$/);
  const skills = walk(`${ROOT}/skills`, /\/SKILL\.md$/);
  const commands = walk(`${ROOT}/commands`, /\.md$/);

  const rulesBody = rules.map((f) => readFileSync(f, "utf8")).join("\n\n---\n\n");
  await tokenize(`all-rules-fullbody (n=${rules.length})`, rulesBody);

  const cmdDescs = commands
    .map((f) => {
      const body = readFileSync(f, "utf8");
      const m = body.match(/^---\n([\s\S]*?)\n---/);
      if (!m) return "";
      const dm = m[1].match(/^description: (.+)$/m);
      return dm ? dm[1] : "";
    })
    .filter(Boolean)
    .join("\n");
  await tokenize(`command-descriptions (n=${commands.length})`, cmdDescs);

  const skillDescs = skills
    .map((f) => {
      const body = readFileSync(f, "utf8");
      const m = body.match(/^---\n([\s\S]*?)\n---/);
      if (!m) return "";
      const dm = m[1].match(/^description: (.+)$/m);
      return dm ? dm[1] : "";
    })
    .filter(Boolean)
    .join("\n");
  await tokenize(`skill-descriptions (n=${skills.length})`, skillDescs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
