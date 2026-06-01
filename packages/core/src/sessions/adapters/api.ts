import { readFile } from 'node:fs/promises';
import { throwIfAborted } from '../../abort.js';
import {
  clampTitle,
  degradedSummary,
  discoverFiles,
  extractText,
  makeSessionId,
  normalizeRole,
  stableHash,
  toMillis,
} from '../parse-utils.js';
import {
  DEFAULT_SESSION_LIMIT,
  type NormalizedMessage,
  type SessionAdapter,
  type SessionDiagnostic,
  type SessionListOptions,
  type SessionRef,
  type SessionScanResult,
  type SessionStatus,
  type SessionSummary,
} from '../types.js';

/**
 * Plugin API-session adapter (T-1202).
 *
 * The plugin's own conversations are persisted one-JSON-per-file under
 * `<workspace>/.event4u-agent/chats/<id>.json` (the store itself lands with
 * T-1301; this adapter reads a forward-compatible shape defensively so it is
 * already wired when persistence arrives). These are always `origin: "plugin"`.
 */
const STATUSES = new Set<SessionStatus>(['active', 'completed', 'interrupted', 'unknown']);

const jsonMatch = (name: string): boolean => name.endsWith('.json');

interface ApiChatFile {
  id?: unknown;
  provider?: unknown;
  model?: unknown;
  title?: unknown;
  createdAt?: unknown;
  startedAt?: unknown;
  cwd?: unknown;
  status?: unknown;
  totalCostUsd?: unknown;
  totalTokens?: unknown;
  messages?: unknown;
}

export class ApiSessionAdapter implements SessionAdapter {
  readonly source = 'api' as const;

  constructor(private readonly chatsDir: string | undefined) {}

  async listSummaries(
    options?: SessionListOptions,
    signal?: AbortSignal,
  ): Promise<SessionScanResult> {
    throwIfAborted(signal);
    const diagnostics: SessionDiagnostic[] = [];
    if (!this.chatsDir) {
      diagnostics.push({
        source: this.source,
        severity: 'info',
        code: 'location_missing',
        message: 'No chats dir.',
      });
      return { summaries: [], diagnostics };
    }

    const limit = options?.limit ?? DEFAULT_SESSION_LIMIT;
    const files = (await discoverFiles(this.chatsDir, jsonMatch, 1))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);

    const summaries: SessionSummary[] = [];
    for (const file of files) {
      throwIfAborted(signal);
      let parsed: ApiChatFile | undefined;
      try {
        parsed = JSON.parse(await readFile(file.path, 'utf8')) as ApiChatFile;
      } catch (error) {
        diagnostics.push({
          source: this.source,
          filePath: file.path,
          severity: 'warning',
          code: 'parse_failed',
          message: `Could not parse ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
        });
        summaries.push({
          ...degradedSummary({ source: this.source, file, provider: 'unknown' }),
          origin: 'plugin',
        });
        continue;
      }

      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const firstUser = messages
        .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : undefined))
        .find((m) => m && normalizeRole(m.role) === 'user');
      const startedAt = toMillis(parsed.startedAt ?? parsed.createdAt) ?? file.birthtimeMs;
      const lastTs = messages
        .map((m) =>
          m && typeof m === 'object'
            ? toMillis((m as Record<string, unknown>).timestamp)
            : undefined,
        )
        .filter((t): t is number => t !== undefined);
      const native = asString(parsed.id) ?? stableHash(file.path);

      summaries.push({
        id: makeSessionId(this.source, native),
        source: this.source,
        origin: 'plugin',
        provider: asString(parsed.provider) ?? 'unknown',
        model: asString(parsed.model),
        title: clampTitle(
          asString(parsed.title) ?? (firstUser ? extractText(firstUser.content) : undefined),
          native,
        ),
        startedAt,
        lastMessageAt: lastTs.length > 0 ? Math.max(...lastTs) : file.mtimeMs,
        messageCount: messages.length,
        totalCostUsd: asNumber(parsed.totalCostUsd),
        totalTokens: asNumber(parsed.totalTokens),
        cwd: asString(parsed.cwd),
        status: asStatus(parsed.status),
        rawFilePath: file.path,
      });
    }

    const filtered =
      options?.since === undefined
        ? summaries
        : summaries.filter((s) => s.lastMessageAt >= options.since!);
    return { summaries: filtered, diagnostics };
  }

  async loadMessages(ref: SessionRef, signal?: AbortSignal): Promise<NormalizedMessage[]> {
    if (!ref.rawFilePath) return [];
    throwIfAborted(signal);
    try {
      const parsed = JSON.parse(await readFile(ref.rawFilePath, 'utf8')) as ApiChatFile;
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      return messages
        .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : undefined))
        .filter((m): m is Record<string, unknown> => m !== undefined)
        .map((m) => ({
          role: normalizeRole(m.role),
          content: extractText(m.content).trim(),
          timestamp: toMillis(m.timestamp),
        }))
        .filter((m) => m.content.length > 0);
    } catch {
      return [];
    }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStatus(value: unknown): SessionStatus {
  return typeof value === 'string' && STATUSES.has(value as SessionStatus)
    ? (value as SessionStatus)
    : 'completed';
}
