import type { CodeSuggestionAnnotation, CodeSuggestionState } from '@event4u-agent/protocol';

import type { EditResult, EditStatus, WriteFilesPlan } from '../tools/write-files.js';

/**
 * Code-suggestion annotation seam (pure-core).
 *
 * Threads the existing {@link WriteFilesPlan} edit seam into the durable
 * `code-suggestion` member of the `Message.annotations` contract (SweepAI
 * `CodeMirrorSuggestionEditor` state machine, ported to the message model).
 * AI council (codex-cli + gemini-cli, 2026-06-01): standalone from the transient
 * `ToolCallEvent` stream (A1), flat enum state on the wire (B1), reducer over an
 * explicit event union (C1), built from the resolved plan (D1), bounded diff
 * preview on the wire (E1), invalid transitions are no-ops not throws (F1).
 *
 * The editor RENDER + per-suggestion stage/apply affordance stay IDE-deferred —
 * this module only produces the data and owns the transition invariant.
 *
 * Determinism contract: {@link buildCodeSuggestions} emits one annotation per
 * input edit, in `edits` order, with a stable per-turn `suggestionId`. The
 * builder never mutates the plan.
 */

/** Default preview bounds — diffs are larger than snippets but stay capped. */
export const DIFF_PREVIEW_MAX_LINES = 40;
export const DIFF_PREVIEW_MAX_CHARS = 2000;

export interface BuildCodeSuggestionsOptions {
  /** Max lines kept in the diff preview (default {@link DIFF_PREVIEW_MAX_LINES}). */
  diffPreviewMaxLines?: number;
  /** Hard char cap on the diff preview (default {@link DIFF_PREVIEW_MAX_CHARS}). */
  diffPreviewMaxChars?: number;
}

/**
 * Map a {@link EditStatus} from the resolved plan to the INITIAL suggestion
 * state. A cleanly- or fuzzily-located edit is `pending` (awaiting apply);
 * anything the locator could not resolve is `error`.
 */
export function initialStateForEdit(status: EditStatus): CodeSuggestionState {
  switch (status) {
    case 'resolved':
    case 'suggestion':
      return 'pending';
    case 'not_found':
    case 'ambiguous':
    case 'error':
      return 'error';
  }
}

/** Bound a diff to `maxLines` then `maxChars`, trimming a torn tail. */
function boundDiff(text: string, maxLines: number, maxChars: number): string {
  const byLines = text.split('\n').slice(0, maxLines).join('\n');
  return byLines.length > maxChars ? byLines.slice(0, maxChars) : byLines;
}

/**
 * Build the initial `code-suggestion` annotations for one turn from a resolved
 * {@link WriteFilesPlan}. `resolved`/`suggestion` edits start `pending` with a
 * bounded unified-diff preview taken from the matching planned file; unresolved
 * edits start `error` carrying the locate diagnostic. One annotation per edit,
 * in order.
 */
export function buildCodeSuggestions(
  plan: WriteFilesPlan,
  options: BuildCodeSuggestionsOptions = {},
): CodeSuggestionAnnotation[] {
  const maxLines = options.diffPreviewMaxLines ?? DIFF_PREVIEW_MAX_LINES;
  const maxChars = options.diffPreviewMaxChars ?? DIFF_PREVIEW_MAX_CHARS;
  const diffByPath = new Map(plan.files.map((f) => [f.path, f.diff]));

  return plan.edits.map((edit: EditResult): CodeSuggestionAnnotation => {
    const state = initialStateForEdit(edit.status);
    const rawDiff = diffByPath.get(edit.file) ?? '';
    return {
      kind: 'code-suggestion',
      suggestionId: `edit-${edit.index}`,
      filePath: edit.file,
      state,
      diffPreview: state === 'error' ? '' : boundDiff(rawDiff, maxLines, maxChars),
      ...(state === 'error' && edit.message !== undefined ? { errorMessage: edit.message } : {}),
    };
  });
}

/** A transition driven by the apply lifecycle of one suggestion. */
export type CodeSuggestionEvent =
  | { type: 'start' }
  | { type: 'complete' }
  | { type: 'fail'; error: string };

export interface TransitionResult {
  /** The resulting annotation (the input, unchanged, when the event is invalid). */
  next: CodeSuggestionAnnotation;
  /** False when the event was a no-op (terminal state or invalid transition). */
  changed: boolean;
}

const TERMINAL: ReadonlySet<CodeSuggestionState> = new Set(['done', 'error']);

/**
 * Pure reducer over the SweepAI suggestion state machine. Valid edges:
 * `pending --start--> processing`, `processing --complete--> done`,
 * `pending|processing --fail--> error`. Terminal states (`done`/`error`) are
 * immutable; any other event is a no-op. Invalid transitions return the input
 * unchanged with `changed:false` (F1) so a caller can log a stale/racey event
 * without crashing the sidecar — never throws.
 */
export function transitionCodeSuggestion(
  current: CodeSuggestionAnnotation,
  event: CodeSuggestionEvent,
): TransitionResult {
  const noop: TransitionResult = { next: current, changed: false };
  if (TERMINAL.has(current.state)) return noop;

  switch (event.type) {
    case 'start':
      if (current.state !== 'pending') return noop;
      return { next: { ...current, state: 'processing' }, changed: true };
    case 'complete':
      if (current.state !== 'processing') return noop;
      return { next: { ...current, state: 'done' }, changed: true };
    case 'fail':
      // From either non-terminal state; attaches the failure reason.
      return { next: { ...current, state: 'error', errorMessage: event.error }, changed: true };
  }
}
