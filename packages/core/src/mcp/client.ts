import {
  CallToolResultSchema,
  InitializeResultSchema,
  JSONRPC_VERSION,
  ListToolsResultSchema,
  MCP_PROTOCOL_VERSION,
  isJsonRpcResponse,
  type CallToolResult,
  type InitializeResult,
  type JsonRpcResponse,
  type McpTool,
} from './protocol.js';
import type { McpTransport } from './transport.js';

/**
 * T-1101 — minimal MCP client over an injectable {@link McpTransport}.
 *
 * Drives the three methods the plugin needs (`initialize`, `tools/list`,
 * `tools/call`), correlates JSON-RPC responses by id, and bounds every wait
 * with a timeout so a hung server can never pin the agent loop (Q4 of the
 * Phase 11 council). Fail-open: a transport close rejects all in-flight
 * requests with {@link McpClientError} and marks the client dead.
 */

export interface McpClientOptions {
  /** Max wait for the `initialize` handshake. Default 5s. */
  initTimeoutMs?: number;
  /** Max wait for any `tools/list` / `tools/call` request. Default 30s. */
  requestTimeoutMs?: number;
  /** Advertised client identity in the handshake. */
  clientInfo?: { name: string; version: string };
}

const DEFAULT_INIT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class McpClientError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'McpClientError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private initialized = false;
  private dead?: Error;
  private readonly initTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly clientInfo: { name: string; version: string };

  constructor(
    private readonly transport: McpTransport,
    opts: McpClientOptions = {},
  ) {
    this.initTimeoutMs = opts.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientInfo = opts.clientInfo ?? { name: 'event4u-agent', version: '0.0.0' };
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onClose((err) => this.handleClose(err));
  }

  /** Run the start + `initialize` + `notifications/initialized` handshake. */
  async connect(): Promise<InitializeResult> {
    await this.transport.start();
    const raw = await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: this.clientInfo,
      },
      this.initTimeoutMs,
    );
    const parsed = InitializeResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new McpClientError('mcp initialize result malformed', parsed.error);
    }
    // Per spec, confirm readiness with an initialized notification.
    await this.notify('notifications/initialized');
    this.initialized = true;
    return parsed.data;
  }

  get isInitialized(): boolean {
    return this.initialized && this.dead === undefined;
  }

  async listTools(): Promise<McpTool[]> {
    const raw = await this.request('tools/list', {}, this.requestTimeoutMs);
    const parsed = ListToolsResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new McpClientError('mcp tools/list result malformed', parsed.error);
    }
    return parsed.data.tools;
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const raw = await this.request(
      'tools/call',
      { name, arguments: args ?? {} },
      this.requestTimeoutMs,
    );
    const parsed = CallToolResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new McpClientError('mcp tools/call result malformed', parsed.error);
    }
    return parsed.data;
  }

  async close(): Promise<void> {
    this.markDead(new McpClientError('mcp client closed'));
    await this.transport.close();
  }

  private async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.dead) throw new McpClientError(`mcp client is dead: ${this.dead.message}`, this.dead);
    const id = this.nextId++;
    const message = { jsonrpc: JSONRPC_VERSION as typeof JSONRPC_VERSION, id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpClientError(`mcp request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(message).catch((err) => {
        const slot = this.pending.get(id);
        if (!slot) return;
        clearTimeout(slot.timer);
        this.pending.delete(id);
        reject(new McpClientError(`mcp request '${method}' send failed`, err));
      });
    });
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: JSONRPC_VERSION, method, params });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (!isJsonRpcResponse(msg)) return; // server-initiated requests/notifications: ignored in v0
    const response = msg as unknown as JsonRpcResponse;
    if (typeof response.id !== 'number') return;
    const slot = this.pending.get(response.id);
    if (!slot) return;
    clearTimeout(slot.timer);
    this.pending.delete(response.id);
    if (response.error) {
      slot.reject(
        new McpClientError(`mcp error ${response.error.code}: ${response.error.message}`),
      );
      return;
    }
    slot.resolve(response.result);
  }

  private handleClose(error?: Error): void {
    this.markDead(error ?? new McpClientError('mcp transport closed'));
  }

  private markDead(error: Error): void {
    if (this.dead) return;
    this.dead = error;
    this.initialized = false;
    for (const [, slot] of this.pending) {
      clearTimeout(slot.timer);
      slot.reject(error);
    }
    this.pending.clear();
  }
}
