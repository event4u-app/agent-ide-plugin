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
 * Claude Code CLI adapter (T-1202).
 *
 * Session files live under `~/.claude/projects/<encoded-cwd>/**\/*.jsonl`. Each
 * line is one record; the shapes this maps are `type: "user" | "assistant"`
 * carrying `message: { role, content, model?, usage? }` plus a top-level
 * `timestamp`, `cwd`, and `sessionId`. Everything is read defensively — the
 * format drifts, so unknown fields are ignored and bad lines are skipped
 * upstream in {@link scanJsonlSource}.
 */
const PROVIDER = 'anthropic';

const jsonlMatch = (name: string): boolean => name.endsWith('.jsonl');

const mapSummary: SessionMapper = (records): MappedSession => {
  let nativeId: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let title: string | undefined;
  let startedAt: number | undefined;
  let lastMessageAt: number | undefined;
  let messageCount = 0;
  let totalTokens = 0;
  let sawTokens = false;

  for (const record of records) {
    const ts = toMillis(record.timestamp);
    if (ts !== undefined) {
      startedAt ??= ts;
      lastMessageAt = ts;
    }
    nativeId ??= asString(record.sessionId);
    cwd ??= asString(record.cwd);

    const type = asString(record.type);
    if (type !== 'user' && type !== 'assistant') continue;
    messageCount++;

    const message = asRecord(record.message);
    if (!message) continue;
    if (type === 'assistant') {
      model ??= asString(message.model);
      const usage = asRecord(message.usage);
      if (usage) {
        const input = asNumber(usage.input_tokens) ?? 0;
        const output = asNumber(usage.output_tokens) ?? 0;
        if (input || output) {
          totalTokens += input + output;
          sawTokens = true;
        }
      }
    }
    if (type === 'user' && title === undefined) {
      const text = extractText(message.content).trim();
      if (text.length > 0 && !text.startsWith('<')) title = text;
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
    totalTokens: sawTokens ? totalTokens : undefined,
    cwd,
  };
};

const mapMessages: MessageMapper = (records): NormalizedMessage[] => {
  const messages: NormalizedMessage[] = [];
  for (const record of records) {
    const type = asString(record.type);
    if (type !== 'user' && type !== 'assistant') continue;
    const message = asRecord(record.message);
    if (!message) continue;
    const content = extractText(message.content).trim();
    if (content.length === 0) continue;
    messages.push({
      role: normalizeRole(message.role ?? type),
      content,
      timestamp: toMillis(record.timestamp),
    });
  }
  return messages;
};

export class ClaudeCliAdapter implements SessionAdapter {
  readonly source = 'claude-cli' as const;

  constructor(private readonly projectsDir: string | undefined) {}

  listSummaries(options?: SessionListOptions): Promise<SessionScanResult> {
    return scanJsonlSource({
      source: this.source,
      root: this.projectsDir,
      provider: PROVIDER,
      match: jsonlMatch,
      mapper: mapSummary,
      options,
    });
  }

  async loadMessages(ref: SessionRef): Promise<NormalizedMessage[]> {
    if (!ref.rawFilePath) return [];
    return loadJsonlMessages(ref.rawFilePath, mapMessages);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
