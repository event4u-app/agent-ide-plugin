/**
 * Minimal structured logger that writes to stderr only.
 *
 * The sidecar's stdout is the NDJSON data channel — nothing but envelopes
 * may be written there, or the client-side parser breaks. All diagnostics
 * go to stderr.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  private write(level: LogLevel, message: string, extra?: unknown): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const line = `[${level}] [${this.scope}] ${message}`;
    if (extra !== undefined) {
      process.stderr.write(`${line} ${JSON.stringify(extra)}\n`);
    } else {
      process.stderr.write(`${line}\n`);
    }
  }

  debug(message: string, extra?: unknown): void {
    this.write('debug', message, extra);
  }
  info(message: string, extra?: unknown): void {
    this.write('info', message, extra);
  }
  warn(message: string, extra?: unknown): void {
    this.write('warn', message, extra);
  }
  error(message: string, extra?: unknown): void {
    this.write('error', message, extra);
  }
}
