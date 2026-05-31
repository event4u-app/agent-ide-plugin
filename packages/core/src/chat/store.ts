import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { foldConversation, type FoldOptions } from './fold.js';
import { type SearchOptions, searchConversations } from './search.js';
import {
  CHAT_SCHEMA_VERSION,
  type Checkpoint,
  type Conversation,
  type ConversationEvent,
  type ConversationRole,
  type ConversationSearchResult,
  type ConversationSummary,
  type StoredMessage,
} from './types.js';

export interface CreateOptions {
  id?: string;
  title?: string;
}
export interface AppendMessageInput {
  role: ConversationRole;
  content: string;
  /** Override the generated message id (e.g. to mirror a protocol message). */
  id?: string;
}
export interface RecordCheckpointInput {
  label?: string;
  phase?: string;
  changedFiles?: string[];
  workState?: unknown;
  id?: string;
}
export interface ForkOptions {
  newId?: string;
  /** Replace the user turn at the fork point with this edited text (T-1302). */
  editedUserMessage?: string;
  title?: string;
}

/**
 * Durable conversation facts (T-1301/1302/1303). The IDE renders the list,
 * opens a conversation, offers the fork/rewind affordances; this store owns
 * persistence, copy-on-write forking, checkpoint recording, and search.
 */
export interface ConversationStore {
  create(options?: CreateOptions): Promise<Conversation>;
  appendMessage(
    conversationId: string,
    input: AppendMessageInput,
  ): Promise<StoredMessage | undefined>;
  recordCheckpoint(
    conversationId: string,
    input: RecordCheckpointInput,
  ): Promise<Checkpoint | undefined>;
  load(conversationId: string): Promise<Conversation | undefined>;
  list(): Promise<ConversationSummary[]>;
  search(query: string, options?: SearchOptions): Promise<ConversationSearchResult[]>;
  fork(
    conversationId: string,
    atTurnIndex: number,
    options?: ForkOptions,
  ): Promise<Conversation | undefined>;
}

export interface ConversationStoreDeps {
  /** ISO-8601 clock — injected for deterministic tests. */
  now?: () => string;
  /** Unique-id factory — injected for deterministic tests. */
  idFactory?: () => string;
  /** Fold options (e.g. checkpoint retention cap). */
  fold?: FoldOptions;
}

let monotonic = 0;

/**
 * Shared mechanics for both stores. Subclasses implement only the storage
 * primitives (`write` an event, `load` one conversation, `loadAll`); every
 * high-level operation is expressed as appended events + a fold, so the
 * in-memory and on-disk stores cannot diverge in behaviour.
 */
export abstract class BaseConversationStore implements ConversationStore {
  protected readonly now: () => string;
  protected readonly idFactory: () => string;
  protected readonly foldOptions: FoldOptions | undefined;

  constructor(deps?: ConversationStoreDeps) {
    this.now = deps?.now ?? (() => new Date().toISOString());
    this.idFactory = deps?.idFactory ?? defaultIdFactory;
    this.foldOptions = deps?.fold;
  }

  protected abstract write(conversationId: string, events: ConversationEvent[]): Promise<void>;
  abstract load(conversationId: string): Promise<Conversation | undefined>;
  protected abstract loadAll(): Promise<Conversation[]>;

  async create(options?: CreateOptions): Promise<Conversation> {
    const id = options?.id ?? this.idFactory();
    const event: ConversationEvent = {
      type: 'created',
      v: CHAT_SCHEMA_VERSION,
      at: this.now(),
      id,
      ...(options?.title ? { title: options.title } : {}),
    };
    await this.write(id, [event]);
    return (await this.load(id)) ?? emptyConversation(id, event.at, options?.title);
  }

  async appendMessage(
    conversationId: string,
    input: AppendMessageInput,
  ): Promise<StoredMessage | undefined> {
    const existing = await this.load(conversationId);
    if (!existing) return undefined;
    const at = this.now();
    const id = input.id ?? this.idFactory();
    await this.write(conversationId, [
      { type: 'message', v: CHAT_SCHEMA_VERSION, at, id, role: input.role, content: input.content },
    ]);
    return {
      id,
      role: input.role,
      content: input.content,
      at,
      turnIndex: existing.messages.length,
    };
  }

  async recordCheckpoint(
    conversationId: string,
    input: RecordCheckpointInput,
  ): Promise<Checkpoint | undefined> {
    const existing = await this.load(conversationId);
    if (!existing) return undefined;
    const at = this.now();
    const id = input.id ?? this.idFactory();
    const changedFiles = input.changedFiles ?? [];
    await this.write(conversationId, [
      {
        type: 'checkpoint',
        v: CHAT_SCHEMA_VERSION,
        at,
        id,
        ...(input.label ? { label: input.label } : {}),
        ...(input.phase ? { phase: input.phase } : {}),
        turnIndex: existing.messages.length,
        changedFiles,
        ...(input.workState !== undefined ? { workState: input.workState } : {}),
      },
    ]);
    return {
      id,
      label: input.label,
      phase: input.phase,
      turnIndex: existing.messages.length,
      changedFiles,
      workState: input.workState,
      at,
    };
  }

  async list(): Promise<ConversationSummary[]> {
    const all = await this.loadAll();
    return all.map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(query: string, options?: SearchOptions): Promise<ConversationSearchResult[]> {
    return searchConversations(await this.loadAll(), query, options);
  }

  async fork(
    conversationId: string,
    atTurnIndex: number,
    options?: ForkOptions,
  ): Promise<Conversation | undefined> {
    const source = await this.load(conversationId);
    if (!source) return undefined;

    // Clamp to a valid prefix — fork never invents turns the parent lacks.
    const cut = Math.max(0, Math.min(atTurnIndex, source.messages.length));
    const newId = options?.newId ?? this.idFactory();
    const at = this.now();

    const events: ConversationEvent[] = [
      {
        type: 'created',
        v: CHAT_SCHEMA_VERSION,
        at,
        id: newId,
        ...(options?.title ? { title: options.title } : {}),
        parentId: conversationId,
        forkedFromTurnIndex: cut,
      },
    ];
    // Copy-on-write: replay the kept prefix as fresh message events.
    for (const message of source.messages.slice(0, cut)) {
      events.push({
        type: 'message',
        v: CHAT_SCHEMA_VERSION,
        at: message.at,
        id: message.id,
        role: message.role,
        content: message.content,
      });
    }
    if (options?.editedUserMessage !== undefined) {
      events.push({
        type: 'message',
        v: CHAT_SCHEMA_VERSION,
        at,
        id: this.idFactory(),
        role: 'user',
        content: options.editedUserMessage,
      });
    }

    await this.write(newId, events);
    return this.load(newId);
  }
}

/** In-memory store for tests and ephemeral runs. */
export class InMemoryConversationStore extends BaseConversationStore {
  private readonly logs = new Map<string, ConversationEvent[]>();

  protected async write(conversationId: string, events: ConversationEvent[]): Promise<void> {
    const log = this.logs.get(conversationId) ?? [];
    log.push(...events);
    this.logs.set(conversationId, log);
  }

  async load(conversationId: string): Promise<Conversation | undefined> {
    const log = this.logs.get(conversationId);
    if (!log) return undefined;
    return foldLines(log, this.foldOptions);
  }

  protected async loadAll(): Promise<Conversation[]> {
    const out: Conversation[] = [];
    for (const log of this.logs.values()) {
      const conversation = foldLines(log, this.foldOptions);
      if (conversation) out.push(conversation);
    }
    return out;
  }
}

/**
 * Persists each conversation as one append-only JSONL log under `baseDir`
 * (the workspace's `.event4u-agent/chats/`). Reads fold; a torn line degrades
 * gracefully (fail-open) instead of corrupting the conversation.
 */
export class FileConversationStore extends BaseConversationStore {
  constructor(
    private readonly baseDir: string,
    deps?: ConversationStoreDeps,
  ) {
    super(deps);
  }

  protected async write(conversationId: string, events: ConversationEvent[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const body = events.map((e) => JSON.stringify(e)).join('\n');
    await appendFile(this.pathFor(conversationId), `${body}\n`, 'utf8');
  }

  async load(conversationId: string): Promise<Conversation | undefined> {
    const text = await readFile(this.pathFor(conversationId), 'utf8').catch(() => undefined);
    if (text === undefined) return undefined;
    return foldConversation(text.split('\n'), this.foldOptions);
  }

  protected async loadAll(): Promise<Conversation[]> {
    let files: string[];
    try {
      files = await readdir(this.baseDir);
    } catch {
      return []; // no chats dir yet
    }
    const out: Conversation[] = [];
    for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
      const text = await readFile(join(this.baseDir, file), 'utf8').catch(() => undefined);
      if (text === undefined) continue;
      const conversation = foldConversation(text.split('\n'), this.foldOptions);
      if (conversation) out.push(conversation);
    }
    return out;
  }

  private pathFor(conversationId: string): string {
    return join(this.baseDir, `${sanitizeId(conversationId)}.jsonl`);
  }
}

function foldLines(
  events: ConversationEvent[],
  options: FoldOptions | undefined,
): Conversation | undefined {
  // The in-memory log already holds parsed events; fold via the JSONL path so
  // both stores share one fold implementation.
  return foldConversation(
    events.map((e) => JSON.stringify(e)),
    options,
  );
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    parentId: conversation.parentId,
    messageCount: conversation.messages.length,
    checkpointCount: conversation.checkpoints.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function emptyConversation(id: string, at: string, title?: string): Conversation {
  return {
    id,
    title: title || 'Untitled conversation',
    messages: [],
    checkpoints: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** Keep file names filesystem-safe; the real id lives in the `created` event. */
function sanitizeId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length > 0 ? safe : 'conversation';
}

function defaultIdFactory(): string {
  monotonic = (monotonic + 1) % 1_000_000;
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `conv-${Date.now().toString(36)}-${monotonic.toString(36)}-${rand}`;
}
