import { describe, expect, it } from 'vitest';
import { EnvSecretStore, MemorySecretStore, secretAvailable } from './keychain.js';

describe('MemorySecretStore', () => {
  it('round-trips a secret', async () => {
    const store = new MemorySecretStore();
    await store.set('k', 'v');
    expect(await store.get('k')).toBe('v');
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });
});

describe('EnvSecretStore', () => {
  it('maps anthropic.api_key to ANTHROPIC_API_KEY', async () => {
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-xxx' };
    const store = new EnvSecretStore(env);
    expect(await store.get('anthropic.api_key')).toBe('sk-xxx');
  });

  it('returns undefined when the env var is empty / missing', async () => {
    const store = new EnvSecretStore({ ANTHROPIC_API_KEY: '' });
    expect(await store.get('anthropic.api_key')).toBeUndefined();
  });

  it('falls through to raw env name for unmapped keys', async () => {
    const env: NodeJS.ProcessEnv = { CUSTOM_TOKEN: 'token' };
    const store = new EnvSecretStore(env);
    expect(await store.get('CUSTOM_TOKEN')).toBe('token');
  });

  it('set + delete mutate env in place', async () => {
    const env: NodeJS.ProcessEnv = {};
    const store = new EnvSecretStore(env);
    await store.set('anthropic.api_key', 'sk-yyy');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-yyy');
    await store.delete('anthropic.api_key');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('secretAvailable', () => {
  it('returns true when the secret is set', async () => {
    const store = new MemorySecretStore();
    await store.set('k', 'v');
    expect(await secretAvailable(store, 'k')).toBe(true);
  });

  it('returns false when the secret is missing', async () => {
    expect(await secretAvailable(new MemorySecretStore(), 'k')).toBe(false);
  });
});
