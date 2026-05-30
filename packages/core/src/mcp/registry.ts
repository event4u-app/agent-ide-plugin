import type { ToolDefinition } from '@event4u-agent/protocol';
import type { McpClient } from './client.js';
import { contentToText, type CallToolResult, type McpTool } from './protocol.js';

/**
 * T-1101 — aggregation layer that slots MCP tools next to the agent's built-in
 * tools. Each server's tools are namespaced `<server-id>:<tool-name>` so two
 * servers exposing a `search` tool never collide. Prefixing happens here, not
 * in {@link McpClient}, keeping the client server-id-agnostic (Q2 of the
 * council).
 *
 * The registry is fed by the {@link McpManager}; it owns no process lifecycle.
 */

/** Separator between the server id and the remote tool name in a prefixed id. */
export const MCP_TOOL_SEPARATOR = ':';

export interface McpManagedTool {
  /** LLM-facing, prefixed id, e.g. `github:search_issues`. */
  id: string;
  /** Server this tool belongs to. */
  serverId: string;
  /** Name as the server knows it (what gets sent in `tools/call`). */
  remoteName: string;
  description: string;
  /** JSON Schema for the tool input, forwarded verbatim to the LLM. */
  inputSchema: Record<string, unknown>;
}

export class McpRegistryError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'McpRegistryError';
  }
}

interface ServerEntry {
  client: McpClient;
  tools: McpManagedTool[];
}

export function prefixToolId(serverId: string, remoteName: string): string {
  return `${serverId}${MCP_TOOL_SEPARATOR}${remoteName}`;
}

export class McpToolRegistry {
  private readonly servers = new Map<string, ServerEntry>();

  /**
   * Register a connected server and its advertised tools. Replaces any prior
   * entry for the same id (a reconnect re-registers fresh tools).
   */
  register(serverId: string, client: McpClient, tools: readonly McpTool[]): void {
    if (serverId.includes(MCP_TOOL_SEPARATOR)) {
      throw new McpRegistryError(
        `server id '${serverId}' must not contain '${MCP_TOOL_SEPARATOR}'`,
      );
    }
    const managed = tools.map<McpManagedTool>((t) => ({
      id: prefixToolId(serverId, t.name),
      serverId,
      remoteName: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    this.servers.set(serverId, { client, tools: managed });
  }

  /** Drop a server (e.g. after it died and reconnect was abandoned). */
  unregister(serverId: string): void {
    this.servers.delete(serverId);
  }

  get serverIds(): string[] {
    return [...this.servers.keys()];
  }

  /** Every managed tool across all registered servers, prefixed. */
  tools(): McpManagedTool[] {
    return [...this.servers.values()].flatMap((entry) => entry.tools);
  }

  /** Map the aggregated tools onto the LLM tool-definition contract. */
  toolDefinitions(): ToolDefinition[] {
    return this.tools().map((t) => ({
      name: t.id,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /** Look up a tool by its prefixed id. */
  find(toolId: string): McpManagedTool | undefined {
    return this.tools().find((t) => t.id === toolId);
  }

  /**
   * Route a `tools/call` by prefixed id to the owning server. Throws
   * {@link McpRegistryError} for an unknown id or an unparseable prefix.
   */
  async callTool(toolId: string, args: unknown): Promise<CallToolResult> {
    const sep = toolId.indexOf(MCP_TOOL_SEPARATOR);
    if (sep <= 0) {
      throw new McpRegistryError(`tool id '${toolId}' is not '<server>:<tool>'-shaped`);
    }
    const serverId = toolId.slice(0, sep);
    const remoteName = toolId.slice(sep + 1);
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new McpRegistryError(`no MCP server registered as '${serverId}'`);
    }
    if (!entry.tools.some((t) => t.remoteName === remoteName)) {
      throw new McpRegistryError(`server '${serverId}' has no tool '${remoteName}'`);
    }
    return entry.client.callTool(remoteName, args);
  }

  /** Convenience: call a tool and flatten its content to a single string. */
  async callToolText(toolId: string, args: unknown): Promise<{ text: string; isError: boolean }> {
    const result = await this.callTool(toolId, args);
    return { text: contentToText(result.content), isError: result.isError };
  }
}
