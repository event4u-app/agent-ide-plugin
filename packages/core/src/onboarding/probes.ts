import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { DetectProbes } from './detect.js';

/**
 * Real host probes for {@link detectReadiness}: the running Node version, the
 * process environment, and a spawn-free PATH lookup. Kept OUT of `detect.ts`
 * so that module stays pure and side-effect-free (every branch unit-testable
 * with pinned probes); this is the one place that touches the live host.
 *
 * No `child_process`, no native module — the PATH lookup is plain `fs`
 * (no-native-deps law), so it runs identically on every CI matrix OS.
 */
export function defaultDetectProbes(): DetectProbes {
  return {
    // The sidecar always runs under Node, so `process.versions.node` is the
    // host runtime hosting it — exactly the version the readiness gate checks.
    nodeVersion: () => process.versions.node ?? null,
    env: (name: string) => process.env[name],
    commandExists,
  };
}

/**
 * True when `command` resolves on PATH. Pure `fs` — walks `PATH` entries and
 * tests for an existing file (with `PATHEXT` extensions on Windows). No spawn.
 */
function commandExists(command: string): boolean {
  const path = process.env.PATH;
  if (path === undefined || path.length === 0) return false;
  const extensions =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const extension of extensions) {
      if (existsSync(join(dir, command + extension))) return true;
    }
  }
  return false;
}
