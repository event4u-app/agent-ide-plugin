import type {
  CommandListRequest,
  CommandListResponse,
  CommandReadRequest,
  CommandReadResponse,
} from '@event4u-agent/protocol';
import type { ConfigNode } from '../config/agent-config-walker.js';
import type { AgentConfigMcpClient } from '../mcp/agent-config-client.js';
import { loadCommandProcedure } from './loader.js';
import { commandsToPickerItems, pickCommands } from './picker.js';

/**
 * T-402 + T-1103 (core/transport half) — the slash-command palette data path.
 *
 * Wires the shipped-but-dead command seam (`commandsToPickerItems` / `pickCommands`
 * from the T-402 picker + `loadCommandProcedure` from the T-1103 loader, all
 * unit-tested with ZERO live callers) onto two read-only protocol methods:
 *  - `commandList {query?}` → ranked/listed {@link CommandSummary}s for the overlay;
 *  - `commandRead {name}`   → the command's procedure body at invocation time.
 *
 * Core stays the authority on resolution (MCP-first, local-fallback) so the
 * agent and the palette see the same commands and bodies, and the plugin works
 * offline / before the agent-config MCP server is up (AI council 2026-06-02
 * Q5/Q6). The overlay rendering + invocation UX remain IDE surfaces → T-402 /
 * T-1103 stay `[~]`; this is the headless data path those surfaces call.
 */

/** Hard ceiling on returned summaries so a large config tree can't bloat the NDJSON line. */
export const MAX_COMMAND_LIST_RESULTS = 100;

/** Coded error so an absent command handler surfaces cleanly (mirrors ChatRequestError). */
export class CommandRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandRequestError';
  }
}

export interface CommandHandlerDeps {
  /**
   * Walk the agent-config tree for the command index. Called once and the
   * result cached for the session (commands are session-static, like rules —
   * mirrors `createRulesLoader`). The sidecar passes `() => walkAgentConfig(cwd)`.
   */
  loadNodes: () => Promise<readonly ConfigNode[]>;
  /**
   * Connected agent-config MCP client, when available. `commandRead` prefers it
   * over the local walker body (single source of truth); absent ⇒ local-only,
   * the documented offline path. No live composition root builds one yet.
   */
  mcp?: AgentConfigMcpClient;
}

export class CommandHandler {
  private cachedNodes: readonly ConfigNode[] | undefined;

  constructor(private readonly deps: CommandHandlerDeps) {}

  /**
   * Walk-once-cache the command index. Fail-open: a walk *error* degrades to an
   * empty index WITHOUT caching, so a transient FS race retries next call rather
   * than disabling the palette for the whole session (mirrors `createRulesLoader`).
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
   * List or search the command palette. Absent/empty query → every command
   * alphabetically; a query → subsequence-ranked matches (best first). `total`
   * is the match count before the cap so the IDE can show "showing N of M".
   */
  async list(req: CommandListRequest): Promise<CommandListResponse> {
    const items = commandsToPickerItems(await this.nodes());
    const ranked = pickCommands(items, req.query ?? '');
    const cap = Math.min(req.limit ?? MAX_COMMAND_LIST_RESULTS, MAX_COMMAND_LIST_RESULTS);
    return {
      commands: ranked
        .slice(0, cap)
        .map((item) => ({ name: item.name, description: item.description, path: item.path })),
      total: ranked.length,
    };
  }

  /** Load one command's procedure body (MCP-first, local-fallback) by name. */
  async read(req: CommandReadRequest): Promise<CommandReadResponse> {
    const loaded = await loadCommandProcedure(req.name, {
      ...(this.deps.mcp ? { mcp: this.deps.mcp } : {}),
      localNodes: await this.nodes(),
    });
    return { name: loaded.name, source: loaded.source, body: loaded.body };
  }
}
