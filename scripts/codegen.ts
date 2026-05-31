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
    doc: 'Start a streamed chat turn. scope (per-turn retrieval) is TS-only for the slice.',
    fields: [
      { name: 'conversationId', kotlinType: 'String' },
      { name: 'message', kotlinType: 'String' },
      { name: 'providerId', kotlinType: 'String?', default: 'null' },
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
];

function emitClass(dc: DataClass): string {
  const doc = dc.doc ? `/** ${dc.doc} */\n` : '';
  const fields = dc.fields
    .map((f) => `    val ${f.name}: ${f.kotlinType}${f.default ? ` = ${f.default}` : ''},`)
    .join('\n');
  return `${doc}@Serializable\ndata class ${dc.name}(\n${fields}\n)`;
}

const header = `// GENERATED by scripts/codegen.ts — DO NOT EDIT BY HAND.
// Source of truth: packages/protocol/src/schema.ts
package ${KOTLIN_PACKAGE}

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
`;

const body = classes.map(emitClass).join('\n\n');
const out = `${header}\n${body}\n`;

const target = join(
  repoRoot,
  'clients/jetbrains/src/main/kotlin',
  ...KOTLIN_PACKAGE.split('.'),
  'Protocol.kt',
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, 'utf8');

process.stdout.write(`codegen: wrote ${classes.length} DTOs -> ${target}\n`);
