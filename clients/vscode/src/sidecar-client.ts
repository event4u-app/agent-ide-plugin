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
  private readonly pending = new Map<string, (envelope: Envelope) => void>();
  private parser: NdjsonParser | undefined;

  /** node executable used to run the sidecar (override in tests). */
  constructor(
    private readonly serverPath: string,
    private readonly nodePath: string = process.execPath,
  ) {}

  start(): void {
    if (this.child) return;
    const child = spawn(this.nodePath, [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.parser = new NdjsonParser((envelope) => {
      const resolve = this.pending.get(envelope.messageId);
      if (resolve) {
        this.pending.delete(envelope.messageId);
        resolve(envelope);
      }
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.parser?.push(chunk));
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
  }
}
