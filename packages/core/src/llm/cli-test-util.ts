import type { spawn } from 'node:child_process';

/**
 * Test-only fake `spawn` for the agent-CLI backends. Returns a child whose
 * stdout replays the given NDJSON lines, and records what was written to stdin.
 * Not shipped — imported only by `*.test.ts`.
 */
export function makeFakeSpawn(
  lines: string[],
  opts: { onStdin?: (data: string) => void } = {},
): {
  spawnFn: typeof spawn;
  killed: () => boolean;
} {
  let wasKilled = false;
  const spawnFn = (() => {
    const stdout = {
      setEncoding() {},
      async *[Symbol.asyncIterator]() {
        for (const line of lines) yield `${line}\n`;
      },
    };
    return {
      stdin: {
        write: (data: string) => {
          opts.onStdin?.(data);
          return true;
        },
        end: () => {},
      },
      stdout,
      get killed() {
        return wasKilled;
      },
      kill: () => {
        wasKilled = true;
        return true;
      },
    };
  }) as unknown as typeof spawn;
  return { spawnFn, killed: () => wasKilled };
}
