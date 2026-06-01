/**
 * Webview-side message model. Mirrors the JetBrains Kotlin types in
 * `clients/jetbrains/src/main/kotlin/de/event4u/agent/chat/ChatModel.kt`.
 * Pure data — no DOM here.
 */

export type ConversationMode = 'api' | 'cli';

export interface UserMessage {
  kind: 'user';
  id: string;
  text: string;
}

export interface AssistantMessage {
  kind: 'assistant';
  id: string;
  text: string;
  streaming: boolean;
  toolCalls: ToolCallSummary[];
  costFooter: CostFooter | null;
}

export interface HaltMessage {
  kind: 'halt';
  id: string;
  question: string;
  options: HaltOption[];
  allowFreeText: boolean;
}

export interface HaltOption {
  id: string;
  label: string;
  description?: string;
}

export type ToolOutcome = 'ok' | 'error' | 'pending';

export interface ToolCallSummary {
  name: string;
  argsPreview: string;
  outcome: ToolOutcome;
  output: string;
}

export interface CostFooter {
  durationMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  usd: number;
  stepCount: number;
  toolCallCount: number;
  timeToFirstTokenMs: number;
}

export interface StreamingSummary {
  inputTokens: number;
  outputTokens: number;
  usdSoFar: number;
}

export type ChatMessage = UserMessage | AssistantMessage | HaltMessage;

export interface ChatModelSnapshot {
  messages: ChatMessage[];
  mode: ConversationMode;
  streamingSummary: StreamingSummary | null;
  sidecarHealthy: boolean;
  /**
   * Whether the active provider can actually serve a turn — CLI mode: the
   * `claude` binary is on PATH; API mode: a key is configured. Drives the
   * mode-pill status dot (green = available, red = unavailable). Probed by the
   * host on open and on every mode switch.
   */
  providerAvailable: boolean;
}
