import { randomUUID } from 'node:crypto';
import type { Envelope } from '@event4u-agent/protocol';
import type { SidecarClient } from './sidecar-client.js';
import type {
  AssistantMessage,
  ChatMessage,
  ChatModelSnapshot,
  ConversationMode,
} from './webview/chat-model.js';

/** The subset of `vscode.Webview` the controller needs (kept VS-Code-free for tests). */
export interface WebviewLike {
  postMessage(message: unknown): void | Thenable<boolean>;
}

interface Inbound {
  kind?: string;
  text?: string;
}

/**
 * Host-side chat controller (road-to-vertical-slice Phase 2). Bridges the
 * webview's `{kind:'send'|'stop'|'toggle-mode'}` messages to the sidecar's
 * streaming `chatSend` / `chatCancel`, pushing a fresh `{kind:'snapshot'}` on
 * every state change. One stable `conversationId` per panel session (council:
 * matches the persistence store + lets `chatCancel` target the live turn).
 */
export class ChatController {
  private readonly conversationId = randomUUID();
  private readonly messages: ChatMessage[] = [];
  private mode: ConversationMode;
  private streaming = false;
  private streamingSummary: ChatModelSnapshot['streamingSummary'] = null;
  /** The assistant message id currently streaming — guards against stale frames. */
  private activeId: string | undefined;
  /** Whether the active provider can serve a turn — corrected by the probe. */
  private providerAvailable = true;

  constructor(
    private readonly sidecar: Pick<SidecarClient, 'requestStream' | 'request'>,
    private readonly webview: WebviewLike,
    private readonly sidecarHealthy: boolean,
    mode: ConversationMode = 'api',
    /**
     * Probe whether `mode`'s provider can serve a turn. Injected by the host
     * (extension.ts spawns `claude --version` for CLI, checks the key for API).
     * Absent (tests) → availability stays optimistic.
     */
    private readonly probeAvailability?: (mode: ConversationMode) => boolean | Promise<boolean>,
  ) {
    this.mode = mode;
  }

  snapshot(): ChatModelSnapshot {
    return {
      messages: this.messages.map((m) => ({ ...m })),
      mode: this.mode,
      streamingSummary: this.streamingSummary,
      sidecarHealthy: this.sidecarHealthy,
      providerAvailable: this.providerAvailable,
    };
  }

  /** Route one inbound webview message. */
  handle(message: Inbound): void {
    switch (message?.kind) {
      case 'ready':
        this.push();
        void this.refreshAvailability();
        break;
      case 'send':
        if (typeof message.text === 'string') void this.send(message.text);
        break;
      case 'stop':
        this.stop();
        break;
      case 'toggle-mode':
        this.mode = this.mode === 'api' ? 'cli' : 'api';
        this.push();
        void this.refreshAvailability();
        break;
      default:
        break;
    }
  }

  private push(): void {
    void this.webview.postMessage({ kind: 'snapshot', snapshot: this.snapshot() });
  }

  /** Re-probe the active provider's availability and push the corrected dot. */
  private async refreshAvailability(): Promise<void> {
    if (!this.probeAvailability) return;
    try {
      const available = await this.probeAvailability(this.mode);
      if (available === this.providerAvailable) return;
      this.providerAvailable = available;
      this.push();
    } catch {
      // A failed probe is treated as "unavailable" so the dot warns rather than lies.
      if (this.providerAvailable) {
        this.providerAvailable = false;
        this.push();
      }
    }
  }

  /** API mode → sidecar default provider; CLI mode → the keyless claude-cli backend. */
  private providerId(): string | undefined {
    return this.mode === 'cli' ? 'claude-cli' : undefined;
  }

  private async send(text: string): Promise<void> {
    if (this.streaming) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const assistantId = randomUUID();
    this.messages.push({ kind: 'user', id: randomUUID(), text: trimmed });
    const assistant: AssistantMessage = {
      kind: 'assistant',
      id: assistantId,
      text: '',
      streaming: true,
      toolCalls: [],
      costFooter: null,
    };
    this.messages.push(assistant);
    this.streaming = true;
    this.activeId = assistantId;
    this.streamingSummary = { inputTokens: 0, outputTokens: 0, usdSoFar: 0 };
    this.push();

    try {
      const terminal = await this.sidecar.requestStream(
        'chatSend',
        { conversationId: this.conversationId, message: trimmed, providerId: this.providerId() },
        (frame) => {
          if (this.activeId !== assistantId) return; // stale frame from a finished turn
          assistant.text += (frame.data as { token?: string })?.token ?? '';
          this.push();
        },
      );
      if (this.activeId === assistantId) this.applyTerminal(assistant, terminal);
    } catch (err) {
      if (this.activeId === assistantId) {
        const reason = err instanceof Error ? err.message : String(err);
        if (assistant.text.length === 0) assistant.text = `⚠️ ${reason}`;
        this.finish(assistant);
      }
    }
  }

  private applyTerminal(assistant: AssistantMessage, terminal: Envelope): void {
    const data = terminal.data as
      | {
          text?: string;
          code?: string;
          message?: string;
          usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
          cost?: { totalUsd?: number };
        }
      | undefined;

    if (terminal.messageType === 'error') {
      assistant.text = `⚠️ ${data?.code ?? 'error'}: ${data?.message ?? 'request failed'}`;
    } else {
      if (typeof data?.text === 'string' && data.text.length > 0) assistant.text = data.text;
      const usage = data?.usage;
      const cost = data?.cost;
      if (usage || cost) {
        assistant.costFooter = {
          durationMs: 0,
          inputTokens: usage?.inputTokens ?? 0,
          cacheReadTokens: usage?.cacheReadTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          usd: cost?.totalUsd ?? 0,
          stepCount: 1,
          toolCallCount: 0,
          timeToFirstTokenMs: 0,
        };
      }
    }
    this.finish(assistant);
  }

  private finish(assistant: AssistantMessage): void {
    assistant.streaming = false;
    this.streaming = false;
    this.streamingSummary = null;
    this.activeId = undefined;
    this.push();
  }

  /** Cancel the live turn; the terminal (cancelled) envelope arrives via the stream and finishes it. */
  private stop(): void {
    if (!this.streaming) return;
    void this.sidecar.request('chatCancel', { conversationId: this.conversationId }).catch(() => {
      // Best-effort; if the turn already finished there is nothing to cancel.
    });
  }
}
