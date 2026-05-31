import { z } from 'zod';

/**
 * T-PRD12 — onboarding environment detection (pure core).
 *
 * A packaged plugin (no repo checkout) must be able to tell, on first run,
 * whether the host can actually run the agent: is there a Node runtime new
 * enough to host the sidecar, is an Anthropic key present, is the Claude CLI
 * on PATH. This module answers that as a pure, side-effect-free derivation over
 * INJECTED probes — the wizard UI (VS Code webview / JetBrains Swing) and the
 * live test-ping that proves the round-trip stay IDE-runtime/deferred (`[~]`).
 *
 * It is also the core backing for the "Node ≥ 20 required" startup error the
 * JetBrains packaging path needs (AI council 2026-05-31, UNANIMOUS Fork 4A:
 * spawn system `node`, surface a clear error when absent) — both reviewers
 * flagged Node-runtime asymmetry between the two IDEs as the slice's biggest
 * risk, and a single shared detection contract is the mitigation (ADR-017).
 *
 * No process spawning, no fs, no network here: the host supplies the facts via
 * {@link DetectProbes} so every branch is deterministic under unit test.
 */

/** Minimum Node major the sidecar bundle targets (esbuild `--target=node20`). */
export const MIN_NODE_MAJOR = 20;

export const NodeReadinessSchema = z.object({
  /** Raw version string the probe reported (e.g. `20.11.1`), or null if no Node was found. */
  version: z.string().nullable(),
  /** Parsed major version, or null when the version string was missing / unparseable. */
  major: z.number().int().nullable(),
  /** True when a Node runtime ≥ {@link MIN_NODE_MAJOR} is available. */
  ok: z.boolean(),
});
export type NodeReadiness = z.infer<typeof NodeReadinessSchema>;

/** Which agent mode the detected environment can actually drive, best-first. */
export const RecommendedModeSchema = z.enum(['api', 'cli', 'none']);
export type RecommendedMode = z.infer<typeof RecommendedModeSchema>;

export const ReadinessReportSchema = z.object({
  node: NodeReadinessSchema,
  /** A non-empty `ANTHROPIC_API_KEY` is visible to the host environment. */
  anthropicKey: z.boolean(),
  /** The `claude` CLI is resolvable on PATH. */
  claudeCli: z.boolean(),
  /**
   * Best mode the environment can run right now:
   * `api` (key present) > `cli` (Claude CLI present) > `none`.
   * `none` only ever pairs with `ready: false`.
   */
  recommendedMode: RecommendedModeSchema,
  /**
   * True when the agent can run at all: a usable Node runtime AND at least one
   * provider path (key or CLI). The wizard gates "you're ready" on this.
   */
  ready: z.boolean(),
  /** Human-orderable blockers, most-fundamental first. Empty when `ready`. */
  blockers: z.array(z.string()),
});
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;

/**
 * Injected facts about the host. The host wires these to real probes
 * (`process.versions.node`, `process.env`, a PATH lookup); tests pin them.
 */
export interface DetectProbes {
  /** The host Node version string, or null if none could be found. */
  nodeVersion: () => string | null;
  /** Read an environment variable (undefined when unset). */
  env: (name: string) => string | undefined;
  /** True when `command` resolves on PATH. */
  commandExists: (command: string) => boolean;
}

/** Parse a `major` out of a semver-ish version string; null when unparseable. */
function parseMajor(version: string | null): number | null {
  if (version === null) return null;
  const match = /^v?(\d+)\./.exec(version.trim());
  const captured = match?.[1];
  if (captured === undefined) return null;
  const major = Number.parseInt(captured, 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * Derive a {@link ReadinessReport} from the injected probes. Pure: same probes
 * in, same report out.
 */
export function detectReadiness(probes: DetectProbes): ReadinessReport {
  const version = probes.nodeVersion();
  const major = parseMajor(version);
  const nodeOk = major !== null && major >= MIN_NODE_MAJOR;
  const node: NodeReadiness = { version, major, ok: nodeOk };

  const keyRaw = probes.env('ANTHROPIC_API_KEY');
  const anthropicKey = keyRaw !== undefined && keyRaw.trim().length > 0;
  const claudeCli = probes.commandExists('claude');

  const recommendedMode: RecommendedMode = anthropicKey ? 'api' : claudeCli ? 'cli' : 'none';

  const blockers: string[] = [];
  if (!nodeOk) {
    blockers.push(
      version === null
        ? `No Node runtime found. The agent sidecar needs Node ${MIN_NODE_MAJOR}+ on PATH.`
        : `Node ${version} is too old. The agent sidecar needs Node ${MIN_NODE_MAJOR}+.`,
    );
  }
  if (recommendedMode === 'none') {
    blockers.push(
      'No provider configured. Set ANTHROPIC_API_KEY or install the Claude CLI (keyless CLI mode).',
    );
  }

  const ready = nodeOk && recommendedMode !== 'none';
  return { node, anthropicKey, claudeCli, recommendedMode, ready, blockers };
}
