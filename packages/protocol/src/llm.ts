import { z } from 'zod';

/**
 * Cross-provider LLM types. Carved out of `schema.ts` so future providers
 * (OpenAI in v1.0 Sprint 5, Codex/Gemini later) plug in without touching the
 * existing wire protocol shape.
 *
 * Roadmap anchor: T-201 (Anthropic API backend) defines the first concrete
 * implementation against this interface.
 */

export const RoleSchema = z.enum(['user', 'assistant', 'system']);
export type Role = z.infer<typeof RoleSchema>;

export const TextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ToolUsePartSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

export const ToolResultPartSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
});

export const ContentPartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ToolUsePartSchema,
  ToolResultPartSchema,
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

export const ChatMessageSchema = z.object({
  role: RoleSchema,
  content: z.union([z.string(), z.array(ContentPartSchema)]),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const LlmUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  thinking_tokens: z.number().int().nonnegative().optional(),
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export const LlmRequestSchema = z.object({
  /** Model id, e.g. `claude-sonnet-4-6`. */
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  system: z.string().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  max_tokens: z.number().int().positive().default(2048),
  temperature: z.number().min(0).max(2).optional(),
  /** Anthropic prompt-caching toggle. Set when the consumer wants caches. */
  cache_system_prompt: z.boolean().optional(),
});
export type LlmRequest = z.infer<typeof LlmRequestSchema>;

/** Streaming event types — one per terminal event the backend emits. */
export const LlmStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text_delta'), text: z.string() }),
  z.object({
    kind: z.literal('tool_use_start'),
    id: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal('tool_use_input_delta'),
    id: z.string(),
    json_delta: z.string(),
  }),
  z.object({
    kind: z.literal('tool_use_end'),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({ kind: z.literal('thinking_delta'), text: z.string() }),
  z.object({
    kind: z.literal('stop'),
    reason: z.enum([
      'end_turn',
      'max_tokens',
      'tool_use',
      'stop_sequence',
      'pause_turn',
      'refusal',
    ]),
    usage: LlmUsageSchema,
  }),
  z.object({
    kind: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);
export type LlmStreamEvent = z.infer<typeof LlmStreamEventSchema>;

/** Identifies which transport ran the call — backend, CLI, etc. */
export const LlmModeSchema = z.enum(['api', 'cli']);
export type LlmMode = z.infer<typeof LlmModeSchema>;

// --- T-305: halt protocol ----------------------------------------------

/**
 * Halt envelope emitted by the agent when it needs user input. The chat UI
 * renders a card with the question + option buttons + a free-text fallback.
 * Single-select only in MVP; multi-select and form-variant are v1.0 Sprint 7.
 */
export const HaltOptionSchema = z.object({
  /** Stable id forwarded back in the answer. */
  id: z.string().min(1),
  /** Label rendered as the button. */
  label: z.string().min(1),
  /** Optional detail line under the button. */
  description: z.string().optional(),
});
export type HaltOption = z.infer<typeof HaltOptionSchema>;

export const HaltRequestSchema = z.object({
  /** Halt id; the answer references this. */
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(HaltOptionSchema).default([]),
  /** When true, the user MAY type free text instead of picking an option. */
  allow_free_text: z.boolean().default(true),
});
export type HaltRequest = z.infer<typeof HaltRequestSchema>;

export const HaltAnswerSchema = z.object({
  halt_id: z.string().min(1),
  /** Picked option id, OR omitted when the user typed free text. */
  option_id: z.string().optional(),
  /** Free-text answer; takes precedence over option_id when present. */
  text: z.string().optional(),
});
export type HaltAnswer = z.infer<typeof HaltAnswerSchema>;

// --- T-306: ask-about-selection editor action ---------------------------

export const SelectionContextSchema = z.object({
  /** Workspace-relative file path. */
  path: z.string(),
  /** Selected text from the editor. */
  text: z.string(),
  /** 1-based inclusive line range of the selection. */
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  /** Optional language hint, e.g. `"typescript"`. */
  language: z.string().optional(),
});
export type SelectionContext = z.infer<typeof SelectionContextSchema>;

export const AskAboutSelectionSchema = z.object({
  selection: SelectionContextSchema,
  /** Optional user prompt typed in the editor's quick-input. */
  prompt: z.string().optional(),
});
export type AskAboutSelection = z.infer<typeof AskAboutSelectionSchema>;
