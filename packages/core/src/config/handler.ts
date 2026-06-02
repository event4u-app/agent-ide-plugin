import type {
  ConfigKind,
  ConfigListRequest,
  ConfigListResponse,
  ConfigReadRequest,
  ConfigReadResponse,
  ConfigSummary,
} from '@event4u-agent/protocol';
import { type ConfigNode, indexByKind } from './agent-config-walker.js';

/**
 * T-401 + ADR-050 — the agent-config registry data path.
 *
 * Wires the shipped-but-dead `indexByKind` (the agent-config-walker grouping
 * helper, unit-tested with ZERO live callers) onto one read-only protocol
 * method:
 *  - `configList {kind?, limit?}` → lightweight {@link ConfigSummary}s for the
 *    IDE's skill picker / rules viewer / unified artifact browser.
 *
 * The command-only fuzzy palette already lives on `commandList` (ADR-048);
 * this is its sibling for the kinds that had NO protocol data path — skills
 * and rules — and, for a unified browser, commands too (AI council 2026-06-02,
 * gemini-cli 0.41.2, Q1=B). The overlay rendering remains an IDE surface; this
 * is the headless data path it calls. Mirrors the established "Core returns
 * lightweight summaries, the IDE renders" shape (`commandList`).
 *
 * A dedicated handler (not an extension of `CommandHandler`) keeps the
 * one-handler-per-domain pattern and lets each handler own its independent
 * fail-open walk cache — a sidecar-level shared promise would cache a
 * transient FS error for the whole session. The marginal second walk is
 * acceptable: config trees are small.
 */

/** Hard ceiling on returned summaries so a large config tree can't bloat the NDJSON line. */
export const MAX_CONFIG_LIST_RESULTS = 100;

/** The order kinds appear in an unfiltered listing (alphabetical within each). */
const ALL_KINDS: readonly ConfigKind[] = ['skill', 'rule', 'command'];

/** Coded error so an absent config handler surfaces cleanly (mirrors CommandRequestError). */
export class ConfigRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigRequestError';
  }
}

export interface ConfigHandlerDeps {
  /**
   * Walk the agent-config tree for the registry index. Called once and the
   * result cached for the session (artifacts are session-static, like rules).
   * The sidecar passes `() => walkAgentConfig(cwd)`.
   */
  loadNodes: () => Promise<readonly ConfigNode[]>;
}

export class ConfigHandler {
  private cachedNodes: readonly ConfigNode[] | undefined;

  constructor(private readonly deps: ConfigHandlerDeps) {}

  /**
   * Walk-once-cache the registry index. Fail-open: a walk *error* degrades to
   * an empty index WITHOUT caching, so a transient FS race retries next call
   * rather than disabling the registry for the whole session (mirrors
   * `CommandHandler`).
   */
  private async nodes(): Promise<readonly ConfigNode[]> {
    if (this.cachedNodes !== undefined) return this.cachedNodes;
    try {
      this.cachedNodes = await this.deps.loadNodes();
      return this.cachedNodes;
    } catch {
      return [];
    }
  }

  /**
   * List agent-config artifacts. Absent `kind` → skills, then rules, then
   * commands (alphabetical within each kind, as the walker sorts); a `kind` →
   * only that kind. `total` is the count before the cap so the IDE can show
   * "showing N of M".
   */
  async list(req: ConfigListRequest): Promise<ConfigListResponse> {
    const grouped = indexByKind(await this.nodes());
    const kinds = req.kind ? [req.kind] : ALL_KINDS;
    const all = kinds.flatMap((kind) => grouped[kind].map(toSummary));
    const cap = Math.min(req.limit ?? MAX_CONFIG_LIST_RESULTS, MAX_CONFIG_LIST_RESULTS);
    return { items: all.slice(0, cap), total: all.length };
  }

  /**
   * Read one artifact's body by `{kind, name}`. The body is read straight off
   * the cached walk index — the SAME walk `list` groups — so list and read can
   * never disagree (AI council 2026-06-02 Q5). The match is on the artifact's
   * DISPLAY name (`displayName`, frontmatter `name` ?? slug), i.e. exactly the
   * `name` `list` returned, not the raw file slug. Local-only: a node hit is
   * `source: 'local'`, a miss is `source: 'missing'` with an empty body (no
   * throw — mirrors `commandRead`). Full body, uncapped (Q4).
   */
  async read(req: ConfigReadRequest): Promise<ConfigReadResponse> {
    const node = (await this.nodes()).find(
      (n) => n.kind === req.kind && displayName(n) === req.name,
    );
    return node
      ? { kind: req.kind, name: req.name, source: 'local', body: node.body }
      : { kind: req.kind, name: req.name, source: 'missing', body: '' };
  }
}

/** Project a walked node to its wire summary. Description falls back like the command picker. */
function toSummary(node: ConfigNode): ConfigSummary {
  const fm = node.frontmatter as { description?: unknown };
  const description =
    (typeof fm.description === 'string' && fm.description.trim().length > 0
      ? firstLine(fm.description)
      : firstHeading(node.body)) ?? '';
  return { kind: node.kind, name: displayName(node), description, path: node.absPath };
}

/** The name a node is listed under: a non-empty frontmatter `name`, else the file slug. */
function displayName(node: ConfigNode): string {
  const fm = node.frontmatter as { name?: unknown };
  return typeof fm.name === 'string' && fm.name.trim().length > 0 ? fm.name : node.name;
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function firstHeading(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').trim();
    }
  }
  return undefined;
}
