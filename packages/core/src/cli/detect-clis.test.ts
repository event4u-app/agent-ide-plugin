import { describe, expect, it } from 'vitest';
import type { DetectionProbe } from './claude-detection.js';
import { codexManifest, geminiManifest } from '../llm/cli/manifests/index.js';
import { detectAllClis, detectCli } from './detect-clis.js';

/** Build a probe from a per-binary script of which/exec answers. */
function makeProbe(spec: {
  which: Record<string, string | undefined>;
  version: Record<string, string>;
  auth?: Record<string, number>;
}): DetectionProbe {
  return {
    which: (name) => Promise.resolve(spec.which[name]),
    exec: (bin, args) => {
      // version probe: any binary whose args are the version flag(s).
      const isVersion = args.includes('--version');
      if (isVersion) {
        const out = Object.entries(spec.version).find(([b]) => bin.includes(b))?.[1] ?? '';
        return Promise.resolve({
          stdout: out,
          stderr: '',
          exitCode: out ? 0 : 1,
          timedOut: false,
        });
      }
      const authExit = Object.entries(spec.auth ?? {}).find(([b]) => bin.includes(b))?.[1] ?? 0;
      return Promise.resolve({ stdout: '', stderr: '', exitCode: authExit, timedOut: false });
    },
  };
}

describe('detectCli', () => {
  it('reports available + signedIn for a healthy codex install', async () => {
    const probe = makeProbe({
      which: { codex: '/usr/local/bin/codex' },
      version: { codex: 'codex-cli 0.134.0' },
      auth: { codex: 0 },
    });
    const result = await detectCli(codexManifest, probe);
    expect(result).toMatchObject({
      id: 'codex',
      available: true,
      version: '0.134.0',
      signedIn: true,
    });
    expect(result.manifest).toBe(codexManifest);
  });

  it('reports unavailable when the binary is not on PATH', async () => {
    const probe = makeProbe({ which: {}, version: {} });
    const result = await detectCli(geminiManifest, probe);
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not on PATH/);
  });

  it('reports unavailable + reason when the version is below the floor', async () => {
    const probe = makeProbe({
      which: { codex: '/bin/codex' },
      version: { codex: 'codex-cli 0.1.0' },
    });
    const result = await detectCli(codexManifest, probe);
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/below required/);
  });

  it('surfaces an auth hint when the auth probe fails', async () => {
    const probe = makeProbe({
      which: { codex: '/bin/codex' },
      version: { codex: 'codex-cli 0.134.0' },
      auth: { codex: 1 },
    });
    const result = await detectCli(codexManifest, probe);
    expect(result.available).toBe(true);
    expect(result.signedIn).toBe(false);
    expect(result.reason).toMatch(/codex login/);
  });
});

describe('detectAllClis', () => {
  it('returns a result keyed by every shipped CLI id', async () => {
    const probe = makeProbe({
      which: { claude: '/b/claude', codex: '/b/codex', gemini: '/b/gemini' },
      version: { claude: 'claude 1.2.3', codex: 'codex-cli 0.134.0', gemini: '0.41.2' },
    });
    const all = await detectAllClis(probe);
    expect(Object.keys(all).sort()).toEqual(['claude', 'codex', 'gemini']);
    expect(all.claude.available).toBe(true);
    expect(all.codex.available).toBe(true);
    expect(all.gemini.available).toBe(true);
  });
});
