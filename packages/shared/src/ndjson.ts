import { type Envelope, EnvelopeSchema } from '@event4u-agent/protocol';

/** Serialize an envelope to a single NDJSON line (newline included). */
export function encodeEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope) + '\n';
}

/**
 * Incremental NDJSON line parser. Feed it arbitrary chunks (which may split
 * a line across boundaries); it emits one validated {@link Envelope} per
 * complete line. Malformed lines are reported via {@link onError} rather
 * than throwing, so a single bad line never kills the stdio loop.
 */
export class NdjsonParser {
  private buffer = '';

  constructor(
    private readonly onEnvelope: (envelope: Envelope) => void,
    private readonly onError?: (line: string, error: unknown) => void,
  ) {}

  /** Push a raw chunk of bytes/text from the transport. */
  push(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;
    try {
      this.onEnvelope(EnvelopeSchema.parse(JSON.parse(trimmed)));
    } catch (error) {
      this.onError?.(line, error);
    }
  }
}
