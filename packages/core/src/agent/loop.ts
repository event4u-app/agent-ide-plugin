import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  type ChatMessage,
  type HaltAnswer,
  type HaltRequest,
  HaltRequestSchema,
} from '@event4u-agent/protocol';

/**
 * T-701 — Agent loop state machine.
 *
 * `refine → plan → implement → verify → report`, persisted to `.work-state.json`
 * so a run survives a sidecar restart. The driver is deliberately boring (the
 * council's recommendation): it loads state, runs the current phase via an
 * injected {@link PhaseRunners}, persists the transition, and emits a
 * {@link HaltRequest} between phases through an injected {@link HaltGate}.
 * Nothing here knows about prompts, buttons, panes, or IDE commands — the IDE
 * owns the real halt round-trip; tests pass a scripted gate.
 *
 * The phase functions themselves (LLM calls, the multi-file edit loop in
 * T-702c, the delta-gate in T-702b) are injected so the state machine is unit
 * testable with no real model, no real stdin, and no disk.
 */

export const AgentPhaseSchema = z.enum(['refine', 'plan', 'implement', 'verify', 'report', 'done']);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

/** Order phases advance through. `report` → `done` ends the run. */
const PHASE_ORDER: AgentPhase[] = ['refine', 'plan', 'implement', 'verify', 'report', 'done'];

export const WorkStateSchema = z.object({
  conversationId: z.string().min(1),
  phase: AgentPhaseSchema,
  /** Original user request driving the run. */
  task: z.string(),
  /** Conversation accumulated across phases. */
  history: z.array(z.unknown()).default([]),
  /** Plan text produced in the `plan` phase. */
  plan: z.string().optional(),
  /** Files the `implement` phase changed. */
  changedFiles: z.array(z.string()).default([]),
  /** Final summary from the `report` phase. */
  report: z.string().optional(),
  done: z.boolean().default(false),
  updatedAt: z.string(),
});
export type WorkState = Omit<z.infer<typeof WorkStateSchema>, 'history'> & {
  history: ChatMessage[];
};

/** Halt envelope enriched with the phase that raised it. */
export interface AgentHaltRequest extends HaltRequest {
  phase: AgentPhase;
}

export interface HaltGate {
  request(halt: AgentHaltRequest): Promise<HaltAnswer>;
}

export interface StateStore {
  load(conversationId: string): Promise<WorkState | undefined>;
  save(state: WorkState): Promise<void>;
}

export interface PhaseContext {
  state: WorkState;
}

export interface ImplementOutcome {
  text: string;
  changedFiles: string[];
}
export interface VerifyOutcome {
  ok: boolean;
  text: string;
}

/** The per-phase work. Each returns the text appended to the run history. */
export interface PhaseRunners {
  refine(ctx: PhaseContext): Promise<{ text: string }>;
  plan(ctx: PhaseContext): Promise<{ text: string }>;
  implement(ctx: PhaseContext): Promise<ImplementOutcome>;
  verify(ctx: PhaseContext): Promise<VerifyOutcome>;
  report(ctx: PhaseContext): Promise<{ text: string }>;
}

export interface AgentDriverOptions {
  conversationId: string;
  runners: PhaseRunners;
  gate: HaltGate;
  store: StateStore;
  /** Injected clock for deterministic timestamps. */
  now?: () => string;
}

const PROCEED = 'proceed';
const REVISE = 'revise';
const STOP = 'stop';
const RETRY = 'retry';
const ACCEPT = 'accept';

export class AgentDriver {
  private readonly now: () => string;

  constructor(private readonly opts: AgentDriverOptions) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** Start (or resume) a run and drive it to `done` or an explicit stop. */
  async run(task: string): Promise<WorkState> {
    let state = await this.opts.store.load(this.opts.conversationId);
    if (!state) {
      state = {
        conversationId: this.opts.conversationId,
        phase: 'refine',
        task,
        history: [],
        changedFiles: [],
        done: false,
        updatedAt: this.now(),
      };
      await this.persist(state);
    }
    while (!state.done) {
      const next = await this.step(state);
      if (next.stopped) return next.state;
      state = next.state;
    }
    return state;
  }

  /** Run exactly one phase + its halt. Exposed for step-through tests. */
  async step(state: WorkState): Promise<{ state: WorkState; stopped: boolean }> {
    switch (state.phase) {
      case 'refine':
        return this.textPhase(state, 'refine', this.opts.runners.refine.bind(this.opts.runners), {
          question: 'Is this the right understanding of the task?',
        });
      case 'plan':
        return this.textPhase(state, 'plan', this.opts.runners.plan.bind(this.opts.runners), {
          question: 'Approve this plan?',
          capture: (s, text) => {
            s.plan = text;
          },
        });
      case 'implement':
        return this.implementPhase(state);
      case 'verify':
        return this.verifyPhase(state);
      case 'report':
        return this.reportPhase(state);
      case 'done':
        return { state, stopped: false };
    }
  }

  // --- phase implementations -------------------------------------------

  private async textPhase(
    state: WorkState,
    phase: AgentPhase,
    run: (ctx: PhaseContext) => Promise<{ text: string }>,
    opts: { question: string; capture?: (s: WorkState, text: string) => void },
  ): Promise<{ state: WorkState; stopped: boolean }> {
    const { text } = await run({ state });
    const withText = this.append(state, 'assistant', text);
    opts.capture?.(withText, text);

    const answer = await this.opts.gate.request({
      ...halt(phase, opts.question, [
        { id: PROCEED, label: 'Proceed' },
        { id: REVISE, label: 'Revise' },
        { id: STOP, label: 'Stop' },
      ]),
      phase,
    });

    if (answer.option_id === STOP) {
      return { state: await this.persist(withText), stopped: true };
    }
    if (answer.option_id === REVISE || answer.text) {
      // Fold the steer back into history and re-run the same phase.
      const steered = this.append(withText, 'user', answer.text ?? 'Please revise.');
      return { state: await this.persist(steered), stopped: false };
    }
    return { state: await this.advance(withText), stopped: false };
  }

  private async implementPhase(state: WorkState): Promise<{ state: WorkState; stopped: boolean }> {
    const outcome = await this.opts.runners.implement({ state });
    let next = this.append(state, 'assistant', outcome.text);
    next = { ...next, changedFiles: dedupe([...next.changedFiles, ...outcome.changedFiles]) };
    // No halt after implement — verification gates acceptance instead.
    return { state: await this.advance(next), stopped: false };
  }

  private async verifyPhase(state: WorkState): Promise<{ state: WorkState; stopped: boolean }> {
    const outcome = await this.opts.runners.verify({ state });
    const next = this.append(state, 'assistant', outcome.text);
    if (outcome.ok) {
      return { state: await this.advance(next), stopped: false };
    }
    // Verification failed → halt for steering.
    const answer = await this.opts.gate.request({
      ...halt('verify', `Verification failed: ${outcome.text}`, [
        { id: RETRY, label: 'Retry implement' },
        { id: ACCEPT, label: 'Accept anyway' },
        { id: STOP, label: 'Stop' },
      ]),
      phase: 'verify',
    });
    if (answer.option_id === STOP) {
      return { state: await this.persist(next), stopped: true };
    }
    if (answer.option_id === ACCEPT) {
      return { state: await this.advance(next), stopped: false };
    }
    // retry / free-text → back to implement.
    const retried = {
      ...this.append(next, 'user', answer.text ?? 'Retry the edit.'),
      phase: 'implement' as AgentPhase,
    };
    return { state: await this.persist(retried), stopped: false };
  }

  private async reportPhase(state: WorkState): Promise<{ state: WorkState; stopped: boolean }> {
    const { text } = await this.opts.runners.report({ state });
    const next = {
      ...this.append(state, 'assistant', text),
      report: text,
      done: true,
      phase: 'done' as AgentPhase,
    };
    return { state: await this.persist(next), stopped: false };
  }

  // --- helpers ----------------------------------------------------------

  private append(state: WorkState, role: ChatMessage['role'], text: string): WorkState {
    return { ...state, history: [...state.history, { role, content: text }] };
  }

  private async advance(state: WorkState): Promise<WorkState> {
    const idx = PHASE_ORDER.indexOf(state.phase);
    const nextPhase = PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)]!;
    return this.persist({ ...state, phase: nextPhase });
  }

  private async persist(state: WorkState): Promise<WorkState> {
    const stamped = { ...state, updatedAt: this.now() };
    await this.opts.store.save(stamped);
    return stamped;
  }
}

function halt(phase: AgentPhase, question: string, options: HaltRequest['options']): HaltRequest {
  return HaltRequestSchema.parse({ id: `${phase}-halt`, question, options, allow_free_text: true });
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

// --- state stores -------------------------------------------------------

/** In-memory store for tests and ephemeral runs. */
export class InMemoryStateStore implements StateStore {
  private readonly states = new Map<string, WorkState>();
  async load(conversationId: string): Promise<WorkState | undefined> {
    return this.states.get(conversationId);
  }
  async save(state: WorkState): Promise<void> {
    this.states.set(state.conversationId, structuredCloneState(state));
  }
}

/** Persists one run to a `.work-state.json` file (agent-config convention). */
export class FileStateStore implements StateStore {
  constructor(private readonly path: string) {}

  async load(conversationId: string): Promise<WorkState | undefined> {
    const text = await readFile(this.path, 'utf8').catch(() => undefined);
    if (!text) return undefined;
    const parsed = WorkStateSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    const state = parsed.data as unknown as WorkState;
    return state.conversationId === conversationId ? state : undefined;
  }

  async save(state: WorkState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}

function structuredCloneState(state: WorkState): WorkState {
  return {
    ...state,
    history: [...state.history],
    changedFiles: [...state.changedFiles],
  };
}
