import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { MessageRole, SessionSource, SessionStatus, SessionSummary } from './types.js';

/** Max title length before trimming (PLAN.md: "auto-derived, trimmed"). */
const MAX_TITLE_LENGTH = 80;

/** Short, stable content hash — used to derive ids from file paths. */
export function stableHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/** Source-scoped id: `<source>:<native>`. Identity never crosses sources (council). */
export function makeSessionId(source: SessionSource, native: string): string {
  return `${source}:${native}`;
}

/** Normalize a raw title/first-message into a trimmed, single-line, capped string. */
export function clampTitle(raw: string | undefined, fallback: string): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return fallback;
  return collapsed.length > MAX_TITLE_LENGTH
    ? `${collapsed.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : collapsed;
}

/** Map an arbitrary role string onto the normalized role set. */
export function normalizeRole(raw: unknown): MessageRole {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (value === 'user' || value === 'human') return 'user';
  if (value === 'assistant' || value === 'model' || value === 'ai') return 'assistant';
  if (value === 'system') return 'system';
  if (value === 'tool' || value === 'function' || value === 'tool_result') return 'tool';
  return 'unknown';
}

/**
 * Coerce a timestamp expressed as epoch-ms, epoch-seconds, or an ISO string
 * into epoch-ms. Returns `undefined` when nothing usable is present.
 */
export function toMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: < 1e12 is almost certainly seconds (year ~2001 in ms).
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return toMillis(asNumber);
  }
  return undefined;
}

/** Flatten an Anthropic/OpenAI-style `content` field (string | array of parts) to text. */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const rec = part as Record<string, unknown>;
          if (typeof rec.text === 'string') return rec.text;
          if (typeof rec.content === 'string') return rec.content;
        }
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n');
  }
  return '';
}

/** Parse JSONL content line-by-line, skipping (and counting) unparseable lines. */
export function parseJsonlLines(content: string): {
  records: Record<string, unknown>[];
  parseErrors: number;
} {
  const records: Record<string, unknown>[] = [];
  let parseErrors = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        records.push(value as Record<string, unknown>);
      } else {
        parseErrors++;
      }
    } catch {
      parseErrors++;
    }
  }
  return { records, parseErrors };
}

/** A discovered candidate file plus its stat (mtime drives sort + lastMessageAt fallback). */
export interface DiscoveredFile {
  path: string;
  mtimeMs: number;
  birthtimeMs: number;
  sizeBytes: number;
}

/**
 * Recursively collect files under `root` matching `match`, bounded by `maxDepth`.
 * Returns `[]` if the root is absent or unreadable (fail-open) — the caller turns
 * a hard read error into a diagnostic if it cares.
 */
export async function discoverFiles(
  root: string,
  match: (name: string) => boolean,
  maxDepth = 4,
): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  await walk(root, 0);
  return out;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && match(entry.name)) {
        try {
          const info = await stat(full);
          out.push({
            path: full,
            mtimeMs: info.mtimeMs,
            birthtimeMs: info.birthtimeMs || info.mtimeMs,
            sizeBytes: info.size,
          });
        } catch {
          // Vanished between readdir and stat — ignore.
        }
      }
    }
  }
}

/**
 * Build a degraded summary from file stat alone, for when parsing fails.
 * `status` stays `unknown`; the caller pairs this with a `parse_failed`
 * diagnostic so the contract object is never polluted with error state.
 */
export function degradedSummary(args: {
  source: SessionSource;
  file: DiscoveredFile;
  provider: string;
}): SessionSummary {
  const { source, file, provider } = args;
  return {
    id: `${source}:${stableHash(file.path)}`,
    source,
    origin: 'unknown',
    provider,
    title: basename(file.path),
    startedAt: file.birthtimeMs,
    lastMessageAt: file.mtimeMs,
    messageCount: 0,
    status: 'unknown' satisfies SessionStatus,
    rawFilePath: file.path,
  };
}
