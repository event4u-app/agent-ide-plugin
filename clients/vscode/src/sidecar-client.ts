import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Envelope } from '@event4u-agent/protocol';
import { NdjsonParser, encodeEnvelope } from '@event4u-agent/shared';

/**
 * Spawns the Node Agent Core sidecar and exposes request/response calls over
 * its NDJSON stdio channel. Correlation is by `messageId`, per the protocol.
 *
 * Transport only — no VS Code API here, so it is unit-testable against the
 * real built sidecar without an Extension Host.
 */
export class SidecarClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  /** One-shot request/response correlations — deleted on the first reply. */
  private readonly pending = new Map<string, (envelope: Envelope) => void>();
  /**
   * Streaming correlations — invoked for EVERY envelope of a `messageId` and
   * self-deleting on the terminal `done:true`. Checked before {@link pending}
   * so a streamed `done:false` token never consumes the one-shot path.
   */
  private readonly streaming = new Map<string, (envelope: Envelope) => void>();
  private parser: NdjsonParser | undefined;

  /** node executable used to run the sidecar (override in tests). */
  constructor(
    private readonly serverPath: string,
    private readonly nodePath: string = process.execPath,
    /** Extra env for the spawned sidecar (e.g. ANTHROPIC_API_KEY); merged over `process.env`. */
    private readonly env: NodeJS.ProcessEnv = {},
  ) {}

  start(): void {
    if (this.child) return;
    const child = spawn(this.nodePath, [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // `nodePath` defaults to `process.execPath`. In a packaged `.vsix` that is
      // the VS Code / Electron binary, which would LAUNCH A WINDOW when handed a
      // script arg — unless `ELECTRON_RUN_AS_NODE=1` tells it to behave as plain
      // Node. Real Node ignores the var, so the dev path and unit tests are
      // unaffected (AI council 2026-05-31, UNANIMOUS Fork 1A; ADR-017).
      env: { ELECTRON_RUN_AS_NODE: '1', ...process.env, ...this.env },
    });
    this.child = child;
    this.parser = new NdjsonParser((envelope) => {
      const stream = this.streaming.get(envelope.messageId);
      if (stream) {
        stream(envelope);
        return;
      }
      const resolve = this.pending.get(envelope.messageId);
      if (resolve) {
        this.pending.delete(envelope.messageId);
        resolve(envelope);
      }
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.parser?.push(chunk));

    // Surface the sidecar's own diagnostics. Without this the child's stderr
    // (startup banner, crashes, a failed `ELECTRON_RUN_AS_NODE` spawn) is piped
    // but never read, so a sidecar that never answers shows only a client-side
    // request/stream timeout with no cause. These land in the Extension Host
    // Developer Tools console.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => console.error(`[sidecar] ${chunk.trimEnd()}`));
    child.on('error', (err) => console.error('[sidecar] failed to spawn:', err));
    child.on('exit', (code, signal) =>
      console.error(`[sidecar] process exited (code=${code}, signal=${signal})`),
    );
  }

  /** Send a request envelope and resolve with the correlated response. */
  request(messageType: string, data: unknown, timeoutMs = 5000): Promise<Envelope> {
    if (!this.child) throw new Error('sidecar not started');
    const messageId = randomUUID();
    const envelope: Envelope = { messageId, messageType, data, done: true };

    return new Promise<Envelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`sidecar request timed out: ${messageType}`));
      }, timeoutMs);

      this.pending.set(messageId, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      this.child!.stdin.write(encodeEnvelope(envelope));
    });
  }

  /**
   * Send a streaming request. `onToken` fires for each intermediate
   * `done:false` envelope; the promise resolves with the terminal `done:true`
   * envelope. Used by `chatSend`, whose tokens arrive as `done:false` frames.
   */
  requestStream(
    messageType: string,
    data: unknown,
    onToken: (envelope: Envelope) => void,
    timeoutMs = 120_000,
  ): Promise<Envelope> {
    if (!this.child) throw new Error('sidecar not started');
    const messageId = randomUUID();
    const envelope: Envelope = { messageId, messageType, data, done: true };

    return new Promise<Envelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.streaming.delete(messageId);
        reject(new Error(`sidecar stream timed out: ${messageType}`));
      }, timeoutMs);

      this.streaming.set(messageId, (frame) => {
        if (frame.done) {
          clearTimeout(timer);
          this.streaming.delete(messageId);
          resolve(frame);
        } else {
          onToken(frame);
        }
      });

      this.child!.stdin.write(encodeEnvelope(envelope));
    });
  }

  /** Convenience: ping the sidecar, returns true on a `pong` reply. */
  async healthy(): Promise<boolean> {
    const res = await this.request('ping', {});
    return (
      res.messageType === 'ping' &&
      typeof res.data === 'object' &&
      res.data !== null &&
      (res.data as { result?: string }).result === 'pong'
    );
  }

  dispose(): void {
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.pending.clear();
    this.streaming.clear();
  }
}
