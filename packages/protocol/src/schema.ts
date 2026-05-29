import { z } from 'zod';

/**
 * Wire protocol — newline-delimited JSON (NDJSON) envelopes over stdio.
 *
 * Decision: custom NDJSON envelope `{ messageId, messageType, data, done }`
 * over `vscode-jsonrpc`, per ADR-003 and the Spike 0.3b streaming validation.
 * AI Council (gemini + codex/gpt-5, 2026-05-29) converged on this for the
 * MVP: minimal Kotlin-side dependency surface, validated streaming spike,
 * manual messageId correlation is a negligible cost at this scale.
 *
 * Every line on stdin/stdout is exactly one JSON-encoded {@link Envelope}.
 * - Request/response: client and server reuse the same `messageId`.
 * - Streaming: the server emits N envelopes with `done: false` and a final
 *   envelope with `done: true` carrying the same `messageId`.
 */
export const EnvelopeSchema = z.object({
  /** Correlation id. The response reuses the request's id. */
  messageId: z.string().min(1),
  /** Logical method or event name, e.g. `"ping"`, `"echo"`, `"token"`. */
  messageType: z.string().min(1),
  /** Method-specific payload. Validated per `messageType` by the handler. */
  data: z.unknown(),
  /** `true` on the terminal envelope of a request or a stream. */
  done: z.boolean(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

// --- ping ---------------------------------------------------------------

export const PingRequestSchema = z.object({});
export type PingRequest = z.infer<typeof PingRequestSchema>;

export const PingResponseSchema = z.object({
  result: z.literal('pong'),
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

// --- echo ---------------------------------------------------------------

export const EchoRequestSchema = z.object({
  text: z.string(),
});
export type EchoRequest = z.infer<typeof EchoRequestSchema>;

export const EchoResponseSchema = z.object({
  text: z.string(),
});
export type EchoResponse = z.infer<typeof EchoResponseSchema>;

// --- method registry ----------------------------------------------------

/**
 * Canonical list of request/response methods exposed by the Agent Core.
 * Each entry pairs the request and response payload schemas so a generic
 * dispatcher can validate both ends from one source of truth.
 */
export const Methods = {
  ping: { request: PingRequestSchema, response: PingResponseSchema },
  echo: { request: EchoRequestSchema, response: EchoResponseSchema },
} as const;

export type MethodName = keyof typeof Methods;

export const MethodNameSchema = z.enum(Object.keys(Methods) as [MethodName, ...MethodName[]]);

/** An error envelope payload, used when a handler throws. */
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
