import { CLI_MANIFESTS, type CliCapabilityManifest } from '../llm/cli/manifests/index.js';
import {
  type DetectionProbe,
  compareSemver,
  defaultDetectionProbe,
  extractSemver,
} from './claude-detection.js';

/**
 * T-504 — CLI detection extended to claude + codex + gemini.
 *
 * Generalises the MVP T-405 claude-only probe: each CLI is described by its
 * capability manifest (T-505), and detection runs the same three stages
 * (resolve path → version probe → auth probe) against the manifest's args.
 * The result carries the manifest reference so the Mode toggle (T-407) and the
 * backends read capabilities from one place.
 */

const PROBE_TIMEOUT_MS = 2000;

export interface CliDetection {
  readonly id: CliCapabilityManifest['id'];
  available: boolean;
  path?: string;
  version?: string;
  signedIn?: boolean;
  /** Diagnostic — populated on failure paths. */
  reason?: string;
  /** The capability manifest for this CLI. */
  readonly manifest: CliCapabilityManifest;
}

/** Detect a single CLI from its manifest. */
export async function detectCli(
  manifest: CliCapabilityManifest,
  probe: DetectionProbe = defaultDetectionProbe,
): Promise<CliDetection> {
  const path = await probe.which(manifest.binary);
  if (!path) {
    return {
      id: manifest.id,
      available: false,
      reason: `${manifest.binary} not on PATH`,
      manifest,
    };
  }

  const versionRun = await probe.exec(path, [...manifest.versionArgs], PROBE_TIMEOUT_MS);
  if (versionRun.timedOut || versionRun.exitCode !== 0) {
    return {
      id: manifest.id,
      available: false,
      path,
      reason: versionRun.timedOut ? 'version probe timed out' : 'version probe non-zero exit',
      manifest,
    };
  }
  const version = extractSemver(versionRun.stdout);
  if (!version) {
    return {
      id: manifest.id,
      available: false,
      path,
      reason: `could not parse version from ${versionRun.stdout.trim()}`,
      manifest,
    };
  }
  if (compareSemver(version, manifest.minVersion) < 0) {
    return {
      id: manifest.id,
      available: false,
      path,
      version,
      reason: `${manifest.binary} ${version} below required ${manifest.minVersion}`,
      manifest,
    };
  }

  const authRun = await probe.exec(path, [...manifest.auth.probeArgs], PROBE_TIMEOUT_MS);
  const signedIn = !authRun.timedOut && authRun.exitCode === 0;
  return {
    id: manifest.id,
    available: true,
    path,
    version,
    signedIn,
    reason: signedIn ? undefined : `auth probe failed (${manifest.auth.hint})`,
    manifest,
  };
}

/** Detect every shipped CLI (claude, codex, gemini) in parallel. */
export async function detectAllClis(
  probe: DetectionProbe = defaultDetectionProbe,
): Promise<Record<CliCapabilityManifest['id'], CliDetection>> {
  const entries = await Promise.all(
    Object.values(CLI_MANIFESTS).map(async (m) => [m.id, await detectCli(m, probe)] as const),
  );
  return Object.fromEntries(entries) as Record<CliCapabilityManifest['id'], CliDetection>;
}
