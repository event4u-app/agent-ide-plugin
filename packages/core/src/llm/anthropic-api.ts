import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUnion } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import type {
  ChatMessage,
  ContentPart,
  LlmRequest,
  LlmStreamEvent,
  LlmUsage,
} from '@event4u-agent/protocol';
import { LlmStreamError, type LlmBackend, toAnthropicTools } from './backend.js';

/**
 * T-201 — Anthropic API backend with streaming.
 *
 * Wraps `@anthropic-ai/sdk`'s `messages.stream()` so callers see the
 * provider-neutral `LlmStreamEvent` shape from `protocol/llm.ts`. Cache control
 * is opt-in per request — when `cache_system_prompt: true`, the system block
 * carries `cache_control: { type: "ephemeral" }` so subsequent turns read at
 * 10% of fresh-token cost (T-404 relies on this).
 */
export interface AnthropicApiBackendOptions {
  apiKey: string;
  /** Override the SDK base URL (testing, enterprise endpoints). */
  baseURL?: string;
  /** SDK instance injection — used by tests to plug in a stub. */
  client?: AnthropicLike;
}

/**
 * Minimal subset of the SDK we depend on. Lets tests inject a stub without
 * pulling in the real network client.
 */
export interface AnthropicLike {
  messages: {
    create(params: MessageCreateParams): Promise<AsyncIterable<RawAnthropicEvent>>;
    countTokens?(params: CountTokensParams): Promise<{ input_tokens: number }>;
  };
}

export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?:
    | string
    | Array<{
        type: 'text';
        text: string;
        cache_control?: { type: 'ephemeral' };
      }>;
  tools?: ToolUnion[];
  temperature?: number;
  stream: true;
}

export interface CountTokensParams {
  model: string;
  messages: MessageParam[];
  system?: string;
  tools?: ToolUnion[];
}

/**
 * Raw event shape emitted by `messages.stream()`. We keep this as a structural
 * type rather than importing the SDK union so the SDK can move types around
 * without breaking us.
 */
export type RawAnthropicEvent =
  | {
      type: 'message_start';
      message: {
        usage: {
          input_tokens: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
    }
  | {
      type: 'content_block_start';
      index: number;
      content_block:
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
        | { type: 'thinking'; thinking: string };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: 'thinking_delta'; thinking: string };
    }
  | {
      type: 'content_block_stop';
      index: number;
    }
  | {
      type: 'message_delta';
      delta: {
        stop_reason:
          | 'end_turn'
          | 'max_tokens'
          | 'tool_use'
          | 'stop_sequence'
          | 'pause_turn'
          | 'refusal'
          | null;
      };
      usage: { output_tokens: number };
    }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

export class AnthropicApiBackend implements LlmBackend {
  readonly id = 'anthropic';
  readonly mode = 'api' as const;
  private readonly client: AnthropicLike;

  constructor(opts: AnthropicApiBackendOptions) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const realClient = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
      // SDK's `.stream()` returns an AsyncIterable directly; wrap it so the
      // call shape matches `AnthropicLike.messages.create`.
      this.client = {
        messages: {
          create: (params) =>
            Promise.resolve(
              realClient.messages.stream(
                params as Parameters<typeof realClient.messages.stream>[0],
              ) as unknown as AsyncIterable<RawAnthropicEvent>,
            ),
          countTokens: realClient.messages.countTokens
            ? (params) =>
                realClient.messages
                  .countTokens(params as Parameters<typeof realClient.messages.countTokens>[0])
                  .then((r) => ({ input_tokens: r.input_tokens }))
            : undefined,
        },
      };
    }
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const params = this.buildParams(request);
    let rawStream: AsyncIterable<RawAnthropicEvent>;
    try {
      rawStream = await this.client.messages.create(params);
    } catch (err) {
      yield {
        kind: 'error',
        code: 'request_failed',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
    let stopReason:
      | 'end_turn'
      | 'max_tokens'
      | 'tool_use'
      | 'stop_sequence'
      | 'pause_turn'
      | 'refusal' = 'end_turn';
    const activeToolBlocks = new Map<number, { id: string; name: string }>();

    try {
      for await (const event of rawStream) {
        if (signal?.aborted) {
          yield { kind: 'error', code: 'aborted', message: 'stream aborted by caller' };
          return;
        }
        switch (event.type) {
          case 'message_start':
            usage.input_tokens = event.message.usage.input_tokens;
            if (event.message.usage.cache_creation_input_tokens !== undefined) {
              usage.cache_creation_input_tokens = event.message.usage.cache_creation_input_tokens;
            }
            if (event.message.usage.cache_read_input_tokens !== undefined) {
              usage.cache_read_input_tokens = event.message.usage.cache_read_input_tokens;
            }
            break;
          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              activeToolBlocks.set(event.index, {
                id: event.content_block.id,
                name: event.content_block.name,
              });
              yield {
                kind: 'tool_use_start',
                id: event.content_block.id,
                name: event.content_block.name,
              };
            } else if (event.content_block.type === 'text' && event.content_block.text) {
              yield { kind: 'text_delta', text: event.content_block.text };
            }
            break;
          case 'content_block_delta': {
            if (event.delta.type === 'text_delta') {
              yield { kind: 'text_delta', text: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              const tool = activeToolBlocks.get(event.index);
              if (tool) {
                yield {
                  kind: 'tool_use_input_delta',
                  id: tool.id,
                  json_delta: event.delta.partial_json,
                };
              }
            } else if (event.delta.type === 'thinking_delta') {
              yield { kind: 'thinking_delta', text: event.delta.thinking };
            }
            break;
          }
          case 'content_block_stop': {
            const tool = activeToolBlocks.get(event.index);
            if (tool) {
              activeToolBlocks.delete(event.index);
              // The SDK already coalesces input across deltas — but in our
              // event stream the consumer can recompose from json_delta. We
              // emit the empty-input marker; tool dispatchers JSON.parse the
              // accumulated json_delta themselves.
              yield {
                kind: 'tool_use_end',
                id: tool.id,
                name: tool.name,
                input: undefined,
              };
            }
            break;
          }
          case 'message_delta':
            usage.output_tokens = event.usage.output_tokens;
            if (event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            break;
          case 'message_stop':
            yield { kind: 'stop', reason: stopReason, usage };
            return;
          case 'error':
            yield { kind: 'error', code: event.error.type, message: event.error.message };
            return;
        }
      }
      // Stream ended without an explicit message_stop — synthesize one.
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

  async countInputTokens(request: LlmRequest): Promise<number | undefined> {
    if (!this.client.messages.countTokens) return undefined;
    try {
      const params = this.buildParams(request);
      const result = await this.client.messages.countTokens({
        model: params.model,
        messages: params.messages,
        system: typeof params.system === 'string' ? params.system : undefined,
        tools: params.tools,
      });
      return result.input_tokens;
    } catch {
      return undefined;
    }
  }

  private buildParams(request: LlmRequest): MessageCreateParams {
    const messages = request.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage);
    const systemFromMessages = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : flattenTextParts(m.content)))
      .join('\n\n');
    const system =
      request.system ?? (systemFromMessages.length > 0 ? systemFromMessages : undefined);

    const params: MessageCreateParams = {
      model: request.model,
      max_tokens: request.max_tokens,
      messages,
      stream: true,
    };
    if (system !== undefined) {
      params.system = request.cache_system_prompt
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system;
    }
    const tools = toAnthropicTools(request.tools);
    if (tools) params.tools = tools as ToolUnion[];
    if (request.temperature !== undefined) params.temperature = request.temperature;
    return params;
  }
}

function toAnthropicMessage(message: ChatMessage): MessageParam {
  return {
    role: message.role === 'system' ? 'user' : message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : (message.content.map(toAnthropicPart) as unknown as MessageParam['content']),
  };
}

function toAnthropicPart(part: ContentPart): Record<string, unknown> {
  if (part.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: part.tool_use_id,
      content: part.content,
      ...(part.is_error ? { is_error: true } : {}),
    };
  }
  return part as unknown as Record<string, unknown>;
}

function flattenTextParts(parts: ContentPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export { LlmStreamError };
