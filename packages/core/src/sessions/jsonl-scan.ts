import { readFile } from 'node:fs/promises';
import {
  type DiscoveredFile,
  clampTitle,
  degradedSummary,
  discoverFiles,
  makeSessionId,
  parseJsonlLines,
  stableHash,
} from './parse-utils.js';
import {
  DEFAULT_SESSION_LIMIT,
  type NormalizedMessage,
  type SessionDiagnostic,
  type SessionListOptions,
  type SessionScanResult,
  type SessionSource,
  type SessionSummary,
} from './types.js';

/** Files larger than this get a degraded (stat-only) summary instead of a full parse. */
export const LARGE_FILE_BYTES = 16 * 1024 * 1024;

/** Fields a per-CLI mapper extracts from the parsed JSONL records of one session file. */
export interface MappedSession {
  /** CLI-native session id; falls back to a path hash when absent. */
  nativeId?: string;
  provider: string;
  model?: string;
  /** First user message (clamped by the scanner). */
  title?: string;
  startedAt?: number;
  lastMessageAt?: number;
  messageCount: number;
  totalTokens?: number;
  totalCostUsd?: number;
  cwd?: string;
}

/** Maps the parsed records of a single session file into normalized summary fields. */
export type SessionMapper = (records: Record<string, unknown>[]) => MappedSession;

/** Maps the parsed records of a single session file into normalized messages (resume/preview). */
export type MessageMapper = (records: Record<string, unknown>[]) => NormalizedMessage[];

/**
 * Shared scan mechanics for the JSONL-backed CLI sources (claude, codex).
 *
 * The *mechanics* are shared (discover → sort-by-recency → cap → read →
 * map → degrade-on-failure → collect diagnostics); the per-CLI *mapping* is
 * injected and stays independently disposable, so one CLI changing its format
 * cannot break the other (council, 2026-05-30).
 */
export async function scanJsonlSource(args: {
  source: SessionSource;
  root: string | undefined;
  provider: string;
  match: (name: string) => boolean;
  mapper: SessionMapper;
  options?: SessionListOptions;
}): Promise<SessionScanResult> {
  const { source, root, provider, match, mapper, options } = args;
  const diagnostics: SessionDiagnostic[] = [];

  if (!root) {
    diagnostics.push({
      source,
      severity: 'info',
      code: 'location_missing',
      message: `No configured location for ${source}.`,
    });
    return { summaries: [], diagnostics };
  }

  const limit = options?.limit ?? DEFAULT_SESSION_LIMIT;
  const files = (await discoverFiles(root, match))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    if (file.sizeBytes > LARGE_FILE_BYTES) {
      summaries.push(degradedSummary({ source, file, provider }));
      diagnostics.push({
        source,
        filePath: file.path,
        severity: 'info',
        code: 'partial_parse',
        message: `File exceeds ${LARGE_FILE_BYTES} bytes; summarized from file metadata only.`,
      });
      continue;
    }
    const summary = await summarizeFile({ source, provider, file, mapper, diagnostics });
    if (summary) summaries.push(summary);
  }

  return applySince({ summaries, diagnostics }, options?.since);
}

async function summarizeFile(args: {
  source: SessionSource;
  provider: string;
  file: DiscoveredFile;
  mapper: SessionMapper;
  diagnostics: SessionDiagnostic[];
}): Promise<SessionSummary | undefined> {
  const { source, provider, file, mapper, diagnostics } = args;
  let content: string;
  try {
    content = await readFile(file.path, 'utf8');
  } catch (error) {
    diagnostics.push({
      source,
      filePath: file.path,
      severity: 'warning',
      code: 'unreadable',
      message: `Could not read ${file.path}: ${errorMessage(error)}`,
    });
    return undefined;
  }

  const { records, parseErrors } = parseJsonlLines(content);
  if (records.length === 0) {
    diagnostics.push({
      source,
      filePath: file.path,
      severity: 'warning',
      code: 'parse_failed',
      message: `No parseable records in ${file.path} (${parseErrors} bad lines).`,
    });
    return degradedSummary({ source, file, provider });
  }
  if (parseErrors > 0) {
    diagnostics.push({
      source,
      filePath: file.path,
      severity: 'info',
      code: 'partial_parse',
      message: `${parseErrors} unparseable line(s) skipped in ${file.path}.`,
    });
  }

  let mapped: MappedSession;
  try {
    mapped = mapper(records);
  } catch (error) {
    diagnostics.push({
      source,
      filePath: file.path,
      severity: 'warning',
      code: 'parse_failed',
      message: `Mapper failed for ${file.path}: ${errorMessage(error)}`,
    });
    return degradedSummary({ source, file, provider });
  }

  const native = mapped.nativeId ?? stableHash(file.path);
  return {
    id: makeSessionId(source, native),
    source,
    origin: 'unknown', // resolved later by the provenance pass
    provider: mapped.provider,
    model: mapped.model,
    title: clampTitle(mapped.title, basenameOf(file.path)),
    startedAt: mapped.startedAt ?? file.birthtimeMs,
    lastMessageAt: mapped.lastMessageAt ?? file.mtimeMs,
    messageCount: mapped.messageCount,
    totalCostUsd: mapped.totalCostUsd,
    totalTokens: mapped.totalTokens,
    cwd: mapped.cwd,
    status: 'completed',
    rawFilePath: file.path,
  };
}

/** Read + map a single JSONL session file into normalized messages (resume/preview). */
export async function loadJsonlMessages(
  filePath: string,
  mapper: MessageMapper,
): Promise<NormalizedMessage[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const { records } = parseJsonlLines(content);
  try {
    return mapper(records);
  } catch {
    return [];
  }
}

function applySince(result: SessionScanResult, since: number | undefined): SessionScanResult {
  if (since === undefined) return result;
  return {
    summaries: result.summaries.filter((s) => s.lastMessageAt >= since),
    diagnostics: result.diagnostics,
  };
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
