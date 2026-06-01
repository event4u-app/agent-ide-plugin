/**
 * Kotlin DTO codegen from the protocol package.
 *
 * Start simple (per road-to-mvp T-102): one explicit spec → one Kotlin file
 * with kotlinx.serialization data classes. The spec below is the single
 * source of truth shared with `packages/protocol/src/schema.ts`; a future
 * iteration can derive it from the Zod schemas via reflection.
 *
 * Run: `pnpm exec tsx scripts/codegen.ts` (or `task codegen`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// A field maps a Zod property to a Kotlin `data class` property. `kotlinType`
// is emitted verbatim, so `List<T>` and nullable `T?` are expressed directly.
// `default` (e.g. `null`, `emptyList()`) makes the property optional on the
// wire — kotlinx.serialization fills it when the JSON omits the key.
type Field = { name: string; kotlinType: string; default?: string };
type DataClass = { name: string; fields: Field[]; doc?: string };

// A discriminated union → a Kotlin sealed interface + one @SerialName subclass
// per variant, decoded polymorphically on the `kind` wire field via
// @JsonClassDiscriminator. Narrow by design (per AI council 2026-05-31): only
// `kind`-discriminated unions of flat serializable subclasses — NOT a generic
// Zod→Kotlin compiler.
type Variant = { kind: string; className: string; fields: Field[]; doc?: string };
type SealedUnion = { name: string; variants: Variant[]; doc?: string };

const KOTLIN_PACKAGE = 'de.event4u.agent.protocol';

const classes: DataClass[] = [
  {
    name: 'Envelope',
    doc: 'One NDJSON line on the Core <-> client channel.',
    fields: [
      { name: 'messageId', kotlinType: 'String' },
      { name: 'messageType', kotlinType: 'String' },
      { name: 'data', kotlinType: 'JsonElement' },
      { name: 'done', kotlinType: 'Boolean' },
    ],
  },
  { name: 'PingResponse', fields: [{ name: 'result', kotlinType: 'String' }] },
  { name: 'EchoRequest', fields: [{ name: 'text', kotlinType: 'String' }] },
  { name: 'EchoResponse', fields: [{ name: 'text', kotlinType: 'String' }] },

  // --- multi-project: workspace folders (road-to-multi-project Phase B) ---
  {
    name: 'WorkspaceFolder',
    doc: 'A project root the IDE window currently has open.',
    fields: [
      { name: 'uri', kotlinType: 'String' },
      { name: 'stableId', kotlinType: 'String' },
      { name: 'displayName', kotlinType: 'String' },
      { name: 'kind', kotlinType: 'String' },
    ],
  },
  {
    name: 'RootIndexStatus',
    doc: 'Per-root index status. `state` is one of indexing | ready | error.',
    fields: [
      { name: 'stableId', kotlinType: 'String' },
      { name: 'state', kotlinType: 'String' },
      { name: 'fileCount', kotlinType: 'Int' },
      { name: 'totalFiles', kotlinType: 'Int?', default: 'null' },
      { name: 'message', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'ConnectRequest',
    doc: 'Connection handshake; reports every open root.',
    fields: [
      { name: 'workspaceFolders', kotlinType: 'List<WorkspaceFolder>', default: 'emptyList()' },
    ],
  },
  {
    name: 'ConnectResponse',
    fields: [
      { name: 'ack', kotlinType: 'Boolean' },
      { name: 'roots', kotlinType: 'List<WorkspaceFolder>' },
      { name: 'status', kotlinType: 'List<RootIndexStatus>' },
    ],
  },
  {
    name: 'WorkspaceFoldersChangedRequest',
    doc: 'Delta of opened / closed roots.',
    fields: [
      { name: 'added', kotlinType: 'List<WorkspaceFolder>', default: 'emptyList()' },
      { name: 'removed', kotlinType: 'List<String>', default: 'emptyList()' },
    ],
  },
  {
    name: 'WorkspaceFoldersChangedResponse',
    fields: [
      { name: 'ack', kotlinType: 'Boolean' },
      { name: 'status', kotlinType: 'List<RootIndexStatus>' },
    ],
  },
  {
    name: 'RootStatusResponse',
    fields: [{ name: 'status', kotlinType: 'List<RootIndexStatus>' }],
  },

  // --- live terminal (Phase 9, T-903) ---
  {
    name: 'OutputChunk',
    doc: 'One chunk of raw PTY output; seq is monotonic per session.',
    fields: [
      { name: 'seq', kotlinType: 'Int' },
      { name: 'data', kotlinType: 'String' },
      { name: 'at', kotlinType: 'String' },
    ],
  },
  {
    name: 'PendingInput',
    doc: 'A discrete input request the session is blocked on.',
    fields: [
      { name: 'inputRequestId', kotlinType: 'String' },
      { name: 'prompt', kotlinType: 'String' },
      { name: 'at', kotlinType: 'String' },
    ],
  },
  {
    name: 'ReplaySlice',
    doc: 'Replay window returned on subscribe / reconnect.',
    fields: [
      { name: 'chunks', kotlinType: 'List<OutputChunk>' },
      { name: 'droppedChunks', kotlinType: 'Int' },
      { name: 'droppedBytes', kotlinType: 'Int' },
      { name: 'firstSeqAvailable', kotlinType: 'Int' },
      { name: 'nextSeq', kotlinType: 'Int' },
      { name: 'restartRequired', kotlinType: 'Boolean' },
    ],
  },
  {
    name: 'TerminalSubscribeRequest',
    doc: 'Subscribe to a session; the Core streams terminal events on this id.',
    fields: [
      { name: 'commandId', kotlinType: 'String' },
      { name: 'surfaceId', kotlinType: 'String' },
      { name: 'replayFromSeq', kotlinType: 'Int', default: '0' },
    ],
  },
  {
    name: 'TerminalSubscribeResponse',
    doc: 'First envelope of the subscribe stream — replay + current state.',
    fields: [
      { name: 'subscriptionId', kotlinType: 'String' },
      { name: 'status', kotlinType: 'String' },
      { name: 'pendingInput', kotlinType: 'PendingInput?', default: 'null' },
      { name: 'replay', kotlinType: 'ReplaySlice' },
    ],
  },
  {
    name: 'TerminalInputRequest',
    doc: 'Write to stdin — raw, or answer a pending request (first-write-wins).',
    fields: [
      { name: 'commandId', kotlinType: 'String' },
      { name: 'surfaceId', kotlinType: 'String' },
      { name: 'data', kotlinType: 'String' },
      { name: 'inputRequestId', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'TerminalInputResponse',
    fields: [
      { name: 'accepted', kotlinType: 'Boolean' },
      { name: 'reason', kotlinType: 'String?', default: 'null' },
      { name: 'winningSurfaceId', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'TerminalResizeRequest',
    fields: [
      { name: 'commandId', kotlinType: 'String' },
      { name: 'cols', kotlinType: 'Int' },
      { name: 'rows', kotlinType: 'Int' },
    ],
  },
  {
    name: 'TerminalResizeResponse',
    fields: [{ name: 'ack', kotlinType: 'Boolean' }],
  },

  // --- chat send / cancel (vertical slice, T-VS01 / T-VS02) ---
  {
    name: 'ChatUsage',
    doc: 'Per-turn token usage on the wire (camelCase).',
    fields: [
      { name: 'inputTokens', kotlinType: 'Int' },
      { name: 'outputTokens', kotlinType: 'Int' },
      { name: 'cacheReadTokens', kotlinType: 'Int?', default: 'null' },
      { name: 'cacheWriteTokens', kotlinType: 'Int?', default: 'null' },
    ],
  },
  {
    name: 'ChatCost',
    doc: 'The single turn-cost shape both clients format. mode is api | cli.',
    fields: [
      { name: 'model', kotlinType: 'String' },
      { name: 'mode', kotlinType: 'String' },
      { name: 'totalUsd', kotlinType: 'Double' },
      { name: 'isEstimate', kotlinType: 'Boolean' },
    ],
  },
  {
    name: 'ChatSendRequest',
    doc: 'Start a streamed chat turn. scope = per-turn retrieval (T-PRD09); honoured once context injection lands.',
    fields: [
      { name: 'conversationId', kotlinType: 'String' },
      { name: 'message', kotlinType: 'String' },
      { name: 'providerId', kotlinType: 'String?', default: 'null' },
      { name: 'scope', kotlinType: 'ContextScope?', default: 'null' },
    ],
  },
  {
    name: 'ChatTokenEvent',
    doc: 'Data of each done:false envelope: one streamed assistant token.',
    fields: [{ name: 'token', kotlinType: 'String' }],
  },
  {
    name: 'ChatSendResponse',
    doc: 'Data of the terminal done:true envelope: the full turn result.',
    fields: [
      { name: 'messageId', kotlinType: 'String' },
      { name: 'text', kotlinType: 'String' },
      { name: 'usage', kotlinType: 'ChatUsage' },
      { name: 'cost', kotlinType: 'ChatCost' },
      { name: 'cancelled', kotlinType: 'Boolean' },
      { name: 'stopReason', kotlinType: 'String' },
    ],
  },
  {
    name: 'ChatCancelRequest',
    fields: [{ name: 'conversationId', kotlinType: 'String' }],
  },
  {
    name: 'ChatCancelResponse',
    fields: [{ name: 'cancelled', kotlinType: 'Boolean' }],
  },

  // --- tool-call review payload (product-readiness Phase 1, T-PRD02) ---
  {
    name: 'ReviewFile',
    doc: 'One file in a multi-file diff the user reviews before it is written.',
    fields: [
      { name: 'path', kotlinType: 'String' },
      { name: 'diff', kotlinType: 'String' },
      { name: 'isNewFile', kotlinType: 'Boolean' },
    ],
  },
  {
    name: 'ToolReview',
    doc: 'Structured review payload on an approvalRequested event. kind is always "diff" today.',
    fields: [
      { name: 'kind', kotlinType: 'String' },
      { name: 'files', kotlinType: 'List<ReviewFile>' },
    ],
  },
  // --- git loop (product-readiness Phase 4 transport, T-PRD14/15/16) -------
  {
    name: 'GitCommitMessage',
    doc: 'Wire mirror of the core ParsedCommitMessage.',
    fields: [
      { name: 'type', kotlinType: 'String' },
      { name: 'scope', kotlinType: 'String?', default: 'null' },
      { name: 'breaking', kotlinType: 'Boolean' },
      { name: 'subject', kotlinType: 'String' },
      { name: 'body', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'GitCommitMessageRequest',
    doc: 'gitCommitMessage request — cwd + diff selectors.',
    fields: [
      { name: 'cwd', kotlinType: 'String' },
      { name: 'source', kotlinType: 'String?', default: 'null' },
      { name: 'base', kotlinType: 'String?', default: 'null' },
      { name: 'head', kotlinType: 'String?', default: 'null' },
      { name: 'branch', kotlinType: 'String?', default: 'null' },
      { name: 'providerId', kotlinType: 'String?', default: 'null' },
      { name: 'extraInstruction', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'GitCommitMessageResponse',
    doc: 'Parsed commit message + assembled text, or the parse errors after the bounded re-prompt.',
    fields: [
      { name: 'ok', kotlinType: 'Boolean' },
      { name: 'message', kotlinType: 'GitCommitMessage?', default: 'null' },
      { name: 'text', kotlinType: 'String' },
      { name: 'errors', kotlinType: 'List<String>', default: 'emptyList()' },
      { name: 'attempts', kotlinType: 'Int' },
    ],
  },
  {
    name: 'GitPrDescriptionRequest',
    doc: 'gitPrDescription request — the PR is base..head.',
    fields: [
      { name: 'cwd', kotlinType: 'String' },
      { name: 'base', kotlinType: 'String' },
      { name: 'head', kotlinType: 'String?', default: 'null' },
      { name: 'branch', kotlinType: 'String?', default: 'null' },
      { name: 'providerId', kotlinType: 'String?', default: 'null' },
      { name: 'extraInstruction', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'GitPrDescriptionResponse',
    doc: 'Sanitised PR draft — house rules already enforced in core.',
    fields: [
      { name: 'title', kotlinType: 'String' },
      { name: 'body', kotlinType: 'String' },
      { name: 'warnings', kotlinType: 'List<String>', default: 'emptyList()' },
      { name: 'commitCount', kotlinType: 'Int' },
      { name: 'truncated', kotlinType: 'Boolean' },
    ],
  },
  {
    name: 'GitSeverityCount',
    doc: 'Exhaustive per-severity finding count.',
    fields: [
      { name: 'severity', kotlinType: 'String' },
      { name: 'count', kotlinType: 'Int' },
    ],
  },
  {
    name: 'GitReviewFinding',
    doc: 'Minimal wire view of one review finding (no votes/confidence leak).',
    fields: [
      { name: 'file', kotlinType: 'String' },
      { name: 'line', kotlinType: 'Int?', default: 'null' },
      { name: 'severity', kotlinType: 'String' },
      { name: 'category', kotlinType: 'String' },
      { name: 'description', kotlinType: 'String' },
    ],
  },
  {
    name: 'GitReviewSummaryRequest',
    doc: 'gitReviewSummary request — runs the review engine over the selected diff.',
    fields: [
      { name: 'cwd', kotlinType: 'String' },
      { name: 'source', kotlinType: 'String?', default: 'null' },
      { name: 'base', kotlinType: 'String?', default: 'null' },
      { name: 'head', kotlinType: 'String?', default: 'null' },
      { name: 'providerId', kotlinType: 'String?', default: 'null' },
    ],
  },
  {
    name: 'GitReviewSummaryResponse',
    doc: 'Wire mirror of the core ChangeSummary.',
    fields: [
      { name: 'filesChanged', kotlinType: 'Int' },
      { name: 'additions', kotlinType: 'Int' },
      { name: 'deletions', kotlinType: 'Int' },
      { name: 'findingsBySeverity', kotlinType: 'List<GitSeverityCount>', default: 'emptyList()' },
      { name: 'totalFindings', kotlinType: 'Int' },
      { name: 'potentialFindings', kotlinType: 'Int' },
      { name: 'topFindings', kotlinType: 'List<GitReviewFinding>', default: 'emptyList()' },
    ],
  },
];

// Discriminated unions → Kotlin sealed hierarchies (T-PRD04). TerminalEvent
// completes the deferred ADR-009 sealed class; ToolCallEvent is the new
// tool-call lifecycle the IDE renders as approval / diff / result cards.
const sealedUnions: SealedUnion[] = [
  {
    name: 'TerminalEvent',
    doc: 'The typed event union streamed on the terminalSubscribe channel (Phase 9).',
    variants: [
      {
        kind: 'output',
        className: 'TerminalOutputEvent',
        fields: [
          { name: 'commandId', kotlinType: 'String' },
          { name: 'chunk', kotlinType: 'OutputChunk' },
        ],
      },
      {
        kind: 'status',
        className: 'TerminalStatusEvent',
        fields: [
          { name: 'commandId', kotlinType: 'String' },
          { name: 'status', kotlinType: 'String' },
        ],
      },
      {
        kind: 'inputRequested',
        className: 'TerminalInputRequestedEvent',
        fields: [
          { name: 'commandId', kotlinType: 'String' },
          { name: 'pending', kotlinType: 'PendingInput' },
        ],
      },
      {
        kind: 'inputConflict',
        className: 'TerminalInputConflictEvent',
        fields: [
          { name: 'commandId', kotlinType: 'String' },
          { name: 'inputRequestId', kotlinType: 'String' },
          { name: 'winningSurfaceId', kotlinType: 'String' },
          { name: 'losingSurfaceId', kotlinType: 'String' },
        ],
      },
      {
        kind: 'exit',
        className: 'TerminalExitEvent',
        fields: [
          { name: 'commandId', kotlinType: 'String' },
          { name: 'exitCode', kotlinType: 'Int' },
          { name: 'signal', kotlinType: 'Int?', default: 'null' },
          { name: 'durationMs', kotlinType: 'Int' },
        ],
      },
      {
        kind: 'error',
        className: 'TerminalErrorEvent',
        fields: [
          { name: 'commandId', kotlinType: 'String' },
          { name: 'message', kotlinType: 'String' },
        ],
      },
    ],
  },
  {
    name: 'ContextScope',
    doc: 'Per-turn retrieval scope the composer chips emit (T-PRD09); carried by ChatSendRequest.scope.',
    variants: [
      { kind: 'all', className: 'ContextScopeAll', fields: [] },
      {
        kind: 'roots',
        className: 'ContextScopeRoots',
        fields: [{ name: 'rootIds', kotlinType: 'List<String>' }],
      },
      { kind: 'none', className: 'ContextScopeNone', fields: [] },
    ],
  },
  {
    name: 'Annotation',
    doc: 'Chat-turn artifacts (SweepAI Message.annotations): context-snippet + code-suggestion members.',
    variants: [
      {
        kind: 'context-snippet',
        className: 'ContextSnippetAnnotation',
        fields: [
          { name: 'rootId', kotlinType: 'String' },
          { name: 'filePath', kotlinType: 'String' },
          { name: 'startLine', kotlinType: 'Int' },
          { name: 'endLine', kotlinType: 'Int' },
          { name: 'relevance', kotlinType: 'Double' },
          { name: 'category', kotlinType: 'String' },
          { name: 'preview', kotlinType: 'String' },
        ],
      },
      {
        kind: 'code-suggestion',
        className: 'CodeSuggestionAnnotation',
        fields: [
          { name: 'suggestionId', kotlinType: 'String' },
          { name: 'filePath', kotlinType: 'String' },
          { name: 'state', kotlinType: 'String' },
          { name: 'diffPreview', kotlinType: 'String' },
          { name: 'errorMessage', kotlinType: 'String?', default: 'null' },
        ],
      },
    ],
  },
  {
    name: 'ToolCallEvent',
    doc: 'The tool-call lifecycle union the IDE renders as approval / diff / result cards.',
    variants: [
      {
        kind: 'started',
        className: 'ToolCallStarted',
        fields: [
          { name: 'id', kotlinType: 'String' },
          { name: 'name', kotlinType: 'String' },
          { name: 'argsPreview', kotlinType: 'String' },
        ],
      },
      {
        kind: 'approvalRequested',
        className: 'ToolCallApprovalRequested',
        fields: [
          { name: 'id', kotlinType: 'String' },
          { name: 'level', kotlinType: 'String' },
          { name: 'riskReason', kotlinType: 'String?', default: 'null' },
          { name: 'review', kotlinType: 'ToolReview?', default: 'null' },
        ],
      },
      {
        kind: 'approvalResolved',
        className: 'ToolCallApprovalResolved',
        fields: [
          { name: 'id', kotlinType: 'String' },
          { name: 'decision', kotlinType: 'String' },
        ],
      },
      {
        kind: 'result',
        className: 'ToolCallResult',
        fields: [
          { name: 'id', kotlinType: 'String' },
          { name: 'ok', kotlinType: 'Boolean' },
          { name: 'outputPreview', kotlinType: 'String' },
        ],
      },
      {
        kind: 'error',
        className: 'ToolCallErrorEvent',
        fields: [
          { name: 'id', kotlinType: 'String' },
          { name: 'message', kotlinType: 'String' },
        ],
      },
    ],
  },
];

function emitFields(fields: Field[]): string {
  return fields
    .map((f) => `    val ${f.name}: ${f.kotlinType}${f.default ? ` = ${f.default}` : ''},`)
    .join('\n');
}

function emitClass(dc: DataClass): string {
  const doc = dc.doc ? `/** ${dc.doc} */\n` : '';
  return `${doc}@Serializable\ndata class ${dc.name}(\n${emitFields(dc.fields)}\n)`;
}

function emitVariant(union: SealedUnion, variant: Variant): string {
  const doc = variant.doc ? `/** ${variant.doc} */\n` : '';
  // A zero-field variant becomes a serializable `object` — a Kotlin `data
  // class` requires at least one parameter, and a singleton is the right shape
  // for a payload-less union member (e.g. ContextScope `all` / `none`).
  if (variant.fields.length === 0) {
    return [
      `${doc}@Serializable`,
      `@SerialName("${variant.kind}")`,
      `object ${variant.className} : ${union.name}`,
    ].join('\n');
  }
  return [
    `${doc}@Serializable`,
    `@SerialName("${variant.kind}")`,
    `data class ${variant.className}(`,
    emitFields(variant.fields),
    `) : ${union.name}`,
  ].join('\n');
}

function emitSealed(union: SealedUnion): string {
  const doc = union.doc ? `/** ${union.doc} */\n` : '';
  // @JsonClassDiscriminator pins the wire discriminator to `kind` for this
  // hierarchy only, so a plain Json { ignoreUnknownKeys = true } decodes it
  // without a module-wide classDiscriminator override.
  const parent = `${doc}@Serializable\n@JsonClassDiscriminator("kind")\nsealed interface ${union.name}`;
  const variants = union.variants.map((v) => emitVariant(union, v)).join('\n\n');
  return `${parent}\n\n${variants}`;
}

const header = `// GENERATED by scripts/codegen.ts — DO NOT EDIT BY HAND.
// Source of truth: packages/protocol/src/schema.ts
@file:OptIn(ExperimentalSerializationApi::class)

package ${KOTLIN_PACKAGE}

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
`;

const body = [...classes.map(emitClass), ...sealedUnions.map(emitSealed)].join('\n\n');
const out = `${header}\n${body}\n`;

const target = join(
  repoRoot,
  'clients/jetbrains/src/main/kotlin',
  ...KOTLIN_PACKAGE.split('.'),
  'Protocol.kt',
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, 'utf8');

const sealedClassCount = sealedUnions.reduce((n, u) => n + 1 + u.variants.length, 0);
process.stdout.write(
  `codegen: wrote ${classes.length} DTOs + ${sealedClassCount} sealed types -> ${target}\n`,
);
