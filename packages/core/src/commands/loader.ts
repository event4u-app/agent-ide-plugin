import type { ConfigNode } from '../config/agent-config-walker.js';
import type { AgentConfigMcpClient } from '../mcp/agent-config-client.js';

/**
 * T-1103 (core half) — load a command's procedure body at invocation time.
 *
 * Source priority: the agent-config MCP server's `command_read` tool when a
 * client is connected, else the local walker index (the body already parsed
 * from disk). This keeps the plugin working offline / before the MCP server is
 * up, while preferring agent-config as the single source of truth when it is.
 *
 * The slash-picker surfacing + the actual invocation UX are IDE-gated and
 * remain `[~]`; this is the headless loader those surfaces will call.
 */

export type CommandSource = 'mcp' | 'local' | 'missing';

export interface LoadedCommand {
  name: string;
  source: CommandSource;
  /** Procedure body; empty string when `source` is `missing`. */
  body: string;
}

export interface CommandLoaderDeps {
  /** Connected agent-config MCP client, when available. */
  mcp?: AgentConfigMcpClient;
  /** Walker output used for the local fallback. */
  localNodes: readonly ConfigNode[];
}

export async function loadCommandProcedure(
  name: string,
  deps: CommandLoaderDeps,
): Promise<LoadedCommand> {
  // 1. Prefer the agent-config MCP server.
  if (deps.mcp) {
    try {
      const result = await deps.mcp.commandRead(name);
      if (!result.isError && result.text.trim().length > 0) {
        return { name, source: 'mcp', body: result.text };
      }
    } catch {
      // MCP unreachable / errored — fall through to the local index.
    }
  }

  // 2. Local walker fallback.
  const node = deps.localNodes.find((n) => n.kind === 'command' && n.name === name);
  if (node) {
    return { name, source: 'local', body: node.body };
  }

  return { name, source: 'missing', body: '' };
}
