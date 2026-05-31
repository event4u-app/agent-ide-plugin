import { describe, expect, it } from 'vitest';
import { type DetectProbes, MIN_NODE_MAJOR, detectReadiness } from './detect.js';

/** Build probes from a partial spec; unset facts default to "absent". */
function probes(spec: {
  nodeVersion?: string | null;
  env?: Record<string, string>;
  commands?: string[];
}): DetectProbes {
  const env = spec.env ?? {};
  const commands = new Set(spec.commands ?? []);
  return {
    nodeVersion: () => (spec.nodeVersion === undefined ? null : spec.nodeVersion),
    env: (name) => env[name],
    commandExists: (command) => commands.has(command),
  };
}

describe('detectReadiness', () => {
  it('is ready with a recent Node and an Anthropic key (api mode)', () => {
    const r = detectReadiness(
      probes({ nodeVersion: '20.11.1', env: { ANTHROPIC_API_KEY: 'sk-ant-123' } }),
    );
    expect(r.node).toEqual({ version: '20.11.1', major: 20, ok: true });
    expect(r.anthropicKey).toBe(true);
    expect(r.recommendedMode).toBe('api');
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('prefers api over cli when both are present', () => {
    const r = detectReadiness(
      probes({ nodeVersion: 'v22.3.0', env: { ANTHROPIC_API_KEY: 'k' }, commands: ['claude'] }),
    );
    expect(r.recommendedMode).toBe('api');
    expect(r.ready).toBe(true);
  });

  it('falls back to keyless cli mode when only the Claude CLI is present', () => {
    const r = detectReadiness(probes({ nodeVersion: '20.0.0', commands: ['claude'] }));
    expect(r.anthropicKey).toBe(false);
    expect(r.claudeCli).toBe(true);
    expect(r.recommendedMode).toBe('cli');
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('treats a blank ANTHROPIC_API_KEY as absent', () => {
    const r = detectReadiness(probes({ nodeVersion: '20.0.0', env: { ANTHROPIC_API_KEY: '   ' } }));
    expect(r.anthropicKey).toBe(false);
    expect(r.recommendedMode).toBe('none');
    expect(r.ready).toBe(false);
  });

  it('blocks when no Node runtime is found', () => {
    const r = detectReadiness(probes({ nodeVersion: null, env: { ANTHROPIC_API_KEY: 'k' } }));
    expect(r.node).toEqual({ version: null, major: null, ok: false });
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toContain('No Node runtime');
  });

  it('blocks when Node is too old, naming the version', () => {
    const r = detectReadiness(probes({ nodeVersion: '18.19.0', env: { ANTHROPIC_API_KEY: 'k' } }));
    expect(r.node.major).toBe(18);
    expect(r.node.ok).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toContain('18.19.0');
    expect(r.blockers[0]).toContain(String(MIN_NODE_MAJOR));
  });

  it('blocks when no provider path exists, even with a good Node', () => {
    const r = detectReadiness(probes({ nodeVersion: '20.0.0' }));
    expect(r.recommendedMode).toBe('none');
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toContain('No provider');
  });

  it('orders blockers Node-first when both fail', () => {
    const r = detectReadiness(probes({ nodeVersion: '16.0.0' }));
    expect(r.blockers).toHaveLength(2);
    expect(r.blockers[0]).toContain('too old');
    expect(r.blockers[1]).toContain('No provider');
  });

  it('tolerates an unparseable version string', () => {
    const r = detectReadiness(
      probes({ nodeVersion: 'not-a-version', env: { ANTHROPIC_API_KEY: 'k' } }),
    );
    expect(r.node).toEqual({ version: 'not-a-version', major: null, ok: false });
    expect(r.ready).toBe(false);
  });
});
