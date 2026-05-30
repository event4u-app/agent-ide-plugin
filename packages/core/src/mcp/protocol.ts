import { z } from 'zod';

/**
 * T-1101 — MCP wire protocol (minimal, hand-rolled).
 *
 * MCP's stdio transport is JSON-RPC 2.0 framed as newline-delimited JSON — the
 * same shape this repo already speaks for its own NDJSON sidecar envelope
 * (ADR-003) and the `codex exec --json` parser. Rather than pull
 * `@modelcontextprotocol/sdk` (and its transitive dependency drift) onto the
 * node-20/22 × {macOS,Ubuntu,Windows} matrix, we model the subset of MCP we
 * consume directly. See ADR-006.
 *
 * Only the client→server methods the plugin actually drives are typed here:
 * `initialize`, `tools/list`, `tools/call`. Everything else on the wire is
 * tolerated and ignored.
 */

/** Protocol revision we advertise in the `initialize` handshake. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const JSONRPC_VERSION = '2.0';

/** A JSON-RPC request or notification (notification = no `id`). */
export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id?: number | string;
  method: string;
  params?: unknown;
}

/** A JSON-RPC response (success carries `result`, failure carries `error`). */
export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

/** Discriminate a parsed wire object as a response (has `id` + result/error). */
export function isJsonRpcResponse(msg: Record<string, unknown>): boolean {
  return (
    msg.jsonrpc === JSONRPC_VERSION &&
    'id' in msg &&
    msg.id !== undefined &&
    ('result' in msg || 'error' in msg)
  );
}

/**
 * A tool as advertised by `tools/list`. `inputSchema` is a JSON Schema object;
 * we keep it opaque (`record`) — it is forwarded verbatim into the LLM tool
 * definition's `input_schema`.
 */
export const McpToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  inputSchema: z.record(z.unknown()).default({}),
});
export type McpTool = z.infer<typeof McpToolSchema>;

export const ListToolsResultSchema = z.object({
  tools: z.array(McpToolSchema).default([]),
});
export type ListToolsResult = z.infer<typeof ListToolsResultSchema>;

/**
 * A single content block of a `tools/call` result. MCP defines text / image /
 * resource blocks; we model `text` precisely and pass other kinds through as a
 * tagged record so the agent can still surface them.
 */
export const McpContentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.string() }).passthrough(),
]);
export type McpContentBlock = z.infer<typeof McpContentBlockSchema>;

export const CallToolResultSchema = z.object({
  content: z.array(McpContentBlockSchema).default([]),
  isError: z.boolean().default(false),
});
export type CallToolResult = z.infer<typeof CallToolResultSchema>;

export const InitializeResultSchema = z
  .object({
    protocolVersion: z.string().optional(),
    serverInfo: z
      .object({ name: z.string().optional(), version: z.string().optional() })
      .passthrough()
      .optional(),
    capabilities: z.record(z.unknown()).default({}),
  })
  .passthrough();
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

/**
 * Flatten a `tools/call` result's content blocks into a single string for the
 * agent's `tool_result` part. Text blocks are concatenated; non-text blocks
 * are JSON-stringified so nothing is silently dropped.
 */
export function contentToText(content: readonly McpContentBlock[]): string {
  return content
    .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block)))
    .join('\n');
}
