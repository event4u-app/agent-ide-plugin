import OpenAI from 'openai';
import type {
  ChatMessage,
  ContentPart,
  LlmRequest,
  LlmStreamEvent,
  LlmUsage,
  ToolDefinition,
} from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';

/**
 * T-501 — OpenAI API backend with streaming.
 *
 * Wraps the OpenAI SDK's `chat.completions.create({ stream: true })` so callers
 * see the provider-neutral `LlmStreamEvent` shape from `protocol/llm.ts`. The
 * Chat Completions surface (not the Responses API) is deliberate: it is the
 * lowest common denominator that the OpenAI-compatible endpoints in T-506
 * (Mistral / Together / Groq / OpenRouter) also speak, so `OpenAiCompatBackend`
 * reuses every translation helper here.
 *
 * Reasoning tokens (o-series) are captured from
 * `usage.completion_tokens_details.reasoning_tokens` into the canonical
 * `LlmUsage.thinking_tokens`, and prompt-cache hits from
 * `usage.prompt_tokens_details.cached_tokens` into `cache_read_input_tokens`,
 * so the cost-tracking layer sees one shape regardless of provider.
 */
export interface OpenAiApiBackendOptions {
  apiKey: string;
  /** Override the SDK base URL (OpenAI-compatible endpoints, enterprise). */
  baseURL?: string;
  /** Stable backend id for telemetry/logs. Defaults to `"openai"`. */
  id?: string;
  /** SDK instance injection — used by tests to plug in a stub. */
  client?: OpenAiLike;
}

/**
 * Minimal subset of the SDK we depend on. Lets tests inject a stub without a
 * real network client. The compat backend (T-506) targets the same surface.
 */
export interface OpenAiLike {
  chat: {
    completions: {
      create(params: ChatCompletionCreateParams): Promise<AsyncIterable<RawOpenAiChunk>>;
    };
  };
}

export interface ChatCompletionCreateParams {
  model: string;
  messages: OpenAiMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: OpenAiTool[];
  stream: true;
  stream_options?: { include_usage: true };
}

export type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Raw streaming chunk shape. Kept structural rather than importing the SDK
 * union so the SDK can move types around without breaking us.
 */
export interface RawOpenAiChunk {
  choices: Array<{
    delta: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
}

export class OpenAiApiBackend implements LlmBackend {
  readonly id: string;
  readonly mode = 'api' as const;
  private readonly client: OpenAiLike;

  constructor(opts: OpenAiApiBackendOptions) {
    this.id = opts.id ?? 'openai';
    if (opts.client) {
      this.client = opts.client;
    } else {
      const real = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
      this.client = {
        chat: {
          completions: {
            create: (params) =>
              real.chat.completions.create(
                params as unknown as Parameters<typeof real.chat.completions.create>[0],
              ) as unknown as Promise<AsyncIterable<RawOpenAiChunk>>,
          },
        },
      };
    }
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const params = buildParams(request);
    let rawStream: AsyncIterable<RawOpenAiChunk>;
    try {
      rawStream = await this.client.chat.completions.create(params);
    } catch (err) {
      yield {
        kind: 'error',
        code: 'request_failed',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
    let stopReason: LlmStreamStop['reason'] = 'end_turn';
    // Tool calls stream by `index`; the id + name arrive in the first delta for
    // that index, arguments stream across subsequent deltas. We open a block on
    // first sight and close all open blocks when the stream terminates.
    const openTools = new Map<number, { id: string; name: string }>();

    try {
      for await (const chunk of rawStream) {
        if (signal?.aborted) {
          yield { kind: 'error', code: 'aborted', message: 'stream aborted by caller' };
          return;
        }
        const choice = chunk.choices[0];
        if (choice) {
          const { delta } = choice;
          if (delta.content) {
            yield { kind: 'text_delta', text: delta.content };
          }
          if (delta.reasoning_content) {
            yield { kind: 'thinking_delta', text: delta.reasoning_content };
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = openTools.get(tc.index);
              if (!existing) {
                const id = tc.id ?? `tool-${tc.index}`;
                const name = tc.function?.name ?? '';
                openTools.set(tc.index, { id, name });
                yield { kind: 'tool_use_start', id, name };
              }
              const args = tc.function?.arguments;
              if (args) {
                const slot = openTools.get(tc.index);
                if (slot) {
                  yield { kind: 'tool_use_input_delta', id: slot.id, json_delta: args };
                }
              }
            }
          }
          if (choice.finish_reason) {
            stopReason = mapFinishReason(choice.finish_reason);
          }
        }
        if (chunk.usage) {
          applyUsage(usage, chunk.usage);
        }
      }
      // Close any tool blocks left open (OpenAI has no per-tool end event).
      for (const tool of openTools.values()) {
        yield { kind: 'tool_use_end', id: tool.id, name: tool.name, input: undefined };
      }
      yield { kind: 'stop', reason: stopReason, usage };
    } catch (err) {
      if (signal?.aborted) {
        yield { kind: 'error', code: 'aborted', message: 'stream aborted by caller' };
      } else {
        yield {
          kind: 'error',
          code: 'stream_error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
}

type LlmStreamStop = Extract<LlmStreamEvent, { kind: 'stop' }>;

function applyUsage(usage: LlmUsage, raw: NonNullable<RawOpenAiChunk['usage']>): void {
  if (raw.prompt_tokens !== undefined) usage.input_tokens = raw.prompt_tokens;
  if (raw.completion_tokens !== undefined) usage.output_tokens = raw.completion_tokens;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined) usage.thinking_tokens = reasoning;
  const cached = raw.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cache_read_input_tokens = cached;
}

function mapFinishReason(reason: string): LlmStreamStop['reason'] {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

/**
 * Build the Chat Completions params from a provider-neutral `LlmRequest`.
 * Exported so the compat backend (T-506) and tests can reuse the conversion.
 */
export function buildParams(request: LlmRequest): ChatCompletionCreateParams {
  const messages = toOpenAiMessages(request);
  const params: ChatCompletionCreateParams = {
    model: request.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.max_tokens !== undefined) params.max_tokens = request.max_tokens;
  if (request.temperature !== undefined) params.temperature = request.temperature;
  const tools = toOpenAiTools(request.tools);
  if (tools) params.tools = tools;
  return params;
}

/**
 * Flatten the provider-neutral message list into the OpenAI chat shape.
 * A standalone `system` prompt is prepended. Assistant `tool_use` parts become
 * `tool_calls`; `tool_result` parts become separate `role: "tool"` messages.
 */
export function toOpenAiMessages(request: LlmRequest): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (request.system) out.push({ role: 'system', content: request.system });

  for (const message of request.messages) {
    if (message.role === 'system') {
      out.push({ role: 'system', content: flattenText(message.content) });
      continue;
    }
    if (typeof message.content === 'string') {
      pushPlain(out, message.role, message.content);
      continue;
    }

    const text = flattenTextParts(message.content);
    const toolUses = message.content.filter(
      (p): p is Extract<ContentPart, { type: 'tool_use' }> => p.type === 'tool_use',
    );
    const toolResults = message.content.filter(
      (p): p is Extract<ContentPart, { type: 'tool_result' }> => p.type === 'tool_result',
    );

    if (message.role === 'assistant') {
      const assistant: Extract<OpenAiMessage, { role: 'assistant' }> = {
        role: 'assistant',
        content: text.length > 0 ? text : null,
      };
      if (toolUses.length > 0) {
        assistant.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function' as const,
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        }));
      }
      out.push(assistant);
    } else {
      // user turn: emit text first, then any tool results as `tool` messages.
      if (text.length > 0) out.push({ role: 'user', content: text });
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
      }
    }
  }
  return out;
}

function pushPlain(out: OpenAiMessage[], role: ChatMessage['role'], content: string): void {
  if (role === 'assistant') out.push({ role: 'assistant', content });
  else if (role === 'user') out.push({ role: 'user', content });
  else out.push({ role: 'system', content });
}

export function toOpenAiTools(tools: ToolDefinition[] | undefined): OpenAiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

function flattenText(content: string | ContentPart[]): string {
  return typeof content === 'string' ? content : flattenTextParts(content);
}

function flattenTextParts(parts: ContentPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}
