import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  detectClaudeCli,
  extractSemver,
  type DetectionProbe,
} from './claude-detection.js';

function probe(
  opts: {
    whichPath?: string;
    version?: string;
    versionExit?: number;
    versionTimeout?: boolean;
    authExit?: number;
    authTimeout?: boolean;
  } = {},
): DetectionProbe {
  return {
    which: () => Promise.resolve(opts.whichPath),
    exec(_bin, args, _timeoutMs) {
      if (args[0] === '--version') {
        return Promise.resolve({
          stdout: opts.version ?? '',
          stderr: '',
          exitCode: opts.versionExit ?? 0,
          timedOut: !!opts.versionTimeout,
        });
      }
      return Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: opts.authExit ?? 0,
        timedOut: !!opts.authTimeout,
      });
    },
  };
}

describe('detectClaudeCli', () => {
  it('reports unavailable when claude is not on PATH', async () => {
    expect(await detectClaudeCli(probe())).toEqual({
      available: false,
      reason: 'claude not on PATH',
    });
  });

  it('reports unavailable on version probe timeout', async () => {
    const result = await detectClaudeCli(
      probe({ whichPath: '/usr/bin/claude', versionTimeout: true }),
    );
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/timed out/);
  });

  it('reports unavailable when version is below the minimum', async () => {
    const result = await detectClaudeCli(
      probe({ whichPath: '/usr/bin/claude', version: 'claude 0.5.0' }),
    );
    expect(result.available).toBe(false);
    expect(result.version).toBe('0.5.0');
    expect(result.reason).toMatch(/below required/);
  });

  it('reports available + signed in when auth probe succeeds', async () => {
    const result = await detectClaudeCli(
      probe({ whichPath: '/usr/bin/claude', version: 'claude 0.10.0' }),
    );
    expect(result).toMatchObject({
      available: true,
      path: '/usr/bin/claude',
      version: '0.10.0',
      signedIn: true,
    });
  });

  it('reports available but not signed in when auth probe fails', async () => {
    const result = await detectClaudeCli(
      probe({ whichPath: '/usr/bin/claude', version: 'claude 0.10.0', authExit: 1 }),
    );
    expect(result.available).toBe(true);
    expect(result.signedIn).toBe(false);
    expect(result.reason).toMatch(/auth probe failed/);
  });
});

describe('extractSemver', () => {
  it('extracts X.Y.Z from claude --version output', () => {
    expect(extractSemver('claude version 1.2.3 (build abc)')).toBe('1.2.3');
  });

  it('returns undefined when no semver appears', () => {
    expect(extractSemver('not a version')).toBeUndefined();
  });
});

describe('compareSemver', () => {
  it.each([
    ['0.9.0', '0.10.0', -1],
    ['0.10.0', '0.10.0', 0],
    ['1.0.0', '0.99.0', 1],
    ['0.10.1', '0.10.0', 1],
  ])('%s vs %s → sign of %i', (a, b, sign) => {
    expect(Math.sign(compareSemver(a, b))).toBe(Math.sign(sign));
  });
});
