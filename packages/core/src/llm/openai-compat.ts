import type { CompatProvider } from '../config/agent-settings.js';
import { OpenAiApiBackend } from './openai-api.js';

/**
 * T-506 — OpenAI-compatible HTTP backend (Mistral / Together / Groq /
 * OpenRouter / self-hosted).
 *
 * These endpoints speak the OpenAI Chat Completions wire format, so the backend
 * *is* `OpenAiApiBackend` pointed at the configured `base_url` with the
 * provider id as its telemetry id. This module is the thin factory that reads
 * the endpoint config from `.agent-settings.yml::llm.providers[]`, resolves the
 * bearer token from the named environment variable (never inlined in YAML), and
 * constructs the backend. Pricing comes from `prices.yml::custom_endpoints`.
 */

export class CompatConfigError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
  ) {
    super(message);
    this.name = 'CompatConfigError';
  }
}

/** Default env-var name for a provider id, e.g. `groq` → `GROQ_API_KEY`. */
export function defaultApiKeyEnv(id: string): string {
  return `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

export interface CreateCompatBackendOptions {
  provider: CompatProvider;
  /** Env lookup; defaults to `process.env`. Injected for tests. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build one compat backend. Throws {@link CompatConfigError} when the API key
 * env var is unset — callers surface this as a configuration problem rather
 * than letting an unauthenticated request fail at stream time.
 */
export function createOpenAiCompatBackend(opts: CreateCompatBackendOptions): OpenAiApiBackend {
  const env = opts.env ?? process.env;
  const keyEnv = opts.provider.api_key_env ?? defaultApiKeyEnv(opts.provider.id);
  const apiKey = env[keyEnv];
  if (!apiKey) {
    throw new CompatConfigError(
      `missing API key: set ${keyEnv} for provider "${opts.provider.id}"`,
      opts.provider.id,
    );
  }
  return new OpenAiApiBackend({
    apiKey,
    baseURL: opts.provider.base_url,
    id: opts.provider.id,
  });
}

export interface CompatBackendsResult {
  /** Successfully constructed backends, keyed by provider id. */
  backends: Record<string, OpenAiApiBackend>;
  /** Config errors (e.g. missing key) keyed by provider id — surfaced, not thrown. */
  errors: Record<string, string>;
}

/**
 * Build every configured compat backend, isolating per-provider config errors
 * so one misconfigured endpoint does not block the others.
 */
export function createCompatBackends(
  providers: CompatProvider[],
  env: NodeJS.ProcessEnv = process.env,
): CompatBackendsResult {
  const backends: Record<string, OpenAiApiBackend> = {};
  const errors: Record<string, string> = {};
  for (const provider of providers) {
    try {
      backends[provider.id] = createOpenAiCompatBackend({ provider, env });
    } catch (err) {
      errors[provider.id] = err instanceof Error ? err.message : String(err);
    }
  }
  return { backends, errors };
}
