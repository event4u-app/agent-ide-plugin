import {
  type MappedSession,
  type MessageMapper,
  type SessionMapper,
  loadJsonlMessages,
  scanJsonlSource,
} from '../jsonl-scan.js';
import { extractText, normalizeRole, toMillis } from '../parse-utils.js';
import type {
  NormalizedMessage,
  SessionAdapter,
  SessionListOptions,
  SessionRef,
  SessionScanResult,
} from '../types.js';

/**
 * Codex CLI adapter (T-1202).
 *
 * Session ("rollout") files live under `~/.codex/sessions/**\/*.jsonl`. The
 * format wraps records in a `payload` envelope: a leading
 * `{ type: "session_meta", payload: { id, timestamp, cwd, model? } }` line,
 * then `{ type: "response_item", payload: { type: "message", role, content } }`
 * records. Field names drift between releases, so this maps both the wrapped
 * and an un-wrapped shape and ignores anything it does not recognize.
 */
const PROVIDER = 'openai';

const jsonlMatch = (name: string): boolean => name.endsWith('.jsonl');

/** Return the `payload` envelope when present, else the record itself (drift tolerance). */
function unwrap(record: Record<string, unknown>): Record<string, unknown> {
  const payload = record.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : record;
}

/** Is this record a user/assistant message, and what role? */
function messageRole(
  record: Record<string, unknown>,
  body: Record<string, unknown>,
): 'user' | 'assistant' | undefined {
  const kind = asString(body.type) ?? asString(record.type);
  if (kind !== undefined && kind !== 'message' && kind !== 'response_item') {
    if (kind === 'user' || kind === 'assistant') return kind;
    return undefined;
  }
  const role = normalizeRole(body.role);
  return role === 'user' || role === 'assistant' ? role : undefined;
}

const mapSummary: SessionMapper = (records): MappedSession => {
  let nativeId: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let title: string | undefined;
  let startedAt: number | undefined;
  let lastMessageAt: number | undefined;
  let messageCount = 0;

  for (const record of records) {
    const body = unwrap(record);
    const ts = toMillis(record.timestamp ?? body.timestamp);
    if (ts !== undefined) {
      startedAt ??= ts;
      lastMessageAt = ts;
    }
    nativeId ??= asString(body.id) ?? asString(record.id);
    cwd ??= asString(body.cwd);
    model ??= asString(body.model);

    const role = messageRole(record, body);
    if (!role) continue;
    messageCount++;
    if (role === 'user' && title === undefined) {
      const text = extractText(body.content).trim();
      if (text.length > 0) title = text;
    }
  }

  return {
    nativeId,
    provider: PROVIDER,
    model,
    title,
    startedAt,
    lastMessageAt,
    messageCount,
    cwd,
  };
};

const mapMessages: MessageMapper = (records): NormalizedMessage[] => {
  const messages: NormalizedMessage[] = [];
  for (const record of records) {
    const body = unwrap(record);
    const role = messageRole(record, body);
    if (!role) continue;
    const content = extractText(body.content).trim();
    if (content.length === 0) continue;
    messages.push({ role, content, timestamp: toMillis(record.timestamp ?? body.timestamp) });
  }
  return messages;
};

export class CodexCliAdapter implements SessionAdapter {
  readonly source = 'codex-cli' as const;

  constructor(private readonly sessionsDir: string | undefined) {}

  listSummaries(options?: SessionListOptions, signal?: AbortSignal): Promise<SessionScanResult> {
    return scanJsonlSource({
      source: this.source,
      root: this.sessionsDir,
      provider: PROVIDER,
      match: jsonlMatch,
      mapper: mapSummary,
      options,
      signal,
    });
  }

  async loadMessages(ref: SessionRef, signal?: AbortSignal): Promise<NormalizedMessage[]> {
    if (!ref.rawFilePath) return [];
    return loadJsonlMessages(ref.rawFilePath, mapMessages, signal);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
