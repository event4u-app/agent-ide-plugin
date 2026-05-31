import { readFile } from 'node:fs/promises';
import { throwIfAborted } from '../../abort.js';
import { LARGE_FILE_BYTES } from '../jsonl-scan.js';
import {
  clampTitle,
  degradedSummary,
  discoverFiles,
  extractText,
  makeSessionId,
  normalizeRole,
  parseJsonlLines,
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
  type SessionSummary,
} from '../types.js';

/**
 * Gemini CLI adapter (T-1202).
 *
 * Gemini's on-disk session format is proprietary and the least documented of
 * the sources (PLAN.md §9.13.1: "proprietär, Adapter nötig"). The adapter is
 * deliberately format-agnostic: it tries whole-file JSON, then JSONL, then
 * falls back to a stat-only degraded summary — so a format change downgrades
 * the listing rather than breaking the scan (council: "start with file-level
 * degraded summaries"). Gemini API messages use `role: "model"` and a `parts`
 * array, both handled here.
 */
const PROVIDER = 'google';

const match = (name: string): boolean => !name.startsWith('.');

/** Pull a message array out of the various container shapes Gemini might use. */
function toRecordArray(parsed: unknown): Record<string, unknown>[] {
  const container = (key: string): unknown =>
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[key]
      : undefined;
  const candidate = Array.isArray(parsed)
    ? parsed
    : (container('messages') ??
      container('history') ??
      container('turns') ??
      container('contents'));
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (m): m is Record<string, unknown> => m !== null && typeof m === 'object' && !Array.isArray(m),
  );
}

function topField(parsed: unknown, key: string): string | undefined {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

interface GeminiFields {
  title?: string;
  startedAt?: number;
  lastMessageAt?: number;
  messageCount: number;
}

function mapRecords(records: Record<string, unknown>[]): GeminiFields {
  let title: string | undefined;
  let startedAt: number | undefined;
  let lastMessageAt: number | undefined;
  let messageCount = 0;
  for (const record of records) {
    const role = normalizeRole(record.role);
    const ts = toMillis(record.timestamp ?? record.time);
    if (ts !== undefined) {
      startedAt ??= ts;
      lastMessageAt = ts;
    }
    if (role !== 'user' && role !== 'assistant') continue;
    messageCount++;
    if (role === 'user' && title === undefined) {
      const text = extractText(record.parts ?? record.content).trim();
      if (text.length > 0) title = text;
    }
  }
  return { title, startedAt, lastMessageAt, messageCount };
}

function recordsFrom(content: string): Record<string, unknown>[] {
  try {
    return toRecordArray(JSON.parse(content) as unknown);
  } catch {
    const { records } = parseJsonlLines(content);
    return records;
  }
}

export class GeminiCliAdapter implements SessionAdapter {
  readonly source = 'gemini-cli' as const;

  constructor(private readonly sessionsDir: string | undefined) {}

  async listSummaries(
    options?: SessionListOptions,
    signal?: AbortSignal,
  ): Promise<SessionScanResult> {
    throwIfAborted(signal);
    const diagnostics: SessionDiagnostic[] = [];
    if (!this.sessionsDir) {
      diagnostics.push({
        source: this.source,
        severity: 'info',
        code: 'location_missing',
        message: 'No gemini dir.',
      });
      return { summaries: [], diagnostics };
    }

    const limit = options?.limit ?? DEFAULT_SESSION_LIMIT;
    const files = (await discoverFiles(this.sessionsDir, match))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);

    const summaries: SessionSummary[] = [];
    for (const file of files) {
      throwIfAborted(signal);
      if (file.sizeBytes > LARGE_FILE_BYTES) {
        summaries.push(degradedSummary({ source: this.source, file, provider: PROVIDER }));
        diagnostics.push({
          source: this.source,
          filePath: file.path,
          severity: 'info',
          code: 'partial_parse',
          message: `File exceeds ${LARGE_FILE_BYTES} bytes; summarized from metadata only.`,
        });
        continue;
      }
      let content: string;
      try {
        content = await readFile(file.path, 'utf8');
      } catch {
        continue;
      }
      const records = recordsFrom(content);
      if (records.length === 0) {
        summaries.push(degradedSummary({ source: this.source, file, provider: PROVIDER }));
        diagnostics.push({
          source: this.source,
          filePath: file.path,
          severity: 'info',
          code: 'unsupported_format',
          message: `Unrecognized gemini session format at ${file.path}; metadata-only summary.`,
        });
        continue;
      }
      const fields = mapRecords(records);
      const whole = safeParse(content);
      const native = topField(whole, 'sessionId') ?? topField(whole, 'id') ?? stableHash(file.path);
      summaries.push({
        id: makeSessionId(this.source, native),
        source: this.source,
        origin: 'unknown',
        provider: PROVIDER,
        model: topField(whole, 'model'),
        title: clampTitle(fields.title, native),
        startedAt: fields.startedAt ?? file.birthtimeMs,
        lastMessageAt: fields.lastMessageAt ?? file.mtimeMs,
        messageCount: fields.messageCount,
        status: 'completed',
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
      const records = recordsFrom(await readFile(ref.rawFilePath, 'utf8'));
      return records
        .map((record) => ({
          role: normalizeRole(record.role),
          content: extractText(record.parts ?? record.content).trim(),
          timestamp: toMillis(record.timestamp ?? record.time),
        }))
        .filter((m) => m.content.length > 0 && (m.role === 'user' || m.role === 'assistant'));
    } catch {
      return [];
    }
  }
}

function safeParse(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}
