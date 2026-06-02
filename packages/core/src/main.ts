import { join } from 'node:path';
import { Logger, NdjsonParser, encodeEnvelope } from '@event4u-agent/shared';
import { loadSettings } from './config/agent-settings.js';
import type { EmbeddingsConfig } from './context/remote-embedder.js';
import { buildCoreDispatcher } from './sidecar.js';

/**
 * Best-effort read of `<cwd>/.agent-settings.yml :: context.embeddings`
 * (T-806 wiring, ADR-044). This is the FIRST live caller of `loadSettings` —
 * the only settings key the sidecar reads at boot today. Fail-soft on every
 * error (missing file already returns defaults; a malformed file is caught and
 * logged) so a bad settings file degrades to BM25-only retrieval, never a boot
 * failure. The `apiKey` stays in this process and never crosses the wire.
 */
async function resolveEmbeddings(cwd: string, log: Logger): Promise<EmbeddingsConfig | undefined> {
  try {
    const settings = await loadSettings(join(cwd, '.agent-settings.yml'));
    const embeddings = settings.context.embeddings;
    return embeddings.provider ? embeddings : undefined;
  } catch (error) {
    log.warn('failed to load .agent-settings.yml; continuing BM25-only', { error: String(error) });
    return undefined;
  }
}

/**
 * Sidecar entrypoint. Reads NDJSON request envelopes from stdin, dispatches
 * each one, and writes the response envelope to stdout. stdout carries
 * nothing but envelopes; all diagnostics go to stderr via {@link Logger}.
 */
async function main(): Promise<void> {
  const log = new Logger('core', 'info');
  // Resolve the embeddings config BEFORE attaching the stdin reader — Node keeps
  // stdin paused until the first `data` listener, so no request bytes are lost
  // during the await.
  const embeddings = await resolveEmbeddings(process.cwd(), log);
  // Composition root: wire a real ChatHandler (provider registry + on-disk
  // conversation store) so `chatSend` works instead of `chat_not_configured`.
  const dispatcher = buildCoreDispatcher(embeddings ? { embeddings } : {});

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

void main();
