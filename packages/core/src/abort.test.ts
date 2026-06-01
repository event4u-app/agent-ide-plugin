import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAbortError, throwIfAborted } from './abort.js';
import { EmbeddingCache } from './context/embedding-cache.js';
import { FakeEmbedder, type Embedder } from './context/embedder.js';
import { RemoteEmbedder } from './context/remote-embedder.js';
import { McpClient } from './mcp/client.js';
import { FakeTransport, type FakeResult } from './mcp/fake-transport.js';
import { ClaudeCliAdapter } from './sessions/adapters/claude-cli.js';
import { SessionBrowser } from './sessions/aggregator.js';
import type {
  NormalizedMessage,
  SessionAdapter,
  SessionRef,
  SessionScanResult,
} from './sessions/types.js';

/**
 * T-1305 — cooperative cancellation reaches embedding, MCP tool calls, and
 * session scans, so the existing Stop (CancellationToken) is not limited to the
 * LLM stream. Every operation here is a plain Promise; the contract is that an
 * abort rejects with a standard AbortError.
 */

describe('abort helpers', () => {
  it('throwIfAborted is a no-op without a signal or when not aborted', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });

  it('throwIfAborted throws the signal reason once aborted', () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfAborted(ac.signal)).toThrow();
  });

  it('isAbortError recognises AbortError and ABORT_ERR, not ordinary errors', () => {
    const ac = new AbortController();
    ac.abort();
    try {
      ac.signal.throwIfAborted();
      throw new Error('unreachable');
    } catch (err) {
      expect(isAbortError(err)).toBe(true);
    }
    expect(isAbortError(Object.assign(new Error('x'), { code: 'ABORT_ERR' }))).toBe(true);
    expect(isAbortError(new Error('plain'))).toBe(false);
    expect(isAbortError('not an error')).toBe(false);
  });
});

describe('embedding cancellation', () => {
  it('FakeEmbedder rejects when the signal is already aborted', async () => {
    await expect(new FakeEmbedder(8).embed(['x'], AbortSignal.abort())).rejects.toThrow();
  });

  it('EmbeddingCache forwards the signal to the embedder on a cache miss', async () => {
    let seen: AbortSignal | undefined;
    const recording: Embedder = {
      modelId: 'rec',
      dimensions: 4,
      async embed(texts, signal) {
        seen = signal;
        return texts.map(() => new Float32Array(4));
      },
    };
    const cache = new EmbeddingCache(recording);
    const ac = new AbortController();
    await cache.embed(['miss'], ac.signal);
    expect(seen).toBe(ac.signal);
  });

  it('EmbeddingCache rejects before touching the embedder when pre-aborted', async () => {
    let called = false;
    const embedder: Embedder = {
      modelId: 'rec',
      dimensions: 4,
      async embed(texts) {
        called = true;
        return texts.map(() => new Float32Array(4));
      },
    };
    await expect(new EmbeddingCache(embedder).embed(['x'], AbortSignal.abort())).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('RemoteEmbedder passes the signal to fetch', async () => {
    let seen: AbortSignal | undefined;
    const fetchFn = async (_url: string, init: RequestInit): Promise<Response> => {
      seen = init.signal ?? undefined;
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
    };
    const embedder = new RemoteEmbedder(
      { provider: 'openai', apiKey: 'k', model: 'm', dimensions: 3 },
      fetchFn,
    );
    const ac = new AbortController();
    await embedder.embed(['hello'], ac.signal);
    expect(seen).toBe(ac.signal);
  });
});

describe('MCP call cancellation', () => {
  /** Responder that hangs on tools/call but answers everything else. */
  function hangingCall(req: { method: string }): FakeResult {
    switch (req.method) {
      case 'initialize':
        return { result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } } };
      case 'tools/list':
        return { result: { tools: [] } };
      case 'tools/call':
        return 'never';
      default:
        return { error: { code: -32601, message: `method not found: ${req.method}` } };
    }
  }

  it('aborts an in-flight tool call without killing the client', async () => {
    const transport = new FakeTransport({ respond: hangingCall });
    const client = new McpClient(transport);
    await client.connect();

    const ac = new AbortController();
    const pending = client.callTool('search', {}, ac.signal);
    ac.abort();
    await expect(pending).rejects.toThrow();

    // The client survives a request-scoped abort (council C1): it is still usable.
    expect(client.isInitialized).toBe(true);
    await expect(client.listTools()).resolves.toEqual([]);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const transport = new FakeTransport({ respond: hangingCall });
    const client = new McpClient(transport);
    await client.connect();
    const before = transport.sent.length;
    await expect(client.callTool('search', {}, AbortSignal.abort())).rejects.toThrow();
    // Pre-abort short-circuits before a request is sent.
    expect(transport.sent.length).toBe(before);
  });
});

describe('session scan cancellation', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'abort-sessions-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('claude adapter scan rejects when pre-aborted', async () => {
    await writeFile(join(dir, 'a.jsonl'), '{"type":"user","timestamp":"2024-01-01T00:00:00Z"}\n');
    const adapter = new ClaudeCliAdapter(dir);
    await expect(adapter.listSummaries(undefined, AbortSignal.abort())).rejects.toThrow();
  });

  it('SessionBrowser propagates an abort instead of degrading it to a diagnostic', async () => {
    const abortingAdapter: SessionAdapter = {
      source: 'api',
      async listSummaries(_options, signal): Promise<SessionScanResult> {
        signal?.throwIfAborted();
        return { summaries: [], diagnostics: [] };
      },
      async loadMessages(): Promise<NormalizedMessage[]> {
        return [];
      },
    };
    const browser = new SessionBrowser([abortingAdapter]);
    await expect(browser.listSummaries(undefined, AbortSignal.abort())).rejects.toThrow();
  });

  it('SessionBrowser still degrades a genuine adapter error to a diagnostic', async () => {
    const throwingAdapter: SessionAdapter = {
      source: 'api',
      async listSummaries(): Promise<SessionScanResult> {
        throw new Error('disk on fire');
      },
      async loadMessages(): Promise<NormalizedMessage[]> {
        return [];
      },
    };
    const browser = new SessionBrowser([throwingAdapter]);
    const result = await browser.listSummaries();
    expect(result.summaries).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('unreadable');
  });

  it('routes loadMessages through the matching adapter with the signal', async () => {
    let seen: AbortSignal | undefined;
    const ref: SessionRef = { source: 'api', id: 'api:1' };
    const adapter: SessionAdapter = {
      source: 'api',
      async listSummaries(): Promise<SessionScanResult> {
        return { summaries: [], diagnostics: [] };
      },
      async loadMessages(_ref, signal): Promise<NormalizedMessage[]> {
        seen = signal;
        return [];
      },
    };
    const ac = new AbortController();
    await new SessionBrowser([adapter]).loadMessages(ref, ac.signal);
    expect(seen).toBe(ac.signal);
  });
});
