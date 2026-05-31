/**
 * T-1305 — cooperative cancellation helpers shared across the long-running core
 * operations (embedding, MCP tool calls, session scans) so a Stop (the IDE
 * button → {@link CancellationToken.requestCancel}) aborts them, not just the
 * LLM stream it already reaches.
 *
 * The contract is the Web/Node standard: an `AbortSignal` is threaded through as
 * an optional trailing parameter (matching the existing `stream(request,
 * signal?)` backend convention), and an abort rejects the in-flight Promise with
 * the signal's `reason` — a `DOMException` named `AbortError` by default. We add
 * no second cancellation contract on top of that.
 */

/** Throw the signal's abort reason if it is already aborted (no-op when undefined). */
export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/**
 * True when `err` is an abort/cancellation rather than a genuine failure.
 *
 * The load-bearing use is in **fail-open** catch blocks (session-scan adapters,
 * the MCP manager): those swallow real errors and degrade, but an abort is user
 * intent and MUST propagate — swallowing it would make Stop a no-op. Such blocks
 * re-throw when this returns `true`.
 */
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // `AbortSignal.throwIfAborted()` / `AbortController.abort()` → DOMException
  // 'AbortError'; `fetch`/Node stream aborts may surface code 'ABORT_ERR'.
  return err.name === 'AbortError' || (err as { code?: unknown }).code === 'ABORT_ERR';
}
