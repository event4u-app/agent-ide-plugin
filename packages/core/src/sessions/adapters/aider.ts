import { readFile, stat } from 'node:fs/promises';
import { clampTitle, makeSessionId, stableHash, toMillis } from '../parse-utils.js';
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
 * Aider adapter (T-1202).
 *
 * Aider keeps a single per-workspace markdown log at `<cwd>/.aider.chat.history.md`.
 * A line `# aider chat started at <timestamp>` opens each chat; `#### ` lines are
 * user turns, intervening prose is the assistant. One file therefore holds many
 * sessions. This is the least stable source (PLAN.md flags full resume as v1.5),
 * so the parse is intentionally shallow: user turns drive `messageCount`, and the
 * assistant text between them is reconstructed best-effort.
 */
const PROVIDER = 'aider';
const SESSION_MARKER = /^#+\s*aider chat started at\s+(.+?)\s*$/i;
const USER_TURN = /^####\s+(.*)$/;

interface AiderBlock {
  nativeId: string;
  startedAt?: number;
  title?: string;
  userTurns: number;
  lines: string[];
}

function splitBlocks(content: string, filePath: string): AiderBlock[] {
  const blocks: AiderBlock[] = [];
  let current: AiderBlock | undefined;
  let index = 0;
  for (const line of content.split('\n')) {
    const marker = SESSION_MARKER.exec(line);
    if (marker) {
      current = {
        nativeId: `${stableHash(filePath)}-${index++}`,
        startedAt: toMillis(marker[1]),
        userTurns: 0,
        lines: [],
      };
      blocks.push(current);
      continue;
    }
    if (!current) {
      // Pre-amble before any marker — treat the whole file as one implicit block.
      current = { nativeId: `${stableHash(filePath)}-${index++}`, userTurns: 0, lines: [] };
      blocks.push(current);
    }
    const turn = USER_TURN.exec(line);
    if (turn) {
      current.userTurns++;
      if (current.title === undefined && turn[1]!.trim().length > 0)
        current.title = turn[1]!.trim();
    }
    current.lines.push(line);
  }
  return blocks;
}

function blockMessages(block: AiderBlock): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  let assistantBuffer: string[] = [];
  const flushAssistant = (): void => {
    const text = assistantBuffer.join('\n').trim();
    if (text.length > 0) messages.push({ role: 'assistant', content: text });
    assistantBuffer = [];
  };
  for (const line of block.lines) {
    const turn = USER_TURN.exec(line);
    if (turn) {
      flushAssistant();
      messages.push({ role: 'user', content: turn[1]!.trim() });
    } else {
      assistantBuffer.push(line);
    }
  }
  flushAssistant();
  return messages.filter((m) => m.content.length > 0);
}

export class AiderAdapter implements SessionAdapter {
  readonly source = 'aider' as const;

  constructor(private readonly historyFile: string | undefined) {}

  async listSummaries(options?: SessionListOptions): Promise<SessionScanResult> {
    const diagnostics: SessionDiagnostic[] = [];
    if (!this.historyFile) {
      diagnostics.push({
        source: this.source,
        severity: 'info',
        code: 'location_missing',
        message: 'No aider file.',
      });
      return { summaries: [], diagnostics };
    }

    let content: string;
    let mtimeMs: number;
    try {
      content = await readFile(this.historyFile, 'utf8');
      mtimeMs = (await stat(this.historyFile)).mtimeMs;
    } catch {
      // No aider history in this workspace — not an error, just nothing to list.
      return { summaries: [], diagnostics };
    }

    const blocks = splitBlocks(content, this.historyFile);
    const summaries: SessionSummary[] = blocks.map((block, i) => ({
      id: makeSessionId(this.source, block.nativeId),
      source: this.source,
      origin: 'unknown',
      provider: PROVIDER,
      title: clampTitle(block.title, 'aider session'),
      startedAt: block.startedAt ?? mtimeMs,
      lastMessageAt:
        i === blocks.length - 1
          ? mtimeMs
          : (blocks[i + 1]!.startedAt ?? block.startedAt ?? mtimeMs),
      messageCount: block.userTurns,
      status: 'completed',
      rawFilePath: this.historyFile,
    }));

    const limit = options?.limit ?? DEFAULT_SESSION_LIMIT;
    const sorted = summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt).slice(0, limit);
    const filtered =
      options?.since === undefined
        ? sorted
        : sorted.filter((s) => s.lastMessageAt >= options.since!);
    return { summaries: filtered, diagnostics };
  }

  async loadMessages(ref: SessionRef): Promise<NormalizedMessage[]> {
    if (!ref.rawFilePath) return [];
    try {
      const content = await readFile(ref.rawFilePath, 'utf8');
      const block = splitBlocks(content, ref.rawFilePath).find(
        (b) => makeSessionId(this.source, b.nativeId) === ref.id,
      );
      return block ? blockMessages(block) : [];
    } catch {
      return [];
    }
  }
}
