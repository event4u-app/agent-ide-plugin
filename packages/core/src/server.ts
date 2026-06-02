import {
  AgentTurnRequestSchema,
  type ChatCancelResponse,
  ChatCancelRequestSchema,
  ChatSendRequestSchema,
  type CommandListResponse,
  CommandListRequestSchema,
  type CommandReadResponse,
  CommandReadRequestSchema,
  type ConfigListResponse,
  ConfigListRequestSchema,
  type ConfigReadResponse,
  ConfigReadRequestSchema,
  type ConnectResponse,
  ConnectRequestSchema,
  type ConversationListResponse,
  ConversationListRequestSchema,
  type ConversationRewindResponse,
  ConversationRewindRequestSchema,
  type ConversationSearchResponse,
  ConversationSearchRequestSchema,
  type CostReportResponse,
  CostReportRequestSchema,
  type Envelope,
  type EchoRequest,
  type EchoResponse,
  EchoRequestSchema,
  type GitCommitMessageResponse,
  GitCommitMessageRequestSchema,
  type GitPrDescriptionResponse,
  GitPrDescriptionRequestSchema,
  type GitReviewApplyFixResponse,
  GitReviewApplyFixRequestSchema,
  type GitReviewSummaryResponse,
  GitReviewSummaryRequestSchema,
  type OnboardingDetectResponse,
  type PingResponse,
  PingRequestSchema,
  MethodNameSchema,
  type RootStatusResponse,
  type TerminalInputResponse,
  TerminalInputRequestSchema,
  type TerminalResizeResponse,
  TerminalResizeRequestSchema,
  TerminalSubscribeRequestSchema,
  type WorkspaceFoldersChangedResponse,
  WorkspaceFoldersChangedRequestSchema,
} from '@event4u-agent/protocol';
import { WorkspaceCoordinator } from './context/workspace-coordinator.js';
import type { AgentTurnHandler } from './agent/turn-handler.js';
import { type ChatHandler, ChatRequestError, type EnvelopeSink } from './chat/handler.js';
import { type CommandHandler, CommandRequestError } from './commands/handler.js';
import { type ConfigHandler, ConfigRequestError } from './config/handler.js';
import { type CostReporter, CostRequestError } from './cost/report.js';
import { type GitHandler, GitRequestError } from './git/handler.js';
import { type TerminalHandler, TerminalRequestError } from './terminal/handler.js';
import { detectReadiness, type DetectProbes } from './onboarding/detect.js';
import { defaultDetectProbes } from './onboarding/probes.js';

/** A handler maps a validated request payload to a response payload. */
type Handler = (data: unknown) => Promise<unknown> | unknown;

/**
 * The Agent Core request/response dispatcher.
 *
 * Transport-agnostic on purpose: {@link dispatch} takes one inbound
 * {@link Envelope} and returns the response envelope. The stdio wiring lives
 * in `main.ts`; tests drive {@link dispatch} directly with no streams.
 *
 * Stateful workspace concerns (root registry, walk + index lifecycle, per-root
 * status) live behind an injected {@link WorkspaceCoordinator} (T-MR11) so the
 * dispatcher stays a thin routing layer. Streaming chat turns are delegated to
 * an injected {@link ChatHandler} (T-VS03); absent it, `chatSend` returns a
 * clean `chat_not_configured` error rather than crashing.
 */
export class Dispatcher {
  private readonly handlers: Record<string, Handler>;

  constructor(
    private readonly coordinator: WorkspaceCoordinator = new WorkspaceCoordinator(),
    private readonly chatHandler?: ChatHandler,
    private readonly gitHandler?: GitHandler,
    private readonly agentTurnHandler?: AgentTurnHandler,
    private readonly terminalHandler?: TerminalHandler,
    // First-run host readiness (T-PRD12). Defaults to live host probes;
    // injectable so the dispatcher test pins Node/key/CLI deterministically.
    private readonly onboardingProbes: DetectProbes = defaultDetectProbes(),
    // Cost Dashboard backend (T-707; ADR-035). Reads the recorded step trail and
    // aggregates it; absent → `costReport` returns `cost_not_configured`.
    private readonly costReporter?: CostReporter,
    // Command-palette data path (T-402 / T-1103). Lists/searches commands and
    // loads bodies over the live agent-config walk; absent → the two command
    // methods return `commands_not_configured`.
    private readonly commandHandler?: CommandHandler,
    // Agent-config registry data path (T-401 / ADR-050). Lists skills + rules
    // (+ commands) over the live walk; absent → `configList` returns
    // `config_not_configured`.
    private readonly configHandler?: ConfigHandler,
  ) {
    this.handlers = {
      ping: (): PingResponse => ({ result: 'pong' }),
      echo: (data: unknown): EchoResponse => {
        const req: EchoRequest = EchoRequestSchema.parse(data);
        return { text: req.text };
      },
      connect: async (data: unknown): Promise<ConnectResponse> => {
        const req = ConnectRequestSchema.parse(data ?? {});
        const status = await this.coordinator.connect(req.workspaceFolders);
        return { ack: true, roots: this.coordinator.roots(), status };
      },
      workspaceFoldersChanged: async (data: unknown): Promise<WorkspaceFoldersChangedResponse> => {
        const req = WorkspaceFoldersChangedRequestSchema.parse(data ?? {});
        const status = await this.coordinator.applyChange(req.added, req.removed);
        return { ack: true, status };
      },
      rootStatus: (): RootStatusResponse => ({ status: this.coordinator.status() }),
      // First-run readiness: pure derivation over the injected host probes.
      onboardingDetect: (): OnboardingDetectResponse => detectReadiness(this.onboardingProbes),
      chatCancel: (data: unknown): ChatCancelResponse => {
        const req = ChatCancelRequestSchema.parse(data ?? {});
        // One cancel surface per conversation (AI council fork 7A): a `chatSend`
        // turn and an `agentTurn` are mutually exclusive per conversationId, so
        // try both handlers — whichever has the in-flight turn wins.
        const chatCancelled = this.chatHandler?.cancel(req.conversationId) ?? false;
        const agentCancelled = this.agentTurnHandler?.cancel(req.conversationId) ?? false;
        return { cancelled: chatCancelled || agentCancelled };
      },
      gitCommitMessage: (data: unknown): Promise<GitCommitMessageResponse> =>
        this.requireGit().commitMessage(GitCommitMessageRequestSchema.parse(data ?? {})),
      gitPrDescription: (data: unknown): Promise<GitPrDescriptionResponse> =>
        this.requireGit().prDescription(GitPrDescriptionRequestSchema.parse(data ?? {})),
      gitReviewSummary: (data: unknown): Promise<GitReviewSummaryResponse> =>
        this.requireGit().reviewSummary(GitReviewSummaryRequestSchema.parse(data ?? {})),
      gitReviewApplyFix: (data: unknown): Promise<GitReviewApplyFixResponse> =>
        this.requireGit().reviewApplyFix(GitReviewApplyFixRequestSchema.parse(data ?? {})),
      // Conversation rewind (T-1303): pure non-mutating plan; the IDE applies it.
      conversationRewind: (data: unknown): Promise<ConversationRewindResponse> =>
        this.requireChat().rewind(ConversationRewindRequestSchema.parse(data ?? {})),
      // Conversation search (T-1301): read-only ranked scan across history.
      conversationSearch: (data: unknown): Promise<ConversationSearchResponse> =>
        this.requireChat().search(ConversationSearchRequestSchema.parse(data ?? {})),
      // Conversation list (T-1301): read-only newest-first sidebar listing.
      conversationList: (data: unknown): Promise<ConversationListResponse> =>
        this.requireChat().list(ConversationListRequestSchema.parse(data ?? {})),
      // Cost Dashboard backend (T-707; ADR-035): aggregate the recorded step trail.
      costReport: (data: unknown): Promise<CostReportResponse> =>
        this.requireCost().report(CostReportRequestSchema.parse(data ?? {})),
      // Command palette (T-402 / T-1103): read-only list/search + body load.
      commandList: (data: unknown): Promise<CommandListResponse> =>
        this.requireCommands().list(CommandListRequestSchema.parse(data ?? {})),
      commandRead: (data: unknown): Promise<CommandReadResponse> =>
        this.requireCommands().read(CommandReadRequestSchema.parse(data ?? {})),
      // Agent-config registry (T-401 / ADR-050): read-only skill/rule/command
      // listing + body read (the configList contract's read sibling, ADR-052).
      configList: (data: unknown): Promise<ConfigListResponse> =>
        this.requireConfig().list(ConfigListRequestSchema.parse(data ?? {})),
      configRead: (data: unknown): Promise<ConfigReadResponse> =>
        this.requireConfig().read(ConfigReadRequestSchema.parse(data ?? {})),
      // Live terminal: input + resize are plain request/response (T-PRD03);
      // `terminalSubscribe` is streaming and handled in `dispatch` below.
      terminalInput: (data: unknown): TerminalInputResponse =>
        this.requireTerminal().handleInput(TerminalInputRequestSchema.parse(data ?? {})),
      terminalResize: (data: unknown): TerminalResizeResponse =>
        this.requireTerminal().handleResize(TerminalResizeRequestSchema.parse(data ?? {})),
    };
  }

  /** The git handler or a coded error so absent wiring surfaces cleanly. */
  private requireGit(): GitHandler {
    if (!this.gitHandler) {
      throw new GitRequestError(
        'git_not_configured',
        'No git handler is configured on this Core instance.',
      );
    }
    return this.gitHandler;
  }

  /** The chat handler or a coded error so absent wiring surfaces cleanly. */
  private requireChat(): ChatHandler {
    if (!this.chatHandler) {
      throw new ChatRequestError(
        'chat_not_configured',
        'No chat handler is configured on this Core instance.',
      );
    }
    return this.chatHandler;
  }

  /** The command handler or a coded error so absent wiring surfaces cleanly. */
  private requireCommands(): CommandHandler {
    if (!this.commandHandler) {
      throw new CommandRequestError(
        'commands_not_configured',
        'No command handler is configured on this Core instance.',
      );
    }
    return this.commandHandler;
  }

  /** The config handler or a coded error so absent wiring surfaces cleanly. */
  private requireConfig(): ConfigHandler {
    if (!this.configHandler) {
      throw new ConfigRequestError(
        'config_not_configured',
        'No config handler is configured on this Core instance.',
      );
    }
    return this.configHandler;
  }

  /** The cost reporter or a coded error so absent wiring surfaces cleanly. */
  private requireCost(): CostReporter {
    if (!this.costReporter) {
      throw new CostRequestError(
        'cost_not_configured',
        'No cost reporter is configured on this Core instance.',
      );
    }
    return this.costReporter;
  }

  /** The terminal handler or a coded error so absent wiring surfaces cleanly. */
  private requireTerminal(): TerminalHandler {
    if (!this.terminalHandler) {
      throw new TerminalRequestError(
        'terminal_not_configured',
        'No terminal handler is configured on this Core instance.',
      );
    }
    return this.terminalHandler;
  }

  /** Release the workspace coordinator's timers + live terminal sessions (shutdown). */
  dispose(): void {
    this.coordinator.dispose();
    this.terminalHandler?.dispose();
  }

  /**
   * Dispatch one inbound envelope and resolve with the terminal response.
   *
   * Request/response methods return their single envelope and never touch
   * `emit`. The streaming `chatSend` method pushes `done:false` token envelopes
   * through `emit` and resolves with the terminal `done:true` envelope — so the
   * dispatcher always returns exactly one terminal envelope and never rejects
   * (errors are wrapped), keeping a streaming client from hanging.
   */
  async dispatch(envelope: Envelope, emit?: EnvelopeSink): Promise<Envelope> {
    const methodResult = MethodNameSchema.safeParse(envelope.messageType);
    if (!methodResult.success) {
      return this.errorEnvelope(
        envelope.messageId,
        'unknown_method',
        `Unknown messageType: ${envelope.messageType}`,
      );
    }

    const method = methodResult.data;
    // `ping` takes no payload; validate it has the empty shape.
    if (method === 'ping') {
      PingRequestSchema.parse(envelope.data ?? {});
    }

    // Streaming method — delegated; the handler emits `done:false` tokens and
    // returns the terminal envelope.
    if (method === 'chatSend') {
      if (!this.chatHandler) {
        return this.errorEnvelope(
          envelope.messageId,
          'chat_not_configured',
          'No chat handler is configured on this Core instance.',
        );
      }
      try {
        const req = ChatSendRequestSchema.parse(envelope.data ?? {});
        return await this.chatHandler.handleSend(envelope.messageId, req, emit ?? (() => {}));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'handler_error';
        return this.errorEnvelope(envelope.messageId, code, message);
      }
    }

    // Streaming method — the agentic tool-loop turn (chat that edits files).
    if (method === 'agentTurn') {
      if (!this.agentTurnHandler) {
        return this.errorEnvelope(
          envelope.messageId,
          'agent_not_configured',
          'No agent-turn handler is configured on this Core instance.',
        );
      }
      try {
        const req = AgentTurnRequestSchema.parse(envelope.data ?? {});
        return await this.agentTurnHandler.handleTurn(envelope.messageId, req, emit ?? (() => {}));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'handler_error';
        return this.errorEnvelope(envelope.messageId, code, message);
      }
    }

    // Streaming method — the live terminal subscription. Emits the replay +
    // live events as `done:false` and returns the terminal `exit` envelope.
    if (method === 'terminalSubscribe') {
      if (!this.terminalHandler) {
        return this.errorEnvelope(
          envelope.messageId,
          'terminal_not_configured',
          'No terminal handler is configured on this Core instance.',
        );
      }
      try {
        const req = TerminalSubscribeRequestSchema.parse(envelope.data ?? {});
        return await this.terminalHandler.handleSubscribe(
          envelope.messageId,
          req,
          emit ?? (() => {}),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'handler_error';
        return this.errorEnvelope(envelope.messageId, code, message);
      }
    }

    try {
      const result = await this.handlers[method]!(envelope.data);
      return {
        messageId: envelope.messageId,
        messageType: method,
        data: result,
        done: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A handler MAY carry a string `code` (e.g. `git_not_configured`); honour
      // it so the client sees the specific cause, mirroring the `chatSend` path.
      const code =
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'handler_error';
      return this.errorEnvelope(envelope.messageId, code, message);
    }
  }

  private errorEnvelope(messageId: string, code: string, message: string): Envelope {
    return {
      messageId,
      messageType: 'error',
      data: { code, message },
      done: true,
    };
  }
}
