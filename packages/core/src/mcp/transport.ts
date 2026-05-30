import { spawn, type ChildProcess } from 'node:child_process';
import { readNdjson } from '../llm/ndjson.js';
import type { JsonRpcMessage } from './protocol.js';

/**
 * T-1101 — MCP transport seam.
 *
 * The {@link McpClient} talks to a server through this interface only, so unit
 * tests inject a {@link FakeTransport} and never spawn a subprocess. The real
 * implementation ({@link StdioTransport}) frames JSON-RPC messages as
 * newline-delimited JSON over the child's stdio.
 */
export interface McpTransport {
  /** Begin delivering messages. Resolves once the underlying channel is live. */
  start(): Promise<void>;
  /** Write one JSON-RPC request or notification to the server. */
  send(message: JsonRpcMessage): Promise<void>;
  /** Register the inbound-message sink. Called once by the client. */
  onMessage(handler: (message: Record<string, unknown>) => void): void;
  /** Register the close/error sink. Fires once. */
  onClose(handler: (error?: Error) => void): void;
  /** Tear the channel down. Idempotent. */
  close(): Promise<void>;
}

export interface StdioTransportOptions {
  command: string;
  args?: readonly string[];
  /** Extra environment for the child. Merged over `process.env`. */
  env?: Record<string, string>;
  /** Working directory for the child. Defaults to the current process cwd. */
  cwd?: string;
}

export class McpTransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'McpTransportError';
  }
}

/**
 * Spawns an MCP server as a subprocess and frames JSON-RPC over its stdio.
 * stderr is captured but not parsed — MCP servers commonly log there.
 */
export class StdioTransport implements McpTransport {
  private child?: ChildProcess;
  private messageHandler?: (message: Record<string, unknown>) => void;
  private closeHandler?: (error?: Error) => void;
  private closed = false;

  constructor(private readonly opts: StdioTransportOptions) {}

  async start(): Promise<void> {
    const child = spawn(this.opts.command, [...(this.opts.args ?? [])], {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.on('error', (err) => this.fail(new McpTransportError('mcp server spawn failed', err)));
    child.on('exit', (code, signal) => {
      if (this.closed) return;
      this.fail(
        new McpTransportError(
          `mcp server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
        ),
      );
    });

    if (!child.stdout) {
      throw new McpTransportError('mcp server has no stdout');
    }

    // Drain stdout as NDJSON. The async generator resolves when the stream
    // ends; any leftover line is handled by readNdjson's tail logic.
    void (async () => {
      try {
        for await (const obj of readNdjson(child.stdout!)) {
          this.messageHandler?.(obj);
        }
      } catch (err) {
        this.fail(new McpTransportError('mcp stdout read error', err));
      }
    })();
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || this.closed) {
      throw new McpTransportError('mcp transport not started or already closed');
    }
    await new Promise<void>((resolveWrite, rejectWrite) => {
      stdin.write(`${JSON.stringify(message)}\n`, (err) =>
        err ? rejectWrite(new McpTransportError('mcp stdin write failed', err)) : resolveWrite(),
      );
    });
  }

  onMessage(handler: (message: Record<string, unknown>) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    // Close stdin first (graceful), then SIGTERM, then SIGKILL after a beat.
    child.stdin?.end();
    child.kill('SIGTERM');
    await new Promise<void>((resolveClose) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        resolveClose();
      }, 1000);
      // Avoid keeping the event loop alive solely for the kill timer.
      if (typeof killTimer.unref === 'function') killTimer.unref();
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolveClose();
      });
    });
  }

  private fail(error: Error): void {
    const handler = this.closeHandler;
    this.closeHandler = undefined;
    handler?.(error);
  }
}
