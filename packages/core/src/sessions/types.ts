/**
 * Phase 12 — Unified Session Browser, core types (T-1202).
 *
 * This module aggregates past coding-agent sessions from several sources
 * (the plugin's own API chats plus the external CLIs the developer may run
 * alongside it) and normalizes them into a single {@link SessionSummary}
 * shape. The IDE-side surfacing (the overlay, the gear panel, resume-spawn)
 * lives in the clients and stays out of this pure-core module.
 *
 * Design follows the pre-coding AI-council round (codex/gpt-5.5 +
 * gemini-2.5-pro, 2026-05-30), which converged on:
 *
 *   - Adapters are **lossy importers**, not owners of stable domain data —
 *     external CLI formats drift without warning, so every parser is
 *     independently disposable and fails open.
 *   - The list scan returns summaries **and** diagnostics separately; parse
 *     failures never pollute the normalized {@link SessionSummary}.
 *   - Identity is **source-scoped** (`<source>:<nativeId|pathHash>`); no
 *     cross-source dedupe in v1 (same cwd/model/time can still be a
 *     different session).
 *   - Provenance (`origin`) is an **explicit field separate from `source`**,
 *     because "was this CLI session started inside or outside the plugin?"
 *     is orthogonal to which CLI produced it.
 *
 * See PLAN.md §9.13.1 for the cross-source contract this normalizes to.
 */

/** The five session sources v1 aggregates (PLAN.md §9.13.1). */
export const SESSION_SOURCES = ['api', 'claude-cli', 'codex-cli', 'gemini-cli', 'aider'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/** Lifecycle status as surfaced in the browser. `unknown` doubles as the degraded value. */
export const SESSION_STATUSES = ['active', 'completed', 'interrupted', 'unknown'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Provenance — whether the plugin itself launched the session.
 *
 *   - `plugin`   — our own API chat, or a CLI session recorded in the plugin
 *                  session index.
 *   - `external` — a CLI session file with no plugin provenance (the developer
 *                  ran `claude`/`codex`/`gemini` in a terminal alongside us).
 *   - `unknown`  — provenance could not be determined (index unreadable).
 */
export type SessionOrigin = 'plugin' | 'external' | 'unknown';

/** Normalized cross-source session summary (PLAN.md §9.13.1, plus `origin`). */
export interface SessionSummary {
  /** Source-scoped unique id: `<source>:<nativeId|pathHash>`. */
  id: string;
  source: SessionSource;
  /** Provenance — see {@link SessionOrigin}. Separate from `source` by design. */
  origin: SessionOrigin;
  /** Best-effort provider label (e.g. `anthropic`, `openai`, `google`). */
  provider: string;
  model?: string;
  /** Auto-derived from the first user message, trimmed; falls back to the file name. */
  title: string;
  /** Epoch ms of the first message (falls back to file birth/mtime). */
  startedAt: number;
  /** Epoch ms of the last message (falls back to file mtime). */
  lastMessageAt: number;
  messageCount: number;
  /** `undefined` for sub-flat / unknown — never fabricated (council: cut cost normalization where absent). */
  totalCostUsd?: number;
  totalTokens?: number;
  /** Where the session was held, when the source records it. */
  cwd?: string;
  status: SessionStatus;
  /** Underlying file, so the UI can offer "Open raw". */
  rawFilePath?: string;
}

/** Routing handle for a single session — what {@link SessionAdapter.loadMessages} consumes. */
export interface SessionRef {
  source: SessionSource;
  id: string;
  rawFilePath?: string;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

/** Stable diagnostic codes so the UI can map to a "Repair"/"Warning" affordance. */
export type DiagnosticCode =
  | 'parse_failed'
  | 'unreadable'
  | 'unsupported_format'
  | 'location_missing'
  | 'partial_parse';

/** A non-fatal problem encountered while scanning — kept out of the domain object. */
export interface SessionDiagnostic {
  source: SessionSource;
  filePath?: string;
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
}

/** What a list scan yields: normalized summaries plus the problems hit along the way. */
export interface SessionScanResult {
  summaries: SessionSummary[];
  diagnostics: SessionDiagnostic[];
}

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool', 'unknown'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** A single normalized message — the unit {@link SessionAdapter.loadMessages} returns. */
export interface NormalizedMessage {
  role: MessageRole;
  content: string;
  timestamp?: number;
}

/** Options narrowing a list scan. */
export interface SessionListOptions {
  /** Cap per-source results, newest first (default {@link DEFAULT_SESSION_LIMIT}). */
  limit?: number;
  /** Only sessions whose `lastMessageAt >= since` (epoch ms). */
  since?: number;
}

/** Per-source list cap (PLAN.md §9.13.5 `display.max_listed`). */
export const DEFAULT_SESSION_LIMIT = 500;

/**
 * One adapter per source. Adapters are lossy importers: `listSummaries` does a
 * cheap, fail-open scan; `loadMessages` does the full read for a single session.
 * Keeping the two apart prevents a metadata scan from pulling multi-MB bodies.
 */
export interface SessionAdapter {
  readonly source: SessionSource;
  /**
   * Cheap scan → summaries + diagnostics. MUST NOT throw on a bad file; degrade
   * instead. The one exception is an abort: when `signal` fires the scan rejects
   * with an `AbortError` so a Stop can interrupt a long multi-file walk (T-1305).
   */
  listSummaries(options?: SessionListOptions, signal?: AbortSignal): Promise<SessionScanResult>;
  /** Full normalized read of a single session (resume/preview). */
  loadMessages(ref: SessionRef, signal?: AbortSignal): Promise<NormalizedMessage[]>;
}
