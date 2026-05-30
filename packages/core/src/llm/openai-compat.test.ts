import { describe, expect, it } from 'vitest';
import type { CompatProvider } from '../config/agent-settings.js';
import {
  CompatConfigError,
  createCompatBackends,
  createOpenAiCompatBackend,
  defaultApiKeyEnv,
} from './openai-compat.js';

const groq: CompatProvider = { id: 'groq', base_url: 'https://api.groq.com/openai/v1' };

describe('defaultApiKeyEnv', () => {
  it('upper-snakes the provider id', () => {
    expect(defaultApiKeyEnv('groq')).toBe('GROQ_API_KEY');
    expect(defaultApiKeyEnv('open-router')).toBe('OPEN_ROUTER_API_KEY');
  });
});

describe('createOpenAiCompatBackend', () => {
  it('builds an OpenAI backend with the provider id and resolved key', () => {
    const backend = createOpenAiCompatBackend({ provider: groq, env: { GROQ_API_KEY: 'k' } });
    expect(backend.id).toBe('groq');
    expect(backend.mode).toBe('api');
  });

  it('honours an explicit api_key_env', () => {
    const provider: CompatProvider = { ...groq, api_key_env: 'MY_KEY' };
    const backend = createOpenAiCompatBackend({ provider, env: { MY_KEY: 'k' } });
    expect(backend.id).toBe('groq');
  });

  it('throws CompatConfigError when the key env is unset', () => {
    expect(() => createOpenAiCompatBackend({ provider: groq, env: {} })).toThrow(CompatConfigError);
  });
});

describe('createCompatBackends', () => {
  it('isolates per-provider config errors', () => {
    const providers: CompatProvider[] = [
      groq,
      { id: 'together', base_url: 'https://api.together.xyz/v1' },
    ];
    const { backends, errors } = createCompatBackends(providers, { GROQ_API_KEY: 'k' });
    expect(Object.keys(backends)).toEqual(['groq']);
    expect(errors.together).toMatch(/TOGETHER_API_KEY/);
  });
});
