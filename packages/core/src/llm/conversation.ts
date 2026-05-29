import type { ChatMessage, LlmMode } from '@event4u-agent/protocol';
import type { LlmBackend } from './backend.js';

/**
 * T-407 — Mode toggle in chat header.
 *
 * Per-conversation state machine that switches between API and CLI backends
 * mid-conversation. The UI calls `setMode('cli' | 'api')`; the next turn uses
 * the new backend. Switching invalidates any in-flight turn (the IDE
 * triggers the cancellation token from T-412).
 *
 * The "auto" mode in `.agent-settings.yml::llm.default_mode` is resolved by
 * the host at conversation creation:
 *   - CLI detected (T-405) → start in CLI mode
 *   - otherwise → start in API mode
 */
export interface BackendRegistry {
  api: LlmBackend;
  cli?: LlmBackend;
}

export interface ConversationStateOptions {
  conversationId: string;
  initialMode: LlmMode;
  backends: BackendRegistry;
}

export class ConversationState {
  readonly conversationId: string;
  private mode: LlmMode;
  private readonly backends: BackendRegistry;
  private readonly history: ChatMessage[] = [];

  constructor(opts: ConversationStateOptions) {
    this.conversationId = opts.conversationId;
    this.mode = this.coerceMode(opts.initialMode, opts.backends);
    this.backends = opts.backends;
  }

  getMode(): LlmMode {
    return this.mode;
  }

  setMode(mode: LlmMode): { ok: true } | { ok: false; reason: string } {
    if (mode === 'cli' && !this.backends.cli) {
      return { ok: false, reason: 'cli backend not available' };
    }
    this.mode = mode;
    return { ok: true };
  }

  currentBackend(): LlmBackend {
    return this.mode === 'cli' && this.backends.cli ? this.backends.cli : this.backends.api;
  }

  appendMessage(message: ChatMessage): void {
    this.history.push(message);
  }

  getHistory(): readonly ChatMessage[] {
    return this.history;
  }

  private coerceMode(mode: LlmMode, backends: BackendRegistry): LlmMode {
    if (mode === 'cli' && !backends.cli) return 'api';
    return mode;
  }
}

export interface ResolveDefaultModeInput {
  setting: 'api' | 'cli' | 'auto';
  cliAvailable: boolean;
}

/** Map `llm.default_mode` from settings to a concrete mode at start-up. */
export function resolveDefaultMode(input: ResolveDefaultModeInput): LlmMode {
  if (input.setting === 'api') return 'api';
  if (input.setting === 'cli') return input.cliAvailable ? 'cli' : 'api';
  // auto
  return input.cliAvailable ? 'cli' : 'api';
}
