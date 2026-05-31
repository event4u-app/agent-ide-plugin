import { describe, expect, it } from 'vitest';
import type { LlmRequest, LlmStreamEvent } from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';
import {
  ProviderNotConfiguredError,
  ProviderRegistry,
  type ProviderSpec,
  builtinProviderSpecs,
  canonicalProviderId,
} from './provider-registry.js';

/** A no-op backend; identity is asserted via its `id`. */
function fakeBackend(id: string): LlmBackend {
  return {
    id,
    mode: 'api',
    // eslint-disable-next-line require-yield
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamEvent> {
      throw new Error('not used in registry tests');
    },
  };
}

/** Spec that needs `FAKE_KEY` (API-shaped) — throws when absent. */
const keyedSpec: ProviderSpec = {
  id: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  modelEnv: 'EVENT4U_ANTHROPIC_MODEL',
  build: (env) => {
    if (!env.FAKE_KEY) throw new Error('missing API key: set FAKE_KEY');
    return fakeBackend('anthropic-be');
  },
};

/** Spec that always builds (CLI-shaped). */
const cliSpec: ProviderSpec = {
  id: 'claude-cli',
  defaultModel: 'claude-sonnet-4-6',
  modelEnv: 'EVENT4U_CLAUDE_CLI_MODEL',
  build: () => fakeBackend('claude-cli-be'),
};

const specs = [keyedSpec, cliSpec];

describe('canonicalProviderId', () => {
  it('trims and lower-cases', () => {
    expect(canonicalProviderId('  Anthropic ')).toBe('anthropic');
    expect(canonicalProviderId('Claude-CLI')).toBe('claude-cli');
  });
});

describe('ProviderRegistry — resolution', () => {
  it('resolves the explicit provider when configured', () => {
    const reg = new ProviderRegistry({ env: { FAKE_KEY: 'k' }, providers: specs });
    expect(reg.resolveBackend('anthropic').id).toBe('anthropic-be');
    expect(reg.resolveBackend('claude-cli').id).toBe('claude-cli-be');
  });

  it('canonicalises the requested provider id', () => {
    const reg = new ProviderRegistry({ env: { FAKE_KEY: 'k' }, providers: specs });
    expect(reg.resolveBackend(' Anthropic ').id).toBe('anthropic-be');
  });

  it('falls back to the default provider when none is requested', () => {
    const reg = new ProviderRegistry({
      env: { FAKE_KEY: 'k' },
      providers: specs,
      defaultProvider: 'claude-cli',
    });
    expect(reg.default).toBe('claude-cli');
    expect(reg.resolveBackend().id).toBe('claude-cli-be');
  });

  it('reads the default provider from EVENT4U_DEFAULT_PROVIDER', () => {
    const reg = new ProviderRegistry({
      env: { FAKE_KEY: 'k', EVENT4U_DEFAULT_PROVIDER: 'Claude-CLI' },
      providers: specs,
    });
    expect(reg.default).toBe('claude-cli');
    expect(reg.resolveBackend().id).toBe('claude-cli-be');
  });
});

describe('ProviderRegistry — fail-open + errors', () => {
  it('isolates a per-provider config error instead of throwing globally', () => {
    const reg = new ProviderRegistry({ env: {}, providers: specs });
    // anthropic could not build (no key) but the CLI provider still did.
    expect(reg.available()).toEqual(['claude-cli']);
    expect(reg.configErrors().anthropic).toContain('FAKE_KEY');
    expect(reg.resolveBackend('claude-cli').id).toBe('claude-cli-be');
  });

  it('throws provider_not_configured for an unconfigured provider', () => {
    const reg = new ProviderRegistry({ env: {}, providers: specs });
    try {
      reg.resolveBackend('anthropic');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect((err as ProviderNotConfiguredError).code).toBe('provider_not_configured');
      expect((err as Error).message).toContain('FAKE_KEY');
    }
  });

  it('throws provider_not_configured for an unknown provider', () => {
    const reg = new ProviderRegistry({ env: { FAKE_KEY: 'k' }, providers: specs });
    try {
      reg.resolveBackend('does-not-exist');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect((err as Error).message).toContain('unknown provider');
    }
  });

  it('throws when the default provider itself is unconfigured', () => {
    const reg = new ProviderRegistry({ env: {}, providers: specs, defaultProvider: 'anthropic' });
    expect(() => reg.resolveBackend()).toThrow(ProviderNotConfiguredError);
  });
});

describe('ProviderRegistry — model resolution', () => {
  it('returns the spec default model', () => {
    const reg = new ProviderRegistry({ env: { FAKE_KEY: 'k' }, providers: specs });
    expect(reg.resolveModel('anthropic')).toBe('claude-sonnet-4-6');
  });

  it('honours the per-provider env override', () => {
    const reg = new ProviderRegistry({
      env: { FAKE_KEY: 'k', EVENT4U_ANTHROPIC_MODEL: 'claude-opus-4-8' },
      providers: specs,
    });
    expect(reg.resolveModel('anthropic')).toBe('claude-opus-4-8');
  });

  it('derives an override env var for an unknown provider, else empty string', () => {
    const reg = new ProviderRegistry({
      env: { EVENT4U_SOME_THING_MODEL: 'x' },
      providers: specs,
    });
    expect(reg.resolveModel('some-thing')).toBe('x');
    expect(reg.resolveModel('other')).toBe('');
  });
});

describe('builtinProviderSpecs', () => {
  it('ships the five built-in providers with their canonical ids + models', () => {
    const byId = Object.fromEntries(builtinProviderSpecs().map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual([
      'anthropic',
      'claude-cli',
      'codex-cli',
      'gemini-cli',
      'openai',
    ]);
    expect(byId.anthropic.defaultModel).toBe('claude-sonnet-4-6');
    expect(byId.openai.defaultModel).toBe('gpt-5');
    expect(byId['codex-cli'].defaultModel).toBe('gpt-5-codex');
    expect(byId['gemini-cli'].defaultModel).toBe('gemini-3-pro');
  });

  it('with no API keys: CLI providers build, API providers record errors (never empty)', () => {
    const reg = new ProviderRegistry({ env: {} });
    // CLI backends always construct; the registry is never empty.
    expect(reg.available().sort()).toEqual(['claude-cli', 'codex-cli', 'gemini-cli']);
    expect(reg.configErrors().anthropic).toContain('ANTHROPIC_API_KEY');
    expect(reg.configErrors().openai).toContain('OPENAI_API_KEY');
    expect(reg.resolveModel('anthropic')).toBe('claude-sonnet-4-6');
  });
});
