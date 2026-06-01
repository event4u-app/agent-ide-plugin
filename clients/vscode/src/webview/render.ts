import type {
  AssistantMessage,
  ChatMessage,
  ChatModelSnapshot,
  HaltMessage,
  UserMessage,
  ToolCallSummary,
  CostFooter,
} from './chat-model.js';
import { escapeHtml, markdownToHtml } from './markdown.js';
import { formatStepFooter, formatStreaming } from './cost-format.js';

/**
 * Server-side / pure-function HTML rendering for the chat surface. The
 * webview script (chat-app.ts) updates the DOM by setting innerHTML on the
 * `#chat-messages` container with the output of [renderMessages]. Halt-card
 * buttons + the input area carry data-action attributes so the script can
 * delegate clicks via a single event listener.
 *
 * Twins of `ChatMessageRenderer.kt` for the JetBrains side.
 */

export function renderSnapshot(snapshot: ChatModelSnapshot): {
  messagesHtml: string;
  streamingLine: string;
  modeLabel: string;
  statusClass: string;
} {
  return {
    messagesHtml: renderMessages(snapshot.messages),
    streamingLine: snapshot.streamingSummary ? formatStreaming(snapshot.streamingSummary) : '',
    modeLabel: snapshot.mode === 'cli' ? 'CLI' : 'API',
    statusClass: statusClass(snapshot),
  };
}

export function renderMessages(messages: ChatMessage[]): string {
  return messages.map((m) => renderMessage(m)).join('');
}

export function renderMessage(message: ChatMessage): string {
  switch (message.kind) {
    case 'user':
      return renderUser(message);
    case 'assistant':
      return renderAssistant(message);
    case 'halt':
      return renderHalt(message);
  }
}

function renderUser(message: UserMessage): string {
  return `<section class="e4u-card e4u-card--user" data-message-id="${message.id}">
    <header>You</header>
    <div class="e4u-card__body">${markdownToHtml(message.text)}</div>
  </section>`;
}

function renderAssistant(message: AssistantMessage): string {
  const streamingTag = message.streaming ? ' <span class="e4u-streaming-tag">streaming</span>' : '';
  const body =
    message.text.length > 0
      ? `<div class="e4u-card__body">${markdownToHtml(message.text)}</div>`
      : '';
  const tools = message.toolCalls.map(renderToolCall).join('');
  const footer = message.costFooter ? renderCostFooter(message.costFooter) : '';
  return `<section class="e4u-card e4u-card--assistant" data-message-id="${message.id}">
    <header>Agent${streamingTag}</header>
    ${body}${tools}${footer}
  </section>`;
}

function renderHalt(message: HaltMessage): string {
  const options = message.options
    .map(
      (o) =>
        `<button class="e4u-halt-option" data-action="halt-answer" data-halt-id="${escapeHtml(message.id)}" data-option-id="${escapeHtml(o.id)}" title="${escapeHtml(o.description ?? '')}">${escapeHtml(o.label)}</button>`,
    )
    .join('');
  const freeText = message.allowFreeText
    ? `<form class="e4u-halt-text" data-action="halt-text" data-halt-id="${escapeHtml(message.id)}">
        <input type="text" name="text" placeholder="Or type a free-text answer…" />
        <button type="submit">Send</button>
      </form>`
    : '';
  return `<section class="e4u-card e4u-card--halt" data-message-id="${message.id}">
    <header>Agent halted</header>
    <p>${escapeHtml(message.question)}</p>
    <div class="e4u-halt-options">${options}</div>
    ${freeText}
  </section>`;
}

function renderToolCall(call: ToolCallSummary): string {
  const mark = call.outcome === 'ok' ? '✅' : call.outcome === 'error' ? '❌' : '…';
  const args = truncate(call.argsPreview, 60);
  return `<details class="e4u-tool-call e4u-tool-call--${call.outcome}">
    <summary>${mark} ${escapeHtml(call.name)}(${escapeHtml(args)})</summary>
    ${call.output.length > 0 ? `<pre><code>${escapeHtml(call.output)}</code></pre>` : ''}
  </details>`;
}

function renderCostFooter(footer: CostFooter): string {
  return `<footer class="e4u-cost">${escapeHtml(formatStepFooter(footer))}</footer>`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function statusClass(snapshot: ChatModelSnapshot): string {
  // Red when the turn cannot run: sidecar down OR the active provider is
  // unavailable (CLI binary missing / API key absent). Green = ready to serve.
  if (!snapshot.sidecarHealthy || !snapshot.providerAvailable) return 'e4u-status--error';
  if (snapshot.streamingSummary !== null) return 'e4u-status--streaming';
  return 'e4u-status--ready';
}
