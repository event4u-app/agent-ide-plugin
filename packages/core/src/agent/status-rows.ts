import type { StatusRowAnnotation, StatusRowPhase, StatusRowState } from '@event4u-agent/protocol';

import type { DirectiveSet } from './modes.js';

/**
 * Status-row annotation seam (pure-core).
 *
 * The third member of the `Message.annotations` contract — the SweepAI
 * "progress strings are first-class stream items" surface, ported to the durable
 * message model. One row per step of a long operation (an agent pipeline phase,
 * or a non-phase op such as background indexing) with a `pending|active|done|error`
 * lifecycle.
 *
 * AI council (codex-cli + gemini-cli, 2026-06-01): durable annotation, not a
 * transient stream (A1); `active` state over reusing code-suggestion's
 * edit-specific `processing` (C1); carry the optional `phase` on the wire for a
 * deterministic IDE icon (D1); reducer with a `progress` detail-only event,
 * no-op on invalid/terminal edges, never throws (E1); pure-core only — the live
 * AgentDriver phase-boundary wiring + the spinner render stay IDE-deferred (F1).
 * The codex B1 / gemini B2 split resolves to a generic descriptor-driven builder
 * (B2) with a mode-aware convenience wrapper {@link statusRowsForMode} (B1).
 *
 * Determinism contract: {@link buildStatusRows} emits one annotation per input
 * descriptor, in order, with the caller's stable `statusId`. The builder never
 * generates ids and never mutates its input.
 */

/** One step the builder turns into a status row. */
export interface StatusRowDescriptor {
  /** Stable, deterministic id (NOT a UUID) the reducer reconciles updates against. */
  statusId: string;
  /** Human-readable row text. */
  label: string;
  /** The pipeline phase this row tracks, when it tracks one. */
  phase?: StatusRowPhase;
}

export interface BuildStatusRowsOptions {
  /**
   * Mark the descriptor at this index `active`; earlier rows `done`, later rows
   * `pending`. Out-of-range or omitted → every row stays `pending`.
   */
  activeIndex?: number;
}

/** Initial state for a row at `index`, relative to the active position. */
function initialState(index: number, activeIndex: number | undefined): StatusRowState {
  if (activeIndex === undefined || index > activeIndex) return 'pending';
  if (index < activeIndex) return 'done';
  return 'active';
}

/**
 * Build the initial status rows for one turn from an ordered descriptor list.
 * With no `activeIndex` every row is `pending`; with one, earlier rows are `done`,
 * the active row `active`, later rows `pending`. One row per descriptor, in order.
 */
export function buildStatusRows(
  descriptors: readonly StatusRowDescriptor[],
  options: BuildStatusRowsOptions = {},
): StatusRowAnnotation[] {
  // An out-of-range activeIndex means "no active row" → every row stays pending.
  const { activeIndex } = options;
  const active =
    activeIndex !== undefined && activeIndex >= 0 && activeIndex < descriptors.length
      ? activeIndex
      : undefined;
  return descriptors.map((descriptor, index): StatusRowAnnotation => {
    return {
      kind: 'status-row',
      statusId: descriptor.statusId,
      label: descriptor.label,
      state: initialState(index, active),
      ...(descriptor.phase !== undefined ? { phase: descriptor.phase } : {}),
    };
  });
}

/** Title-case a phase name for the row label ("implement" → "Implement"). */
function phaseLabel(phase: StatusRowPhase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/**
 * Convenience over {@link buildStatusRows}: derive one row per phase in a
 * {@link DirectiveSet}, in pipeline order, with a stable `phase-<name>` id and a
 * title-cased label. `currentPhase`, when it is one of the directive's phases,
 * marks that row `active` (earlier `done`, later `pending`). A directive never
 * lists `done`, so every phase maps to a {@link StatusRowPhase} row.
 */
export function statusRowsForMode(
  directive: DirectiveSet,
  currentPhase?: StatusRowPhase,
): StatusRowAnnotation[] {
  const phases = directive.phases.filter((phase): phase is StatusRowPhase => phase !== 'done');
  const descriptors: StatusRowDescriptor[] = phases.map((phase) => ({
    statusId: `phase-${phase}`,
    label: phaseLabel(phase),
    phase,
  }));
  const activeIndex = currentPhase ? phases.indexOf(currentPhase) : -1;
  return buildStatusRows(descriptors, activeIndex >= 0 ? { activeIndex } : {});
}

/** A transition driven by the progress lifecycle of one status row. */
export type StatusRowEvent =
  | { type: 'activate' }
  | { type: 'complete' }
  | { type: 'fail'; detail: string }
  | { type: 'progress'; detail: string };

export interface StatusRowTransitionResult {
  /** The resulting annotation (the input, unchanged, when the event is invalid). */
  next: StatusRowAnnotation;
  /** False when the event was a no-op (terminal state or invalid transition). */
  changed: boolean;
}

const TERMINAL: ReadonlySet<StatusRowState> = new Set(['done', 'error']);

/**
 * Pure reducer over the status-row lifecycle. Valid edges:
 * `pending --activate--> active`, `active --complete--> done`,
 * `pending|active --fail--> error`. `progress` updates `detail` only (state
 * unchanged) from any non-terminal state. Terminal states (`done`/`error`) are
 * immutable; any other event is a no-op. Invalid transitions return the input
 * unchanged with `changed:false` (E1) so a caller can log a stale/racey event
 * without crashing the sidecar — never throws.
 */
export function transitionStatusRow(
  current: StatusRowAnnotation,
  event: StatusRowEvent,
): StatusRowTransitionResult {
  const noop: StatusRowTransitionResult = { next: current, changed: false };
  if (TERMINAL.has(current.state)) return noop;

  switch (event.type) {
    case 'activate':
      if (current.state !== 'pending') return noop;
      return { next: { ...current, state: 'active' }, changed: true };
    case 'complete':
      if (current.state !== 'active') return noop;
      return { next: { ...current, state: 'done' }, changed: true };
    case 'fail':
      // From either non-terminal state; the reason rides in `detail`.
      return { next: { ...current, state: 'error', detail: event.detail }, changed: true };
    case 'progress':
      // Detail-only update; the lifecycle state is left untouched.
      return { next: { ...current, detail: event.detail }, changed: true };
  }
}
