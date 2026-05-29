import { spawn } from 'node:child_process';

/**
 * T-405 — Claude CLI detection. Runs on plugin start; result feeds the Mode
 * toggle in T-407.
 *
 *   1. `which claude` → path
 *   2. `claude --version` → semver
 *   3. light auth probe (`claude config get` with timeout) → signed in?
 *
 * Each probe carries a 2s timeout per CliCapabilities manifest. Failure of
 * any stage falls back to `mode: "api"`.
 */

export interface ClaudeCliDetection {
  available: boolean;
  path?: string;
  version?: string;
  signedIn?: boolean;
  /** Diagnostic — populated on failure paths. */
  reason?: string;
}

const PROBE_TIMEOUT_MS = 2000;
const MIN_SEMVER = '0.10.0';

export interface DetectionProbe {
  /** Resolve a binary path; mirrors `which <name>`. */
  which(name: string): Promise<string | undefined>;
  /** Execute the resolved binary with timeout. */
  exec(
    bin: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>;
}

export const defaultDetectionProbe: DetectionProbe = {
  which(name) {
    return new Promise((resolve) => {
      const child = spawn(process.platform === 'win32' ? 'where' : 'which', [name], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => (out += d));
      child.on('close', (code) => {
        if (code !== 0) resolve(undefined);
        else resolve(out.split('\n')[0]?.trim() || undefined);
      });
      child.on('error', () => resolve(undefined));
    });
  },
  exec(bin, args, timeoutMs) {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d: string) => (stdout += d));
      child.stderr.on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ stdout, stderr, exitCode: -1, timedOut: true });
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0, timedOut: false });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: String(err), exitCode: 127, timedOut: false });
      });
    });
  },
};

export async function detectClaudeCli(
  probe: DetectionProbe = defaultDetectionProbe,
): Promise<ClaudeCliDetection> {
  const path = await probe.which('claude');
  if (!path) return { available: false, reason: 'claude not on PATH' };

  const versionRun = await probe.exec(path, ['--version'], PROBE_TIMEOUT_MS);
  if (versionRun.timedOut || versionRun.exitCode !== 0) {
    return {
      available: false,
      path,
      reason: versionRun.timedOut ? 'version probe timed out' : 'version probe non-zero exit',
    };
  }
  const version = extractSemver(versionRun.stdout);
  if (!version) {
    return {
      available: false,
      path,
      reason: `could not parse version from ${versionRun.stdout.trim()}`,
    };
  }
  if (compareSemver(version, MIN_SEMVER) < 0) {
    return {
      available: false,
      path,
      version,
      reason: `claude ${version} below required ${MIN_SEMVER}`,
    };
  }

  const authRun = await probe.exec(path, ['config', 'get'], PROBE_TIMEOUT_MS);
  const signedIn = !authRun.timedOut && authRun.exitCode === 0;
  return {
    available: true,
    path,
    version,
    signedIn,
    reason: signedIn ? undefined : 'auth probe failed (run `claude login`)',
  };
}

export function extractSemver(text: string): string | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : undefined;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}
