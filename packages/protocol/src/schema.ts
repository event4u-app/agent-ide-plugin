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

// --- workspace folders (multi-project, road-to-multi-project Phase B) ----

/**
 * A project root the IDE window currently has open. The client enumerates
 * these automatically — VS Code workspace folders, JetBrains module content
 * roots — and reports them to the Core on connect and on every change. The
 * Core dedups and canonicalises them into its {@link WorkspaceRoot} model.
 */
export const WorkspaceFolderSchema = z.object({
  /** Primary identity. `file://…`, `vscode-remote://…`, etc. */
  uri: z.string().min(1),
  /** Client-supplied persistence key, stable across casing / relocation. */
  stableId: z.string().min(1),
  /** User-visible label (folder name, module name). */
  displayName: z.string(),
  /** Origin discriminator, e.g. `"folder"` (VS Code) or `"module"` (JetBrains). */
  kind: z.string(),
});
export type WorkspaceFolder = z.infer<typeof WorkspaceFolderSchema>;

/** Lifecycle state of a single root's index segment. */
export const RootIndexStateSchema = z.enum(['indexing', 'ready', 'error']);
export type RootIndexState = z.infer<typeof RootIndexStateSchema>;

/** Per-root index status the UI polls (T-MR11). */
export const RootIndexStatusSchema = z.object({
  stableId: z.string().min(1),
  state: RootIndexStateSchema,
  /** Files indexed so far. */
  fileCount: z.number().int().nonnegative(),
  /** Total files discovered for this root, when known. */
  totalFiles: z.number().int().nonnegative().nullable(),
  /** Error detail when `state === 'error'`. */
  message: z.string().nullable(),
});
export type RootIndexStatus = z.infer<typeof RootIndexStatusSchema>;

// --- connect handshake --------------------------------------------------

/**
 * Connection handshake. The client reports every root the IDE window has
 * open. An omitted / empty list is the legacy single-root fallback (a client
 * that predates multi-root support).
 */
export const ConnectRequestSchema = z.object({
  workspaceFolders: z.array(WorkspaceFolderSchema).default([]),
});
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>;

export const ConnectResponseSchema = z.object({
  ack: z.literal(true),
  /** The Core's deduplicated, canonicalised view of the roots. */
  roots: z.array(WorkspaceFolderSchema),
  /** Current per-root index status. */
  status: z.array(RootIndexStatusSchema),
});
export type ConnectResponse = z.infer<typeof ConnectResponseSchema>;

// --- workspaceFoldersChanged --------------------------------------------

/**
 * Delta notification, modelled as an ordinary request that returns an ack
 * (AI Council 2026-05-30: keep the protocol uniform request/response rather
 * than add a fire-and-forget notification concept for a solo-dev plugin).
 */
export const WorkspaceFoldersChangedRequestSchema = z.object({
  added: z.array(WorkspaceFolderSchema).default([]),
  /** stableIds of removed roots. */
  removed: z.array(z.string()).default([]),
});
export type WorkspaceFoldersChangedRequest = z.infer<typeof WorkspaceFoldersChangedRequestSchema>;

export const WorkspaceFoldersChangedResponseSchema = z.object({
  ack: z.literal(true),
  status: z.array(RootIndexStatusSchema),
});
export type WorkspaceFoldersChangedResponse = z.infer<typeof WorkspaceFoldersChangedResponseSchema>;

// --- rootStatus query (UI polls per-root index progress) ----------------

export const RootStatusRequestSchema = z.object({});
export type RootStatusRequest = z.infer<typeof RootStatusRequestSchema>;

export const RootStatusResponseSchema = z.object({
  status: z.array(RootIndexStatusSchema),
});
export type RootStatusResponse = z.infer<typeof RootStatusResponseSchema>;

// --- per-turn context scope (consumed in Phase C, T-MR13) ---------------

/**
 * Per-turn retrieval scope. Discriminated union (AI Council 2026-05-30:
 * an explicit `kind` tag avoids the omitted-vs-empty-array ambiguity that
 * a bare `rootIds?: string[]` would carry across TS + Kotlin):
 *  - `all`   — default; every enabled root.
 *  - `roots` — an explicit, non-empty root-ID set.
 *  - `none`  — "no code context".
 *
 * TS-only for now; its Kotlin DTO is codegen'd when the per-turn message
 * lands in Phase C (no Kotlin consumer exists in Phase B).
 */
export const ContextScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('roots'), rootIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('none') }),
]);
export type ContextScope = z.infer<typeof ContextScopeSchema>;

// --- method registry ----------------------------------------------------

/**
 * Canonical list of request/response methods exposed by the Agent Core.
 * Each entry pairs the request and response payload schemas so a generic
 * dispatcher can validate both ends from one source of truth.
 */
export const Methods = {
  ping: { request: PingRequestSchema, response: PingResponseSchema },
  echo: { request: EchoRequestSchema, response: EchoResponseSchema },
  connect: { request: ConnectRequestSchema, response: ConnectResponseSchema },
  workspaceFoldersChanged: {
    request: WorkspaceFoldersChangedRequestSchema,
    response: WorkspaceFoldersChangedResponseSchema,
  },
  rootStatus: { request: RootStatusRequestSchema, response: RootStatusResponseSchema },
} as const;

export type MethodName = keyof typeof Methods;

export const MethodNameSchema = z.enum(Object.keys(Methods) as [MethodName, ...MethodName[]]);

/** An error envelope payload, used when a handler throws. */
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
