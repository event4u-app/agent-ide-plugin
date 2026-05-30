import { readEngagementEvents, type EngagementEvent, type EngagementKind } from './engagement.js';

/**
 * T-1403 — markdown report for the `event4u: Export Telemetry Report` command.
 *
 * Pure aggregation over content-free {@link EngagementEvent}s: top-N by kind,
 * outcome counts, average duration, daily activity. Emits an explicit
 * no-content guarantee footer (AI council, 2026-05-31) so a reader knows the
 * report carries only invocation metadata.
 */

export interface ReportOptions {
  /** Inclusive lower bound, ISO date (YYYY-MM-DD) or full ISO-8601. */
  from?: string;
  /** Inclusive upper bound, ISO date or full ISO-8601. */
  to?: string;
  /** Rows per top-N table. Default 10. */
  topN?: number;
}

export interface NameCount {
  name: string;
  count: number;
  succeeded: number;
  failed: number;
  avgDurationMs?: number;
}

export interface EngagementReport {
  from?: string;
  to?: string;
  total: number;
  byKind: Record<EngagementKind, NameCount[]>;
  daily: Array<{ date: string; skill: number; tool: number; command: number; total: number }>;
}

const KINDS: EngagementKind[] = ['skill', 'tool', 'command'];

function inRange(ts: string, from?: string, to?: string): boolean {
  if (from && ts < from) return false;
  // `to` as a bare date should include the whole day → compare on the date prefix.
  if (to && ts.slice(0, to.length) > to) return false;
  return true;
}

export function aggregateEngagement(
  events: EngagementEvent[],
  opts: ReportOptions = {},
): EngagementReport {
  const topN = opts.topN ?? 10;
  const filtered = events.filter((e) => inRange(e.ts, opts.from, opts.to));

  const byKind = {} as Record<EngagementKind, NameCount[]>;
  for (const kind of KINDS) {
    const acc = new Map<
      string,
      { count: number; succeeded: number; failed: number; durSum: number; durN: number }
    >();
    for (const e of filtered) {
      if (e.kind !== kind) continue;
      const row = acc.get(e.name) ?? { count: 0, succeeded: 0, failed: 0, durSum: 0, durN: 0 };
      row.count += 1;
      if (e.outcome === 'succeeded') row.succeeded += 1;
      if (e.outcome === 'failed') row.failed += 1;
      if (e.duration_ms != null) {
        row.durSum += e.duration_ms;
        row.durN += 1;
      }
      acc.set(e.name, row);
    }
    byKind[kind] = [...acc.entries()]
      .map(([name, r]) => ({
        name,
        count: r.count,
        succeeded: r.succeeded,
        failed: r.failed,
        avgDurationMs: r.durN > 0 ? Math.round(r.durSum / r.durN) : undefined,
      }))
      // Sort by count desc, then name asc for stable output.
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, topN);
  }

  const dailyMap = new Map<string, { skill: number; tool: number; command: number }>();
  for (const e of filtered) {
    const date = e.ts.slice(0, 10);
    const row = dailyMap.get(date) ?? { skill: 0, tool: 0, command: 0 };
    row[e.kind] += 1;
    dailyMap.set(date, row);
  }
  const daily = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, r]) => ({ date, ...r, total: r.skill + r.tool + r.command }));

  return { from: opts.from, to: opts.to, total: filtered.length, byKind, daily };
}

function topTable(title: string, rows: NameCount[]): string {
  const head = `### ${title}\n\n| Name | Invocations | Succeeded | Failed | Avg ms |\n| --- | ---: | ---: | ---: | ---: |`;
  if (rows.length === 0) return `${head}\n| _none_ | 0 | 0 | 0 | – |`;
  const body = rows
    .map(
      (r) =>
        `| ${r.name} | ${r.count} | ${r.succeeded} | ${r.failed} | ${r.avgDurationMs ?? '–'} |`,
    )
    .join('\n');
  return `${head}\n${body}`;
}

export function renderEngagementReport(report: EngagementReport): string {
  const range =
    report.from || report.to ? `${report.from ?? '…'} → ${report.to ?? '…'}` : 'all time';
  const lines: string[] = [];
  lines.push('# Artifact Engagement Report');
  lines.push('');
  lines.push(`- **Range:** ${range}`);
  lines.push(`- **Total invocations:** ${report.total}`);
  lines.push(`- **Unique skills:** ${report.byKind.skill.length}`);
  lines.push(`- **Unique tools:** ${report.byKind.tool.length}`);
  lines.push(`- **Unique commands:** ${report.byKind.command.length}`);
  lines.push('');
  lines.push(topTable('Top Skills', report.byKind.skill));
  lines.push('');
  lines.push(topTable('Top Tools', report.byKind.tool));
  lines.push('');
  lines.push(topTable('Top Commands', report.byKind.command));
  lines.push('');
  lines.push('### Activity Over Time');
  lines.push('');
  lines.push('| Date | Skills | Tools | Commands | Total |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  if (report.daily.length === 0) {
    lines.push('| _none_ | 0 | 0 | 0 | 0 |');
  } else {
    for (const d of report.daily) {
      lines.push(`| ${d.date} | ${d.skill} | ${d.tool} | ${d.command} | ${d.total} |`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push(
    '> _This report contains only invocation metadata (which skills, tools, and ' +
      'commands ran). No source code, prompts, completions, file paths, or ' +
      'arguments are recorded._',
  );
  return `${lines.join('\n')}\n`;
}

/** Read the local telemetry directory and render a markdown report. */
export async function exportEngagementReport(
  baseDir: string,
  opts: ReportOptions = {},
): Promise<string> {
  const events = await readEngagementEvents(baseDir);
  return renderEngagementReport(aggregateEngagement(events, opts));
}
