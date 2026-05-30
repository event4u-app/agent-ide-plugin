import type { McpServerConfig } from '../config/agent-settings.js';
import { McpClient } from './client.js';
import { McpToolRegistry } from './registry.js';
import { StdioTransport, type McpTransport } from './transport.js';

/**
 * T-1101 — spawns and connects every configured MCP server, fail-open.
 *
 * Each server is connected independently: one server that hangs on init or
 * dies on spawn is recorded as degraded and skipped, never blocking the others
 * or the sidecar (Q4 of the Phase 11 council). The transport factory is
 * injectable so unit tests connect {@link FakeTransport}s instead of spawning.
 */

export type TransportFactory = (config: McpServerConfig) => McpTransport;

export interface McpManagerOptions {
  /** Working directory passed to spawned servers. Defaults to process cwd. */
  cwd?: string;
  /** Override the transport for tests. Defaults to {@link StdioTransport}. */
  transportFactory?: TransportFactory;
  /** Advertised client identity. */
  clientInfo?: { name: string; version: string };
}

export interface ServerConnectResult {
  id: string;
  ok: boolean;
  toolCount: number;
  /** Reason the server was skipped, when `ok` is false. */
  error?: string;
}

export interface McpConnectSummary {
  registry: McpToolRegistry;
  results: ServerConnectResult[];
}

function defaultTransportFactory(cwd?: string): TransportFactory {
  return (config) =>
    new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd,
    });
}

export class McpManager {
  private readonly registry = new McpToolRegistry();
  private readonly clients = new Map<string, McpClient>();
  private readonly transportFactory: TransportFactory;
  private readonly clientInfo?: { name: string; version: string };

  constructor(opts: McpManagerOptions = {}) {
    this.transportFactory = opts.transportFactory ?? defaultTransportFactory(opts.cwd);
    this.clientInfo = opts.clientInfo;
  }

  get tools() {
    return this.registry;
  }

  /** Look up a live client by server id (T-1102/T-1105 consume this). */
  client(serverId: string): McpClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * Connect every enabled server. Disabled servers are skipped silently;
   * connection failures are captured per-server and never thrown.
   */
  async connectAll(servers: readonly McpServerConfig[]): Promise<McpConnectSummary> {
    const results: ServerConnectResult[] = [];
    for (const config of servers) {
      if (!config.enabled) {
        results.push({ id: config.id, ok: false, toolCount: 0, error: 'disabled' });
        continue;
      }
      results.push(await this.connectOne(config));
    }
    return { registry: this.registry, results };
  }

  private async connectOne(config: McpServerConfig): Promise<ServerConnectResult> {
    const transport = this.transportFactory(config);
    const client = new McpClient(transport, {
      initTimeoutMs: config.init_timeout_ms,
      requestTimeoutMs: config.request_timeout_ms,
      clientInfo: this.clientInfo,
    });
    try {
      await client.connect();
      const tools = await client.listTools();
      this.registry.register(config.id, client, tools);
      this.clients.set(config.id, client);
      return { id: config.id, ok: true, toolCount: tools.length };
    } catch (err) {
      // Fail-open: tear the half-open client down and move on.
      await client.close().catch(() => undefined);
      return {
        id: config.id,
        ok: false,
        toolCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Close every connected server. Idempotent. */
  async dispose(): Promise<void> {
    const closes = [...this.clients.values()].map((c) => c.close().catch(() => undefined));
    this.clients.clear();
    for (const id of this.registry.serverIds) this.registry.unregister(id);
    await Promise.all(closes);
  }
}
