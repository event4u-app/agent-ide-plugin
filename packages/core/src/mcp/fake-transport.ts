import { JSONRPC_VERSION, type JsonRpcMessage, type JsonRpcRequest } from './protocol.js';
import type { McpTransport } from './transport.js';

/**
 * Deterministic in-memory {@link McpTransport} for unit tests — no subprocess.
 *
 * A `respond` callback maps each inbound request to a result (or an error /
 * "never" to simulate a hang). Notifications (no `id`) are recorded in
 * {@link FakeTransport.notifications} and never answered.
 */
export type FakeResult =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } }
  | 'never';

export interface FakeTransportOptions {
  respond?: (request: JsonRpcRequest) => FakeResult | Promise<FakeResult>;
  /** When set, `start()` rejects with this error (spawn-failure simulation). */
  startError?: Error;
}

export class FakeTransport implements McpTransport {
  readonly sent: JsonRpcRequest[] = [];
  readonly notifications: JsonRpcRequest[] = [];
  private messageHandler?: (message: Record<string, unknown>) => void;
  private closeHandler?: (error?: Error) => void;
  private started = false;
  private closed = false;

  constructor(private readonly opts: FakeTransportOptions = {}) {}

  async start(): Promise<void> {
    if (this.opts.startError) throw this.opts.startError;
    this.started = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.started || this.closed) throw new Error('fake transport not live');
    const req = message as JsonRpcRequest;
    if (req.id === undefined) {
      this.notifications.push(req);
      return;
    }
    this.sent.push(req);
    const responder = this.opts.respond;
    const outcome: FakeResult = responder ? await responder(req) : { result: {} };
    if (outcome === 'never') return; // simulate a hung server
    // Deliver the response on the next tick, mirroring async stdio delivery.
    queueMicrotask(() => {
      if (this.closed) return;
      if ('error' in outcome) {
        this.messageHandler?.({
          jsonrpc: JSONRPC_VERSION,
          id: req.id ?? null,
          error: outcome.error,
        });
      } else {
        this.messageHandler?.({
          jsonrpc: JSONRPC_VERSION,
          id: req.id ?? null,
          result: outcome.result,
        });
      }
    });
  }

  onMessage(handler: (message: Record<string, unknown>) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test helper: simulate the server dying mid-session. */
  simulateExit(error?: Error): void {
    this.closed = true;
    this.closeHandler?.(error);
  }
}
