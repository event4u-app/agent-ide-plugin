/**
 * T-505 — CLI capability manifest contract (PLAN.md §9.11.2).
 *
 * A manifest is the static, author-curated description of one agent-CLI's
 * surface: how to abort it, how to run it non-interactively, whether it
 * exposes slash-commands / model-switch / permission-modes / verbosity, and
 * where its session files live. The CLI-detection service (T-504) attaches the
 * matching manifest to each detected CLI so the Mode toggle (MVP T-407) and the
 * backends (T-502/T-503) read capabilities from one place instead of
 * hard-coding flags.
 *
 * Each concrete manifest records the CLI version + date it was verified against
 * in a header comment, so a refresh is mechanical when the CLI churns.
 */

/** How an in-flight streaming run is cancelled. */
export type AbortMethod = 'sigterm' | 'sigint' | 'stdin-close';

export interface CliCapabilityManifest {
  /** Stable CLI id, matches the backend `id` prefix. */
  readonly id: 'claude' | 'codex' | 'gemini';
  /** Default binary name on PATH. */
  readonly binary: string;
  /** Args that print the version string. */
  readonly versionArgs: readonly string[];
  /** Minimum supported semver; below this the CLI is treated as unavailable. */
  readonly minVersion: string;
  /** CLI version the manifest was authored/verified against. */
  readonly verifiedVersion: string;
  /** ISO date (YYYY-MM-DD) the manifest was verified. */
  readonly verifiedDate: string;
  /** Args producing a newline-delimited JSON event stream (non-interactive). */
  readonly streamArgs: readonly string[];
  /** How the backend cancels a run. */
  readonly abort: AbortMethod;
  /** Does the CLI expose forwardable slash-commands? */
  readonly slashCommands: boolean;
  /** Model-switch flag, if the CLI supports it. */
  readonly modelSwitch: { readonly supported: boolean; readonly flag?: string };
  /** Permission / sandbox / approval modes the CLI accepts. */
  readonly permissionModes: readonly string[];
  /** Verbosity control, if any. */
  readonly verbosity: { readonly supported: boolean; readonly flag?: string };
  /** Session-resume surface + the JSON field carrying the session id. */
  readonly session: {
    readonly idField: string;
    readonly resumeFlag?: string;
  };
  /** Auth probe: args run with a short timeout + the user-facing hint on failure. */
  readonly auth: { readonly probeArgs: readonly string[]; readonly hint: string };
}
