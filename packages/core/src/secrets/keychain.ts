/**
 * T-205 — OS-Keychain integration (abstraction layer).
 *
 * Real implementations live on the IDE side: JetBrains uses the
 * `CredentialStore` API; VS Code uses `secrets`. The sidecar never reads
 * the OS keychain directly — the IDE pushes the secret in via an env var
 * at spawn time (per the roadmap: "never written to disk in plain text,
 * never logged").
 *
 * Two abstractions live here:
 *   1. `SecretStore` — the interface IDE adapters implement.
 *   2. `EnvSecretStore` — what the sidecar uses to read whatever the IDE
 *      already injected via process env.
 */

export interface SecretStore {
  /** Retrieve a stored secret. `undefined` when not set. */
  get(key: string): Promise<string | undefined>;
  /** Persist or overwrite a secret. */
  set(key: string, value: string): Promise<void>;
  /** Remove a stored secret. */
  delete(key: string): Promise<void>;
}

/**
 * Sidecar-side store that reads the secret from `process.env`. The IDE spawns
 * the sidecar with the secrets set in env vars (per the security model);
 * the sidecar never reads the OS keychain directly.
 *
 * `set`/`delete` mutate `process.env` for the lifetime of the sidecar — the
 * IDE owns persistence. The IDE-side adapter is the actual `SecretStore`
 * that talks to the OS.
 */
export class EnvSecretStore implements SecretStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  // Map agent-internal secret keys to env-var names. The roadmap names two
  // explicit secrets in MVP: the Anthropic API key and (later) the OpenAI
  // key in v1.0 Sprint 5.
  private readonly envNames: Record<string, string> = {
    'anthropic.api_key': 'ANTHROPIC_API_KEY',
    'openai.api_key': 'OPENAI_API_KEY',
  };

  async get(key: string): Promise<string | undefined> {
    const envName = this.envNames[key] ?? key;
    const value = this.env[envName];
    return value && value.length > 0 ? value : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    const envName = this.envNames[key] ?? key;
    this.env[envName] = value;
  }

  async delete(key: string): Promise<void> {
    const envName = this.envNames[key] ?? key;
    delete this.env[envName];
  }
}

/**
 * In-memory store for tests + scratch sessions. Never persists. Useful as
 * the unit-test fixture and as a fallback when no real keychain is wired
 * (the chat will fail at the first API call with a clear error).
 */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Diagnostics — `secretAvailable('anthropic.api_key')` is what the chat UI
 * uses to gate the send button when the API key is missing.
 */
export async function secretAvailable(store: SecretStore, key: string): Promise<boolean> {
  return (await store.get(key)) !== undefined;
}
