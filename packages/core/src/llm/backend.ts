import type {
  LlmMode,
  LlmRequest,
  LlmStreamEvent,
  LlmUsage,
  ToolDefinition,
} from '@event4u-agent/protocol';

/**
 * Generic streaming LLM backend. Implementations:
 *
 * - `AnthropicApiBackend` (T-201) — `messages.stream()` over the official SDK.
 * - `ClaudeCliBackend` (T-406) — `claude -p --output-format=stream-json`.
 *
 * Token-extraction differences are normalised here so the cost-tracking layer
 * (T-408) sees one shape regardless of transport.
 */
export interface LlmBackend {
  /** Stable identifier for telemetry and logs. */
  readonly id: string;
  readonly mode: LlmMode;

  /**
   * Stream a chat completion. The async iterator emits `LlmStreamEvent`s until
   * a `stop` (success) or `error` event closes the run. Implementations must
   * yield exactly one terminal event.
   */
  stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent>;

  /**
   * Best-effort token count for the request without sending it. Used by the
   * pre-flight cost estimate (T-411b). Implementations that cannot count
   * locally MAY return `undefined`; the caller falls back to an estimate.
   */
  countInputTokens?(request: LlmRequest): Promise<number | undefined>;
}

export interface AggregatedUsage extends LlmUsage {
  /** Concatenated text content across all `text_delta` events. */
  text: string;
  /** Tool calls assembled from `tool_use_*` events. */
  tool_uses: Array<{ id: string; name: string; input: unknown }>;
  /** Stop reason from the terminal `stop` event. */
  stop_reason: string;
}

/**
 * Drain a backend stream into a fully-materialised aggregate. Useful for
 * non-streaming callers (tests, audit-log replays) that just want the final
 * shape without per-token handling.
 */
export async function collectStream(
  events: AsyncIterable<LlmStreamEvent>,
): Promise<AggregatedUsage> {
  let text = '';
  const tool_uses: Array<{ id: string; name: string; input: unknown }> = [];
  const pendingTools = new Map<string, { name: string; jsonChunks: string[] }>();
  let usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
  let stop_reason = 'end_turn';

  for await (const event of events) {
    switch (event.kind) {
      case 'text_delta':
        text += event.text;
        break;
      case 'tool_use_start':
        pendingTools.set(event.id, { name: event.name, jsonChunks: [] });
        break;
      case 'tool_use_input_delta': {
        const pending = pendingTools.get(event.id);
        if (pending) pending.jsonChunks.push(event.json_delta);
        break;
      }
      case 'tool_use_end':
        tool_uses.push({ id: event.id, name: event.name, input: event.input });
        pendingTools.delete(event.id);
        break;
      case 'thinking_delta':
        break;
      case 'stop':
        usage = event.usage;
        stop_reason = event.reason;
        break;
      case 'error':
        throw new LlmStreamError(event.code, event.message);
    }
  }
  return { ...usage, text, tool_uses, stop_reason };
}

export class LlmStreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LlmStreamError';
  }
}

/**
 * Translate our `ToolDefinition` to the Anthropic SDK's tool shape. Lives in
 * the backend layer because Anthropic is the only backend in MVP; future
 * backends each provide their own translator.
 */
export function toAnthropicTools(
  tools: ToolDefinition[] | undefined,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Record<string, unknown>,
  }));
}
