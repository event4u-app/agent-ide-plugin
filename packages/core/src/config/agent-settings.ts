import { readFile } from 'node:fs/promises';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z, type ZodType } from 'zod';

/**
 * MVP-relevant subset of `.agent-settings.yml`. All other fields the consumer
 * project may have (per agent-config's full schema) are accepted but ignored
 * by this reader — additive forward-compat is intentional.
 *
 * Roadmap: T-208. Hot-reload is T-207's surface; this reader is a pure
 * function over file content.
 */

const LlmProvider = z.enum(['anthropic', 'openai', 'codex', 'gemini', 'openai-compat']);
const LlmMode = z.enum(['api', 'cli', 'auto']);
const Role = z.enum(['developer', 'reviewer', 'tester', 'po', 'incident', 'planner']);

/**
 * T-506 — OpenAI-compatible HTTP endpoint config. One entry per Mistral /
 * Together / Groq / OpenRouter / self-hosted endpoint. The API key is read
 * from the named environment variable (never inlined in the YAML); pricing for
 * these models comes from `prices.yml::custom_endpoints`.
 */
const CompatProviderSchema = z.object({
  id: z.string().min(1),
  base_url: z.string().url(),
  /** Env var holding the bearer token. Defaults to `<ID>_API_KEY` upstream. */
  api_key_env: z.string().min(1).optional(),
  /** Optional default model id for this endpoint. */
  default_model: z.string().min(1).optional(),
});
export type CompatProvider = z.infer<typeof CompatProviderSchema>;

const CommandSuggestionSchema = z
  .object({
    enabled: z.boolean().default(true),
    senior_gate: z.boolean().default(false),
  })
  .partial()
  .default({});

/**
 * T-1101 — one MCP server the plugin spawns and connects to. `id` namespaces
 * the server's tools (`<id>:<tool>`) and so must not contain a colon. The
 * command runs as a subprocess; env values are read from the YAML directly
 * (secrets should be `${ENV_VAR}`-expanded by the consumer, not inlined).
 */
const McpServerSchema = z.object({
  id: z
    .string()
    .min(1)
    .refine((v) => !v.includes(':'), { message: "must not contain ':'" }),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
  /** Override the 5s handshake timeout for a slow-booting server. */
  init_timeout_ms: z.number().int().positive().optional(),
  /** Override the 30s per-call timeout. */
  request_timeout_ms: z.number().int().positive().optional(),
});
export type McpServerConfig = z.infer<typeof McpServerSchema>;

const McpSchema = z
  .object({
    servers: z.array(McpServerSchema).default([]),
  })
  .partial()
  .default({});

/**
 * T-1403 — telemetry opt-in. Engagement logging is OFF by default; a user
 * turns it on explicitly. When disabled the recorder is a no-op (zero disk
 * I/O). Only invocation metadata is ever recorded — no content.
 */
const TelemetrySchema = z
  .object({
    artifact_engagement: z
      .object({
        enabled: z.boolean().default(false),
      })
      .partial()
      .default({}),
  })
  .partial()
  .default({});

const LlmSchema = z
  .object({
    default_provider: LlmProvider.default('anthropic'),
    default_mode: LlmMode.default('auto'),
    providers: z.array(CompatProviderSchema).default([]),
  })
  .partial()
  .default({});

const RolesSchema = z
  .object({
    active_role: Role.optional(),
  })
  .partial()
  .default({});

/**
 * T-PRD06 — cost guardrails. `daily_budget_usd` caps spend per UTC day; the
 * composer warns once `spent / budget` reaches `warning_threshold_ratio`
 * (default 0.8). Omitted `daily_budget_usd` = no budget (the tracker still
 * records spend but never breaches).
 */
const CostSchema = z
  .object({
    daily_budget_usd: z.number().positive(),
    warning_threshold_ratio: z.number().min(0).max(1),
  })
  .partial()
  .default({});

const CommandsSchema = z
  .object({
    suggestion: CommandSuggestionSchema,
  })
  .partial()
  .default({});

export const AgentSettingsSchema = z
  .object({
    llm: LlmSchema,
    roles: RolesSchema,
    cost: CostSchema,
    commands: CommandsSchema,
    mcp: McpSchema,
    telemetry: TelemetrySchema,
  })
  .partial()
  .passthrough()
  .transform((parsed) => ({
    llm: {
      default_provider: parsed.llm?.default_provider ?? 'anthropic',
      default_mode: parsed.llm?.default_mode ?? 'auto',
      providers: parsed.llm?.providers ?? [],
    },
    roles: {
      active_role: parsed.roles?.active_role,
    },
    cost: {
      daily_budget_usd: parsed.cost?.daily_budget_usd,
      warning_threshold_ratio: parsed.cost?.warning_threshold_ratio ?? 0.8,
    },
    commands: {
      suggestion: {
        enabled: parsed.commands?.suggestion?.enabled ?? true,
        senior_gate: parsed.commands?.suggestion?.senior_gate ?? false,
      },
    },
    mcp: {
      servers: parsed.mcp?.servers ?? [],
    },
    telemetry: {
      artifact_engagement: {
        enabled: parsed.telemetry?.artifact_engagement?.enabled ?? false,
      },
    },
  }));

export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const DEFAULT_SETTINGS: AgentSettings = AgentSettingsSchema.parse({});

export class AgentSettingsError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentSettingsError';
  }
}

/**
 * Parse settings from a YAML string. Throws {@link AgentSettingsError} on
 * malformed YAML or schema violation; never throws on missing optional fields
 * (those get defaults).
 */
export function parseSettings(yamlText: string): AgentSettings {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new AgentSettingsError(
        `.agent-settings.yml: malformed YAML at line ${err.linePos?.[0]?.line ?? '?'}: ${err.message}`,
        err,
      );
    }
    throw new AgentSettingsError(`.agent-settings.yml: parse failed`, err);
  }

  // Empty file → `null`, treat as empty object so defaults fill in.
  const normalised = raw == null ? {} : raw;
  if (typeof normalised !== 'object' || Array.isArray(normalised)) {
    const kind = Array.isArray(normalised) ? 'array' : typeof normalised;
    throw new AgentSettingsError(`.agent-settings.yml: top-level must be a mapping, got ${kind}`);
  }

  const parsed = AgentSettingsSchema.safeParse(normalised);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  · ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new AgentSettingsError(`.agent-settings.yml: schema violation\n${issues}`, parsed.error);
  }
  return parsed.data;
}

/**
 * Read settings from a path. File not found → returns {@link DEFAULT_SETTINGS}
 * (a fresh consumer with no .agent-settings.yml is a valid state). Other IO
 * errors propagate.
 */
export async function loadSettings(path: string): Promise<AgentSettings> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return DEFAULT_SETTINGS;
    }
    throw new AgentSettingsError(`.agent-settings.yml: cannot read ${path}`, err);
  }
  return parseSettings(text);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

// Type narrowed re-export for callers that want to assert the schema directly.
export const _internal: { schema: ZodType<unknown> } = { schema: AgentSettingsSchema };
