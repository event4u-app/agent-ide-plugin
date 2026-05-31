import { Logger, NdjsonParser, encodeEnvelope } from '@event4u-agent/shared';
import { Dispatcher } from './server.js';

/**
 * Sidecar entrypoint. Reads NDJSON request envelopes from stdin, dispatches
 * each one, and writes the response envelope to stdout. stdout carries
 * nothing but envelopes; all diagnostics go to stderr via {@link Logger}.
 */
function main(): void {
  const log = new Logger('core', 'info');
  const dispatcher = new Dispatcher();

  const parser = new NdjsonParser(
    (envelope) => {
      // For streaming methods the dispatcher pushes `done:false` token
      // envelopes through `emit`; every method resolves with exactly one
      // terminal envelope, so a streaming client always sees the stream close.
      const emit = (e: typeof envelope): void => {
        process.stdout.write(encodeEnvelope(e));
      };
      void dispatcher.dispatch(envelope, emit).then((response) => {
        process.stdout.write(encodeEnvelope(response));
      });
    },
    (line, error) => {
      log.warn('dropped malformed line', { line, error: String(error) });
    },
  );

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => parser.push(chunk));
  process.stdin.on('end', () => {
    log.info('stdin closed, exiting');
    dispatcher.dispose();
    process.exit(0);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info(`received ${signal}, exiting`);
      dispatcher.dispose();
      process.exit(0);
    });
  }

  log.info('agent core ready (ndjson over stdio)');
}

main();
