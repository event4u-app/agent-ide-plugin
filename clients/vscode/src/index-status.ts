import type { Envelope, RootIndexStatus } from '@event4u-agent/protocol';

/**
 * T-1304 / T-PRD07 — VS Code index-status statusbar logic.
 *
 * The TypeScript twin of the JetBrains widget (ADR-054). The Core's
 * `connect` / `workspaceFoldersChanged` / `rootStatus` replies all carry
 * `RootIndexStatus[]`; this module turns them into one statusbar line plus a
 * per-root tooltip and drives a poll while any root is still indexing.
 *
 * Split so the aggregation + the poll loop are unit-tested without the `vscode`
 * module: {@link presentIndexStatus} and {@link extractStatuses} are pure, and
 * {@link IndexStatusController} takes injected `request` + `render` callbacks
 * (extension.ts wires them to a real StatusBarItem + the sidecar client).
 */

export interface IndexStatusView {
  text: string;
  tooltip: string;
}

/** Aggregate the per-root status into one line (error > indexing > ready) + tooltip. */
export function presentIndexStatus(statuses: RootIndexStatus[]): IndexStatusView {
  if (statuses.length === 0) {
    return { text: 'Index: idle', tooltip: 'No workspace roots indexed yet.' };
  }

  const tooltip = statuses.map(rootLine).join('\n');
  const indexedFiles = statuses.reduce((acc, s) => acc + s.fileCount, 0);
  const errors = statuses.filter((s) => s.state === 'error').length;
  const indexing = statuses.filter((s) => s.state === 'indexing');

  let text: string;
  if (errors > 0) {
    text = `Index: error (${errors})`;
  } else if (indexing.length > 0) {
    // Sum totals only when every indexing root knows its total; a single
    // unknown total makes the denominator meaningless, so drop it.
    text = indexing.every((s) => s.totalFiles != null)
      ? `Indexing ${indexedFiles}/${indexing.reduce((a, s) => a + (s.totalFiles ?? 0), 0)} files…`
      : `Indexing ${indexedFiles} files…`;
  } else {
    text = `Index ready · ${indexedFiles} files`;
  }
  return { text, tooltip };
}

function rootLine(s: RootIndexStatus): string {
  const total = s.totalFiles != null ? `/${s.totalFiles}` : '';
  const suffix = s.message ? ` — ${s.message}` : '';
  return `${s.stableId}: ${s.state} ${s.fileCount}${total} files${suffix}`;
}

/** Pull `RootIndexStatus[]` out of a connect/change/rootStatus reply payload. */
export function extractStatuses(data: unknown): RootIndexStatus[] | undefined {
  const status = (data as { status?: unknown } | undefined)?.status;
  return Array.isArray(status) ? (status as RootIndexStatus[]) : undefined;
}

type RequestFn = (messageType: string, data: unknown) => Promise<Envelope>;

/**
 * Drives the index-status statusbar item: seed from the connect/change reply,
 * then poll `rootStatus` while any root is `indexing` (the documented "the UI
 * polls" model), stopping when settled or disposed. Display-only — no click
 * action (reindex RPC deferred, ADR-054).
 */
export class IndexStatusController {
  private polling = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly request: RequestFn,
    private readonly render: (view: IndexStatusView) => void,
    private readonly intervalMs = 1500,
  ) {}

  /** Feed a connect/`workspaceFoldersChanged` reply; renders + starts polling if indexing. */
  applyReply(data: unknown): void {
    const statuses = extractStatuses(data);
    if (!statuses) return;
    this.render(presentIndexStatus(statuses));
    if (statuses.some((s) => s.state === 'indexing')) this.startPolling();
  }

  private startPolling(): void {
    if (this.polling || this.disposed) return;
    this.polling = true;
    this.tick();
  }

  private tick(): void {
    this.timer = setTimeout(() => {
      void this.poll();
    }, this.intervalMs);
  }

  private async poll(): Promise<void> {
    let stillIndexing = false;
    try {
      const reply = await this.request('rootStatus', {});
      const statuses = extractStatuses(reply.data);
      if (statuses) {
        this.render(presentIndexStatus(statuses));
        stillIndexing = statuses.some((s) => s.state === 'indexing');
      }
    } catch {
      // best-effort; the next event or reconnect re-seeds.
    }
    if (stillIndexing && !this.disposed) {
      this.tick();
    } else {
      this.polling = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.polling = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
