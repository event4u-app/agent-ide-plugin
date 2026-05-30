import { z } from 'zod';
import type { McpClient } from '../mcp/client.js';
import { contentToText } from '../mcp/protocol.js';
import type { LocalMemoryStore, MemoryRecord } from './local.js';

/**
 * T-1105 — memory backend abstraction with an optional MCP backend.
 *
 * The agent reads/writes memory through {@link MemoryBackend}. The default is
 * {@link LocalMemoryBackend} (the md+frontmatter store). When an
 * `@event4u/agent-memory` MCP server is configured, {@link RoutingMemoryBackend}
 * prefers it and falls back to local storage whenever the server is
 * unreachable or errors — so memory never hard-fails on a flaky server
 * (roadmap T-1105: "local fallback if MCP server unreachable").
 */

export interface MemoryLookup {
  query?: string;
  types?: string[];
  limit?: number;
}

export interface MemoryBackend {
  lookup(params: MemoryLookup): Promise<MemoryRecord[]>;
  write(record: MemoryRecord): Promise<void>;
}

/** Filter + cap a record set the way a simple substring lookup would. */
export function filterRecords(
  records: readonly MemoryRecord[],
  params: MemoryLookup,
): MemoryRecord[] {
  const q = params.query?.trim().toLowerCase();
  const typeSet = params.types && params.types.length > 0 ? new Set(params.types) : undefined;
  let out = records.filter((r) => {
    if (typeSet && !typeSet.has(r.type)) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q)
    );
  });
  if (typeof params.limit === 'number' && params.limit >= 0) out = out.slice(0, params.limit);
  return out;
}

export class LocalMemoryBackend implements MemoryBackend {
  constructor(private readonly store: LocalMemoryStore) {}

  async lookup(params: MemoryLookup): Promise<MemoryRecord[]> {
    return filterRecords(await this.store.list(), params);
  }

  async write(record: MemoryRecord): Promise<void> {
    await this.store.write(record);
  }
}

const McpRecordSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  type: z.string().default('user'),
  body: z.string().default(''),
});

/** Best-effort parse of an MCP `memory_lookup` text payload into records. */
export function parseMcpRecords(text: string): MemoryRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { memories?: unknown }).memories)
      ? (raw as { memories: unknown[] }).memories
      : [];
  const parsed = z.array(McpRecordSchema).safeParse(arr);
  return parsed.success ? parsed.data : [];
}

export class McpMemoryBackend implements MemoryBackend {
  constructor(private readonly client: McpClient) {}

  async lookup(params: MemoryLookup): Promise<MemoryRecord[]> {
    const result = await this.client.callTool('memory_lookup', params);
    if (result.isError) throw new Error('mcp memory_lookup returned isError');
    return parseMcpRecords(contentToText(result.content));
  }

  async write(record: MemoryRecord): Promise<void> {
    const result = await this.client.callTool('memory_write', record);
    if (result.isError) throw new Error('mcp memory_write returned isError');
  }
}

/**
 * Tries the primary (MCP) backend and falls back to local on any failure.
 * Writes go to both when the primary succeeds — keeping a local mirror so a
 * later MCP outage still serves the memory.
 */
export class RoutingMemoryBackend implements MemoryBackend {
  constructor(
    private readonly primary: MemoryBackend,
    private readonly fallback: MemoryBackend,
  ) {}

  async lookup(params: MemoryLookup): Promise<MemoryRecord[]> {
    try {
      return await this.primary.lookup(params);
    } catch {
      return this.fallback.lookup(params);
    }
  }

  async write(record: MemoryRecord): Promise<void> {
    try {
      await this.primary.write(record);
    } catch {
      // Primary unreachable — the local mirror below becomes the only copy.
    }
    // Always keep a local mirror so a later primary outage still serves it.
    await this.fallback.write(record);
  }
}
