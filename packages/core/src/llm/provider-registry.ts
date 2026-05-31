import { AnthropicApiBackend } from './anthropic-api.js';
import type { LlmBackend } from './backend.js';
import { ClaudeCliBackend } from './claude-cli.js';
import { CodexCliBackend } from './codex-cli.js';
import { GeminiCliBackend } from './gemini-cli.js';
import { OpenAiApiBackend } from './openai-api.js';

/**
 * T-PRD17 (core half) — provider/model registry.
 *
 * Resolves a per-request `providerId` to a concrete {@link LlmBackend} plus the
 * model id for the turn, so the sidecar can answer `chatSend` for any
 * configured provider instead of returning `chat_not_configured`. The IDE-side
 * provider/model *selector* (settings UI, both clients) consumes this seam and
 * stays deferred to the IDE-runtime sprint.
 *
 * Design ratified by AI council (codex-cli 0.134.0 + gemini 0.41.2,
 * 2026-05-31, UNANIMOUS on all five forks):
 *  - **Eager** construction — every configured backend is built up front and
 *    per-provider config errors are *isolated* (recorded, not thrown), mirroring
 *    {@link createCompatBackends}. One missing API key never blocks the others.
 *  - **Env-configured default** (`EVENT4U_DEFAULT_PROVIDER`) — no provider is
 *    hard-coded as product policy and resolution never depends on iteration
 *    order.
 *  - **Throw `provider_not_configured`** on an unknown / unconfigured provider —
 *    never silently fall back to a different provider (privacy + cost surprise).
 *  - **Env model override** (`EVENT4U_<PROVIDER>_MODEL`) over a hard-coded
 *    per-provider default — routing stays decoupled from the pricing book.
 *  - Provider ids are **canonicalised** (trimmed + lower-cased) early so the
 *    selector cannot drift.
 */

/** Thrown when a requested provider is unknown or not configured. */
export class ProviderNotConfiguredError extends Error {
  readonly code = 'provider_not_configured';
  constructor(
    readonly providerId: string,
    reason: string,
  ) {
    super(`Provider "${providerId}" is not configured: ${reason}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * A buildable provider. `build` reads only the injected env and either returns
 * a backend or throws (missing key etc.) — the registry isolates the throw as a
 * recorded per-provider error.
 */
export interface ProviderSpec {
  /** Canonical (lower-case) provider id. */
  id: string;
  /** Construct the backend from env; throw on missing config. */
  build: (env: NodeJS.ProcessEnv) => LlmBackend;
  /** Model used when no env override is set. */
  defaultModel: string;
  /** Env var that overrides {@link defaultModel}. */
  modelEnv: string;
}

export interface ProviderRegistryOptions {
  /** Env lookup; defaults to `process.env`. Injected for tests. */
  env?: NodeJS.ProcessEnv;
  /** Provider used when a request omits `providerId`. Falls back to env then `anthropic`. */
  defaultProvider?: string;
  /** Provider specs to build; defaults to {@link builtinProviderSpecs}. Injected for tests. */
  providers?: ProviderSpec[];
}

/** Canonical form for a provider id: trimmed, lower-cased. */
export function canonicalProviderId(id: string): string {
  return id.trim().toLowerCase();
}

function requireKey(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`missing API key: set ${name}`);
  return value;
}

/**
 * The built-in providers. API backends require their key env var (recorded as a
 * config error when absent); CLI backends always construct (the binary probe
 * happens at stream time). Model defaults match the ids used elsewhere in core
 * (see `tracking/fixtures.ts`).
 */
export function builtinProviderSpecs(): ProviderSpec[] {
  return [
    {
      id: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      modelEnv: 'EVENT4U_ANTHROPIC_MODEL',
      build: (env) => new AnthropicApiBackend({ apiKey: requireKey(env, 'ANTHROPIC_API_KEY') }),
    },
    {
      id: 'openai',
      defaultModel: 'gpt-5',
      modelEnv: 'EVENT4U_OPENAI_MODEL',
      build: (env) => new OpenAiApiBackend({ apiKey: requireKey(env, 'OPENAI_API_KEY') }),
    },
    {
      id: 'claude-cli',
      defaultModel: 'claude-sonnet-4-6',
      modelEnv: 'EVENT4U_CLAUDE_CLI_MODEL',
      build: () => new ClaudeCliBackend(),
    },
    {
      id: 'codex-cli',
      defaultModel: 'gpt-5-codex',
      modelEnv: 'EVENT4U_CODEX_CLI_MODEL',
      build: () => new CodexCliBackend(),
    },
    {
      id: 'gemini-cli',
      defaultModel: 'gemini-3-pro',
      modelEnv: 'EVENT4U_GEMINI_CLI_MODEL',
      build: () => new GeminiCliBackend(),
    },
  ];
}

export class ProviderRegistry {
  private readonly env: NodeJS.ProcessEnv;
  private readonly specs = new Map<string, ProviderSpec>();
  private readonly backends = new Map<string, LlmBackend>();
  private readonly errors = new Map<string, string>();
  private readonly defaultProvider: string;

  constructor(options: ProviderRegistryOptions = {}) {
    this.env = options.env ?? process.env;
    const specs = options.providers ?? builtinProviderSpecs();
    for (const spec of specs) {
      const id = canonicalProviderId(spec.id);
      this.specs.set(id, { ...spec, id });
      try {
        this.backends.set(id, spec.build(this.env));
      } catch (err) {
        this.errors.set(id, err instanceof Error ? err.message : String(err));
      }
    }
    this.defaultProvider = canonicalProviderId(
      options.defaultProvider ?? this.env.EVENT4U_DEFAULT_PROVIDER ?? 'anthropic',
    );
  }

  /**
   * Resolve the backend for a turn. Uses {@link defaultProvider} when
   * `providerId` is omitted. Throws {@link ProviderNotConfiguredError} for an
   * unknown or unconfigured provider — never silently falls back.
   */
  resolveBackend(providerId?: string): LlmBackend {
    const id = canonicalProviderId(providerId ?? this.defaultProvider);
    const backend = this.backends.get(id);
    if (backend) return backend;
    const reason =
      this.errors.get(id) ?? (this.specs.has(id) ? 'not configured' : 'unknown provider');
    throw new ProviderNotConfiguredError(id, reason);
  }

  /**
   * Resolve the model id for a turn: env override (`EVENT4U_<PROVIDER>_MODEL`)
   * then the spec default. Returns an empty string for an unknown provider with
   * no override (the caller surfaces the provider error via {@link resolveBackend}).
   */
  resolveModel(providerId?: string): string {
    const id = canonicalProviderId(providerId ?? this.defaultProvider);
    const spec = this.specs.get(id);
    const overrideEnv =
      spec?.modelEnv ?? `EVENT4U_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_MODEL`;
    return this.env[overrideEnv] ?? spec?.defaultModel ?? '';
  }

  /** Provider ids that built successfully — fuel for the future selector UI. */
  available(): string[] {
    return [...this.backends.keys()];
  }

  /** Per-provider config errors (e.g. missing key), keyed by provider id. */
  configErrors(): Record<string, string> {
    return Object.fromEntries(this.errors);
  }

  /** The provider used when a request omits `providerId`. */
  get default(): string {
    return this.defaultProvider;
  }
}
