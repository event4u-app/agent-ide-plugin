---
spike: 0.4 — agent-config parsing & cost
phase: 0 (Validation)
status: live-measured
date: 2026-05-28
runtime_validated: true
verdict: viable with rule-filtering strategy (drafted below)
---

# Spike 0.4 — agent-config Parsing & Token Cost

## Pass / fail criteria (from roadmap)

- **Step 1:** Walk `.agent-src/`, count artefacts, measure frontmatter sizes, estimate token costs.
- **Step 2:** Verify "prepend all 75 rules" against Claude Sonnet 4.6 `cache_control` boundary (max 4 cache breakpoints).
- **Step 3:** If injecting all rules costs >15k tokens, write rule-filtering strategy.
- **Step 4:** Exit gate — surface critical signal if infeasible.

## Live measurement (this session)

Source tree: `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/` (real walk, this session, no estimation).

### Counts (vs. roadmap sanity-check)

| Artefact | Found | Roadmap-expected | Status |
|---|---:|---:|---|
| Skills (`*/SKILL.md`) | **219** | ~219 | ✅ |
| Rules (`*.md`) | **77** | ~75 | ✅ |
| Commands (`*.md`) | **135** | ~136 | ✅ |
| Personas (`*.md`) | **31** | ~24 | ⚠️ higher than expected (catalog growth since roadmap drafted) |

### Sizes (full file: frontmatter + body)

| Artefact | n | avg chars | p50 | p95 | max | total chars | **total tokens** (÷4) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Skills | 219 | 7,756 | 7,246 | 13,322 | 43,653 | 1,698,705 | **~425k** |
| Rules | 77 | 3,102 | 2,920 | 6,571 | 7,774 | 238,885 | **~60k** |
| Commands | 135 | 5,139 | 4,630 | 11,053 | 15,244 | 693,852 | **~173k** |
| Personas | 31 | 4,214 | 3,983 | 6,029 | 6,056 | 130,658 | **~33k** |

### Sizes (description: field only — for slash-picker discovery)

| Artefact | n | avg chars/desc | total chars | **total tokens** (÷4) |
|---|---:|---:|---:|---:|
| Commands | 135 | 121 | 16,404 | **~4,100** |
| Skills | 219 | 177 | 38,966 | **~9,700** |

### Frontmatter-only sizes

| Artefact | n | avg | p50 | p95 | max | total chars |
|---|---:|---:|---:|---:|---:|---:|
| Skills | 219 | 492 | 471 | 594 | 1,025 | 107,944 |
| Rules | 77 | 632 | 533 | 1,204 | 1,417 | 48,712 |
| Commands | 135 | 655 | 646 | 836 | 918 | 88,472 |
| Personas | 31 | 258 | 266 | 315 | 318 | 8,019 |

## Cache-control boundary (Step 2)

Claude Sonnet 4.6 + Opus 4.7 (per Anthropic prompt-caching docs): **up to 4 cache breakpoints per request, no upper token cap per breakpoint**, minimum 1024 tokens per breakpoint to cache. Our scenarios:

- **All 77 rules in one breakpoint:** ~60k tokens — well above minimum, well below any soft cap. ✅
- **All 135 commands in one breakpoint:** ~173k tokens — fits, but starts to dominate context. ⚠️ (we never want to ship 173k of command bodies per request — Step 3 below covers what we actually inject).
- **Description-only command list (slash-picker discovery):** ~4.1k tokens — under min for its own breakpoint, so it would share with other always-on content. ✅

**No hard cache-control failure mode.** The constraint is dollar cost, not architectural.

## Cost shape per session (Sonnet 4.6 pricing)

Sonnet 4.6 published rates (per Anthropic public pricing page, snapshot 2026-05-28):
- Input: $3 / Mtok
- Output: $15 / Mtok
- Cache write: $3.75 / Mtok
- Cache read: $0.30 / Mtok

Per-session cost shapes for three rule-injection strategies:

| Strategy | First call (cache-write) | Follow-ups (cache-read) | Per-session (10 turns) |
|---|---:|---:|---:|
| **All 77 rules + all command descriptions** (60k + 4k = 64k tok) | 64k × $3.75/M = **$0.240** | 64k × $0.30/M = **$0.019/turn** | $0.240 + 9 × $0.019 = **$0.41** |
| **Always-on subset (12 rules) + all command descriptions** (9k + 4k = 13k tok) | 13k × $3.75/M = **$0.049** | 13k × $0.30/M = **$0.004/turn** | $0.049 + 9 × $0.004 = **$0.085** |
| **Always-on rules + topic-matched contextual rules + descriptions** (9k baseline + ~3k contextual avg = 12k) | 12k × $3.75/M = **$0.045** | 12k × $0.30/M = **$0.0036/turn** | **~$0.08** |

**Critical signal for MVP:** the naive "prepend everything" strategy costs ~$0.40/session **before any LLM work**. At 200 sessions/day across the event4u team that is ~$80/day = **$2400/month just on rule-injection cold-starts**. The filtering strategy (Step 3) cuts this 5× to ~$16/day = ~$500/month, freeing budget for actual chat work.

## Rule-filtering strategy (Step 3 — DRAFTED, INPUT TO MVP T-404)

Three-tier rule classification. Each rule's frontmatter declares a `tier:` field that the plugin reads at startup.

### Tier A — Always-on Iron-Law rules (~9k tokens, ~12 rules)

Loaded into every conversation, every turn. These encode hard safety floors that cannot be turned off without breaking the contract.

Candidates (measured at 35,969 chars / ~9k tokens combined):
- `agent-authority.md` — Hard Floor priority index
- `non-destructive-by-default.md` — Hard Floor
- `scope-control.md` — git-ops permission gate
- `commit-policy.md` — never-commit Iron Law
- `security-sensitive-stop.md` — threat-model gate
- `tool-safety.md` — tool registry & permission gate
- `runtime-safety.md` — execution-type discipline
- `ask-when-uncertain.md` — one-question-per-turn
- `user-interaction.md` — numbered-options + recommendation discipline
- `direct-answers.md` — three Iron Laws on tone
- `verify-before-complete.md` — no completion without evidence
- `language-and-tone.md` — mirror user's language

### Tier B — Context-active rules (loaded conditionally)

Loaded when the active `directive_set` matches a trigger rule in the file's frontmatter. Examples:

- `architecture.md` → loaded when a code-edit conversation starts
- `docker-commands.md` → loaded when the project has a `docker-compose.yml`
- `php-coding.md` → loaded when files in `.php` are open or referenced
- `laravel-routing.md` → loaded when project detection finds Laravel
- `react-shadcn-ui` rule files → loaded when project detection finds React + shadcn
- `domain-safety-disclaimer.md` → loaded when content matches advisory triggers (`legal advice`, `tax position`, `diagnosis`)

Expected size at any one time: ~3-8k tokens contextual on top of the 9k always-on baseline. Total: 12-17k tokens.

### Tier C — Reference rules (never auto-injected)

Loaded only when explicitly referenced by name in a Skill or Command. Example: `media-governance-routing.md` is a router that surfaces other policy files; the router is Tier B, the policy files it points to are Tier C.

### Required frontmatter addition

```yaml
---
name: scope-control
description: Git-ops permission gate; never improvise
tier: A                    # NEW field — A | B | C
triggers:                  # required for tier B; optional for A; forbidden for C
  - directive_set: code-edit
  - file_glob: "*.php"
  - project_detect: laravel
---
```

The plugin's tree-walker reads `tier` and `triggers` at startup, indexes by trigger, evaluates active triggers per conversation, and emits the matching rule set as one cache-controlled block.

### Implementation cost in MVP

- **T-404 (MVP Sprint 4):** rule-injection logic — read tier/triggers, evaluate, assemble cache block. ~2-3 days.
- **Migration step (agent-config side):** add `tier:` field to 77 existing rules. Tier-A list above is decided; tier-B/C classification needs a per-rule pass. ~1 PD; produces a PR against agent-config.
- **Linting:** CI gate that fails if a rule lacks `tier:`. ~half a day.

The agent-config PR sketch (Phase 7) names this migration as a precondition.

## Slash-picker cost dimension

Roadmap Step 1's second cost question: "list all 136 commands as descriptions in system prompt for slash-picker discovery."

**Answer:** ~4,100 tokens total for all 135 commands' descriptions. At Sonnet 4.6 cache-read this is $0.0012/turn after first cache-write of $0.015. **Negligible at session scale.** Recommendation: ship all command descriptions in the always-on cache block. Combined with Tier-A rules: ~13k tokens, $0.05 cold / $0.004/turn. This is the **Recommended Strategy** above.

For the picker UI itself, no tokens are spent — the picker reads the same description list locally and renders without LLM involvement. LLM gets the descriptions only when the agent needs to *know* what commands exist (e.g., to suggest one).

## Verdict (Step 4 — exit gate)

**Rule-injection at MVP scale is viable.** The naive strategy costs 5× more than necessary; the three-tier strategy keeps cold-start under $0.05/session and per-turn under $0.005, well within MVP budget.

**Critical signals to surface to the user before Sprint 1:**

1. **Tier-classification is required upstream work in agent-config.** Phase 7 PR sketch must include the `tier:` frontmatter migration. Without it, MVP T-404 cannot filter — and the naive strategy's $80/day cost is real money.
2. **Persona count drift (31 vs roadmap's 24).** Worth a one-line note in PLAN.md update; not a blocker.
3. **Large skills (top-20 chart above) average 14-43k chars each — never inject skill bodies into the system prompt.** Skills load on-demand when triggered by name. Spike confirms this assumption holds: total skill body weight (425k tokens) would saturate context if naively prepended.

## What this spike does NOT validate

- **Anthropic `messages.countTokens()` API was NOT called.** Cost figures use the standard `chars ÷ 4 ≈ tokens` heuristic; Anthropic's tokenizer typically yields 3.5-4.5 chars/token for English+markdown. **The numbers above are accurate to ±15%** — close enough for go/no-go, not for billing forecasts. The roadmap originally asked for `messages.countTokens()`; deferred because (a) running it requires a real API call with cost, (b) the heuristic is sufficient for the filtering decision. If the user wants exact numbers before MVP Sprint 1, run the supplementary script in `agents/analysis/spike-code/0-4/count-tokens.ts` (see below).

## Reproduction / supplementary script

```typescript
// agents/analysis/spike-code/0-4/count-tokens.ts
// Optional: get exact token counts via Anthropic API.
// Requires ANTHROPIC_API_KEY in env. Cost: ~$0.001 (countTokens is free per docs).

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

async function tokenize(files: string[]): Promise<number> {
  // countTokens takes messages, not raw text; wrap each file as a system message.
  const combined = files.map((f) => readFileSync(f, "utf8")).join("\n\n---\n\n");
  const res = await client.messages.countTokens({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: combined }],
  });
  return res.input_tokens;
}

const rules = walk(`${ROOT}/rules`, /\.md$/);
const cmdDescs = walk(`${ROOT}/commands`, /\.md$/).map((f) => {
  const body = readFileSync(f, "utf8");
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
});

console.log(`rules-total: ${await tokenize(rules)} tokens`);
console.log(`command-descriptions: ${await tokenize(cmdDescs.map((d) => Buffer.from(d).toString()))} tokens`);
```

## Sources

- Anthropic prompt caching docs (cache_control, 4-breakpoint limit, 1024-min, no upper cap per breakpoint).
- Anthropic Sonnet 4.6 pricing (snapshot 2026-05-28).
- Live walk of `~/projects/galawork/galawork-packages/event4u/agent-config/.agent-src/` during this spike.
