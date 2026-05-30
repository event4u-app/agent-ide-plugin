import type { Readable } from 'node:stream';

/**
 * Shared newline-delimited-JSON reader for the agent-CLI backends
 * (`codex exec --json`, `gemini --output-format stream-json`). Each emitted
 * line is parsed independently; malformed lines are dropped rather than
 * crashing the loop, mirroring the tolerance in `claude-cli.ts`.
 */
export async function* readNdjson(stream: Readable): AsyncIterable<Record<string, unknown>> {
  let buffer = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream as AsyncIterable<string>) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        const parsed = tryParse(line);
        if (parsed) yield parsed;
      }
      newline = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail.length > 0) {
    const parsed = tryParse(tail);
    if (parsed) yield parsed;
  }
}

function tryParse(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
