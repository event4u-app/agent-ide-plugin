import { ApiSessionAdapter } from './adapters/api.js';
import { AiderAdapter } from './adapters/aider.js';
import { ClaudeCliAdapter } from './adapters/claude-cli.js';
import { CodexCliAdapter } from './adapters/codex-cli.js';
import { GeminiCliAdapter } from './adapters/gemini-cli.js';
import {
  type SessionLocationContext,
  type SessionLocations,
  defaultSessionLocations,
} from './locations.js';
import { SessionProvenanceIndex } from './provenance.js';
import {
  type NormalizedMessage,
  type SessionAdapter,
  type SessionDiagnostic,
  type SessionListOptions,
  type SessionOrigin,
  type SessionRef,
  type SessionScanResult,
  type SessionSource,
  type SessionSummary,
} from './types.js';

/** Default "active now" window — a session touched this recently counts as live (T-1204). */
export const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Unified Session Browser core (T-1202b).
 *
 * Composes the per-source adapters behind one surface. Each adapter is invoked
 * independently and fail-open: an adapter that throws downgrades to a diagnostic
 * rather than failing the whole scan. Summaries are merged, stamped with
 * provenance, and sorted newest-first. Cross-source dedupe is deliberately out
 * of scope for v1 (council: same cwd/model/time can still be a distinct session;
 * identity stays source-scoped).
 */
export class SessionBrowser {
  constructor(
    private readonly adapters: SessionAdapter[],
    private readonly provenance?: SessionProvenanceIndex,
  ) {}

  /** Scan every source, merge, stamp provenance, sort by `lastMessageAt` desc. */
  async listSummaries(options?: SessionListOptions): Promise<SessionScanResult> {
    const summaries: SessionSummary[] = [];
    const diagnostics: SessionDiagnostic[] = [];

    const results = await Promise.all(
      this.adapters.map(async (adapter): Promise<SessionScanResult> => {
        try {
          return await adapter.listSummaries(options);
        } catch (error) {
          return {
            summaries: [],
            diagnostics: [
              {
                source: adapter.source,
                severity: 'error',
                code: 'unreadable',
                message: `Adapter ${adapter.source} threw: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }),
    );
    for (const result of results) {
      summaries.push(...result.summaries);
      diagnostics.push(...result.diagnostics);
    }

    const stamped = this.provenance ? await this.provenance.apply(summaries) : summaries;
    stamped.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return { summaries: stamped, diagnostics };
  }

  /** Full normalized read of one session, routed to its source adapter. */
  async loadMessages(ref: SessionRef): Promise<NormalizedMessage[]> {
    const adapter = this.adapters.find((a) => a.source === ref.source);
    return adapter ? adapter.loadMessages(ref) : [];
  }
}

/** Wire the default adapter set + provenance index from a home/workspace context. */
export function createSessionBrowser(ctx: SessionLocationContext): SessionBrowser {
  return createSessionBrowserFromLocations(defaultSessionLocations(ctx));
}

/** Wire the default adapter set from explicit (already-resolved) locations. */
export function createSessionBrowserFromLocations(locations: SessionLocations): SessionBrowser {
  const adapters: SessionAdapter[] = [
    new ApiSessionAdapter(locations.apiChatsDir),
    new ClaudeCliAdapter(locations.claudeProjectsDir),
    new CodexCliAdapter(locations.codexSessionsDir),
    new GeminiCliAdapter(locations.geminiSessionsDir),
    new AiderAdapter(locations.aiderHistoryFile),
  ];
  return new SessionBrowser(adapters, new SessionProvenanceIndex(locations.pluginIndexFile));
}

// --- Pure view helpers (the UI consumes these; kept here so they are unit-tested in core) ---

/** Filter spec for the browser list view (PLAN.md §9.13.2). */
export interface SessionFilter {
  sources?: SessionSource[];
  providers?: string[];
  origins?: SessionOrigin[];
  /** Case-insensitive substring over title + cwd. */
  query?: string;
}

/** Apply a filter spec to a summary list (pure). */
export function filterSessions(
  summaries: SessionSummary[],
  filter: SessionFilter,
): SessionSummary[] {
  const sources = filter.sources ? new Set(filter.sources) : undefined;
  const providers = filter.providers ? new Set(filter.providers) : undefined;
  const origins = filter.origins ? new Set(filter.origins) : undefined;
  const query = filter.query?.trim().toLowerCase();
  return summaries.filter((s) => {
    if (sources && !sources.has(s.source)) return false;
    if (providers && !providers.has(s.provider)) return false;
    if (origins && !origins.has(s.origin)) return false;
    if (query && query.length > 0) {
      const haystack = `${s.title} ${s.cwd ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Mark sessions touched within `windowMs` as `active` (T-1204 active-now detection).
 *
 * Cheapest reliable heuristic per the council: recency of `lastMessageAt`. Returns
 * new objects; never mutates. External CLIs can never be perfectly knowable, so
 * this is explicitly best-effort.
 */
export function markActiveSessions(
  summaries: SessionSummary[],
  nowMs: number,
  windowMs: number = ACTIVE_WINDOW_MS,
): SessionSummary[] {
  return summaries.map((s) =>
    nowMs - s.lastMessageAt < windowMs ? { ...s, status: 'active' as const } : s,
  );
}

/** Recency buckets for the date-grouped list (PLAN.md §9.13.2). */
export interface SessionGroups {
  active: SessionSummary[];
  today: SessionSummary[];
  yesterday: SessionSummary[];
  lastWeek: SessionSummary[];
  older: SessionSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Group summaries into active / today / yesterday / last-week / older (pure).
 * Day boundaries are computed from local midnight of `nowMs`. Input order within
 * each bucket is preserved (callers sort before grouping).
 */
export function groupSessionsByRecency(summaries: SessionSummary[], nowMs: number): SessionGroups {
  const groups: SessionGroups = { active: [], today: [], yesterday: [], lastWeek: [], older: [] };
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 6 * DAY_MS;

  for (const s of summaries) {
    if (s.status === 'active') groups.active.push(s);
    else if (s.lastMessageAt >= todayStart) groups.today.push(s);
    else if (s.lastMessageAt >= yesterdayStart) groups.yesterday.push(s);
    else if (s.lastMessageAt >= weekStart) groups.lastWeek.push(s);
    else groups.older.push(s);
  }
  return groups;
}
