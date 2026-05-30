import type { McpServerConfig } from '../config/agent-settings.js';
import type { McpClient } from './client.js';
import { contentToText } from './protocol.js';

/**
 * T-1102 — typed convenience over the generic {@link McpClient} for the
 * agent-config-shipped MCP server (`npx @event4u/agent-config mcp`).
 *
 * Rather than re-implement filesystem readers for skill / rule / command
 * content, the plugin connects to agent-config's own server and drives its
 * tools. This wrapper names those tools so callers don't pass tool-name
 * strings around; the I/O is returned as flattened text (each tool's content
 * blocks joined) plus the `isError` flag, since agent-config owns the precise
 * payload shapes and they evolve independently of this plugin.
 */

/** The server id under which the agent-config server is conventionally registered. */
export const AGENT_CONFIG_SERVER_ID = 'agent-config';

/** Default config to spawn the agent-config MCP server if not user-declared. */
export const DEFAULT_AGENT_CONFIG_SERVER: McpServerConfig = {
  id: AGENT_CONFIG_SERVER_ID,
  command: 'npx',
  args: ['@event4u/agent-config', 'mcp'],
  env: {},
  enabled: true,
};

export interface AgentConfigToolResult {
  text: string;
  isError: boolean;
}

export class AgentConfigMcpClient {
  constructor(private readonly client: McpClient) {}

  /** `memory_lookup` — retrieve memories matching the given query / filters. */
  async memoryLookup(params: {
    query?: string;
    types?: string[];
    limit?: number;
  }): Promise<AgentConfigToolResult> {
    return this.call('memory_lookup', params);
  }

  /** `chat_history_read` — read prior session/chat-history entries. */
  async chatHistoryRead(
    params: { limit?: number; query?: string } = {},
  ): Promise<AgentConfigToolResult> {
    return this.call('chat_history_read', params);
  }

  /** `list_skills` — enumerate available skills. */
  async listSkills(params: { query?: string } = {}): Promise<AgentConfigToolResult> {
    return this.call('list_skills', params);
  }

  /** `skill_read` — load one skill's body by name. */
  async skillRead(name: string): Promise<AgentConfigToolResult> {
    return this.call('skill_read', { name });
  }

  /** `command_read` — load one command's procedure by name (feeds T-1103). */
  async commandRead(name: string): Promise<AgentConfigToolResult> {
    return this.call('command_read', { name });
  }

  private async call(tool: string, args: unknown): Promise<AgentConfigToolResult> {
    const result = await this.client.callTool(tool, args);
    return { text: contentToText(result.content), isError: result.isError };
  }
}
