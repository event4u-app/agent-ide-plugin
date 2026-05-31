import { z } from 'zod';
import { type AgentPhase } from './loop.js';

/**
 * T-PRD08 — agent modes → directive sets (pure core).
 *
 * The user picks an explicit mode in the composer; each mode maps to a
 * {@link DirectiveSet} that says which {@link AgentPhase}s the turn runs and
 * whether it may write files. This is a STANDALONE map + resolver (AI council
 * 2026-05-31, UNANIMOUS — Option 1): the tested `AgentDriver` is left untouched
 * and consumes a `DirectiveSet` later, mirroring the "provider-direct now,
 * fold into the driver later" precedent. No mode is selectable end-to-end until
 * the composer UI + the driver wiring land; this fixes the vocabulary first.
 *
 * Every directive's phases are a subset of the full pipeline
 * (`refine → plan → implement → verify → report`) in pipeline order; the driver
 * appends the terminal `done` itself, so no directive lists it.
 */

export const AgentModeSchema = z.enum(['ask', 'edit', 'plan', 'review', 'commit', 'explain']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export interface DirectiveSet {
  mode: AgentMode;
  /** Phases this mode runs, in pipeline order. Never includes `done`. */
  phases: AgentPhase[];
  /** Whether the mode is allowed to write files (gates implement/verify). */
  mutates: boolean;
  /** One-line composer label / intent. */
  label: string;
}

/**
 * The mode → directive map. `edit` is the full pipeline; the read-only modes
 * stop before `implement`. `review` / `commit` reuse `verify` / `report` to
 * run the review engine and draft summaries without writing.
 */
export const MODE_DIRECTIVES: Record<AgentMode, DirectiveSet> = {
  ask: {
    mode: 'ask',
    phases: ['refine', 'report'],
    mutates: false,
    label: 'Ask — answer, no edits',
  },
  explain: {
    mode: 'explain',
    phases: ['refine', 'report'],
    mutates: false,
    label: 'Explain selection',
  },
  plan: {
    mode: 'plan',
    phases: ['refine', 'plan', 'report'],
    mutates: false,
    label: 'Plan — propose, no edits',
  },
  edit: {
    mode: 'edit',
    phases: ['refine', 'plan', 'implement', 'verify', 'report'],
    mutates: true,
    label: 'Edit — full implement loop',
  },
  review: {
    mode: 'review',
    phases: ['refine', 'verify', 'report'],
    mutates: false,
    label: 'Review — findings over the diff',
  },
  commit: {
    mode: 'commit',
    phases: ['refine', 'report'],
    mutates: false,
    label: 'Commit — draft message / PR (never commits)',
  },
};

/** The default mode when the client sends none. */
export const DEFAULT_MODE: AgentMode = 'edit';

/** Resolve a mode (or the default) to its directive set. */
export function resolveMode(mode: AgentMode = DEFAULT_MODE): DirectiveSet {
  return MODE_DIRECTIVES[mode];
}

/** Whether a phase runs under a given mode. */
export function phaseRunsInMode(mode: AgentMode, phase: AgentPhase): boolean {
  return resolveMode(mode).phases.includes(phase);
}
