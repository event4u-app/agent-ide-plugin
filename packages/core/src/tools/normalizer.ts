import { z } from 'zod';
import type { ContentPart, LlmStreamEvent } from '@event4u-agent/protocol';

/**
 * T-301 — Tool-call normalization v0. Anthropic-only in MVP; OpenAI/Codex/
 * Gemini land in v1.0 Sprint 5.
 *
 * Two responsibilities:
 *   1. Re-assemble the streaming `tool_use_*` event sequence into a single
 *      `NormalizedToolCall`. The Anthropic streaming wire format splits the
 *      input JSON across N `input_json_delta` chunks; this collector merges
 *      them, JSON-parses, and returns a typed call record.
 *   2. Translate an executed tool result back into the assistant-turn
 *      `tool_result` content part that the next LLM call expects.
 */

export const NormalizedToolCallSchema = z.object({
  /** Tool-call id from the backend (Anthropic: `tool_use.id`). */
  id: z.string(),
  /** Tool name as the agent invoked it. */
  name: z.string(),
  /** Parsed input arguments. `{}` when the model emitted no input. */
  input: z.unknown(),
});
export type NormalizedToolCall = z.infer<typeof NormalizedToolCallSchema>;

export interface ToolCallCollectorResult {
  /** Calls completed during the stream pass. */
  calls: NormalizedToolCall[];
}

/**
 * Drain a `LlmStreamEvent` async-iterable and collect every fully-assembled
 * tool call. Non-tool events (text deltas, thinking, stop) are ignored —
 * callers that need them should consume the stream directly.
 */
export async function collectToolCalls(
  events: AsyncIterable<LlmStreamEvent>,
): Promise<ToolCallCollectorResult> {
  const pending = new Map<string, { name: string; chunks: string[] }>();
  const calls: NormalizedToolCall[] = [];
  for await (const event of events) {
    switch (event.kind) {
      case 'tool_use_start':
        pending.set(event.id, { name: event.name, chunks: [] });
        break;
      case 'tool_use_input_delta': {
        const slot = pending.get(event.id);
        if (slot) slot.chunks.push(event.json_delta);
        break;
      }
      case 'tool_use_end': {
        const slot = pending.get(event.id);
        if (!slot) {
          // Unexpected — the start event was missed. Still record the call
          // with whatever input the backend provided.
          calls.push({ id: event.id, name: event.name, input: event.input ?? {} });
          break;
        }
        const merged = slot.chunks.join('');
        let input: unknown = {};
        if (merged.trim().length > 0) {
          try {
            input = JSON.parse(merged);
          } catch {
            input = { __parse_error__: true, raw: merged };
          }
        }
        calls.push({ id: event.id, name: event.name, input });
        pending.delete(event.id);
        break;
      }
      default:
        // Ignore non-tool events.
        break;
    }
  }
  return { calls };
}

/**
 * Build the `tool_result` content part for the next assistant turn. `output`
 * is converted to a string — structured outputs are JSON-stringified. The
 * error flag flips Anthropic's `is_error` so the model knows the call failed.
 */
export function toToolResultPart(
  call: NormalizedToolCall,
  output: unknown,
  isError = false,
): ContentPart {
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return {
    type: 'tool_result',
    tool_use_id: call.id,
    content,
    ...(isError ? { is_error: true } : {}),
  };
}
