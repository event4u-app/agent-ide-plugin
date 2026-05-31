import { stripAnsi } from './ansi.js';

/**
 * Waiting-for-input detection (T-905, PLAN.md §8.9.3).
 *
 * Three strategies, combined: (a) a heuristic regex over the last ~200 bytes of
 * ANSI-stripped output — a fast but false-positive-prone HINT; (c) an idle
 * timeout (no new output for `idleMs`, default 800 ms) that CONFIRMS the hint;
 * (b) an optional PTY read-idle hook the Terminal interface exposes (the
 * strongest signal). Council ruling (2026-05-31): the regex is a tentative UI
 * hint, NOT load-bearing arbitration — idle / read-idle is what flips the state
 * to confirmed. New output clears the state (no nervous banner flicker).
 *
 * Pure + clock-injected: no real timers live here. The sidecar calls
 * {@link WaitingForInputTracker.poll} on an interval; tests call it directly.
 */

/** Patterns that suggest a prompt is awaiting input (matched at end-of-output). */
export const INPUT_PROMPT_PATTERNS: readonly RegExp[] = [
  /\(y\/n\)\s*$/i,
  /\[y\/n\]\s*$/i,
  /\bpassword\b\s*:\s*$/i,
  /\bpassphrase\b\s*:\s*$/i,
  /:\s$/, // "Database host (default: localhost): "
  />\s$/, // REPL secondary prompt
  /\?\s$/, // "Continue? "
  /\$\s$/, // shell prompt awaiting a command
];

const PROMPT_TAIL_BYTES = 200;

/** True if the tail of `output` looks like an input prompt (ANSI-stripped). */
export function looksLikeInputPrompt(output: string): boolean {
  const stripped = stripAnsi(output);
  const tail = stripped.length > PROMPT_TAIL_BYTES ? stripped.slice(-PROMPT_TAIL_BYTES) : stripped;
  return INPUT_PROMPT_PATTERNS.some((re) => re.test(tail));
}

/** The detection state the UI maps to a banner: hidden / animated / solid. */
export type WaitingState = 'idle' | 'tentative' | 'confirmed';

export interface WaitingTrackerOptions {
  /** Idle window after a tentative hint before it confirms (ms, default 800). */
  idleMs?: number;
}

const DEFAULT_IDLE_MS = 800;

/**
 * State machine over the three strategies. `lastPromptText` carries the matched
 * tail so the manager can surface it as the pending-input prompt.
 */
export class WaitingForInputTracker {
  private readonly idleMs: number;
  private stateValue: WaitingState = 'idle';
  private lastOutputAt = 0;
  private tentativeSince: number | null = null;
  private promptText = '';

  constructor(options: WaitingTrackerOptions = {}) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  }

  get state(): WaitingState {
    return this.stateValue;
  }
  get lastPromptText(): string {
    return this.promptText;
  }

  /** Feed an output chunk. New output always clears a waiting state first. */
  onOutput(data: string, atMs: number): WaitingState {
    this.lastOutputAt = atMs;
    if (looksLikeInputPrompt(data)) {
      const stripped = stripAnsi(data).trimEnd();
      this.promptText = stripped.slice(stripped.lastIndexOf('\n') + 1).trim();
      // A heuristic match only ever raises a tentative hint; idle/read-idle confirms.
      if (this.stateValue === 'idle') {
        this.stateValue = 'tentative';
        this.tentativeSince = atMs;
      }
    } else {
      // Output that is not a prompt resumed → clear any waiting state.
      this.stateValue = 'idle';
      this.tentativeSince = null;
    }
    return this.stateValue;
  }

  /** Strategy (b): PTY signalled the child is blocked in read(). Strongest hint. */
  onReadIdle(): WaitingState {
    if (this.stateValue === 'tentative') this.stateValue = 'confirmed';
    else if (this.stateValue === 'idle') this.stateValue = 'tentative';
    return this.stateValue;
  }

  /** Strategy (c): called on an interval. Confirms a tentative hint after idle. */
  poll(atMs: number): WaitingState {
    if (this.stateValue === 'tentative' && this.tentativeSince !== null) {
      if (atMs - this.lastOutputAt >= this.idleMs) {
        this.stateValue = 'confirmed';
      }
    }
    return this.stateValue;
  }

  /** Reset after the pending input was answered. */
  clear(): void {
    this.stateValue = 'idle';
    this.tentativeSince = null;
    this.promptText = '';
  }
}
