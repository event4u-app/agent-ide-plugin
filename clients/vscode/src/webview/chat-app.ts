/**
 * Webview-side chat application. Hand-rolled vanilla DOM — no Preact, no
 * framework. The host extension posts model snapshots via window.message
 * events; the script re-renders the visible parts.
 *
 * Bundle target: `clients/vscode/out/webview.js`, referenced from
 * [buildChatHtml] via a `nonce`-protected script tag.
 */

import type { ChatModelSnapshot } from './chat-model.js';
import { renderSnapshot } from './render.js';
import { escapeHtml } from './markdown.js';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare const acquireVsCodeApi: () => VsCodeApi;

interface HostInbound {
  kind: 'snapshot';
  snapshot: ChatModelSnapshot;
}

type Outbound =
  | { kind: 'send'; text: string }
  | { kind: 'stop' }
  | { kind: 'toggle-mode' }
  | { kind: 'halt-answer'; haltId: string; optionId?: string; text?: string };

export function bootstrap(globals: { document: Document; window: Window; vscode: VsCodeApi }): {
  dispose: () => void;
} {
  const { document: doc, window: win, vscode } = globals;
  const app = doc.getElementById('event4u-app');
  const messages = doc.getElementById('chat-messages');
  const streaming = doc.getElementById('event4u-streaming');
  const modeButton = doc.getElementById('event4u-mode');
  const sendButton = doc.getElementById('event4u-send') as HTMLButtonElement | null;
  const stopButton = doc.getElementById('event4u-stop') as HTMLButtonElement | null;
  const input = doc.getElementById('event4u-input') as HTMLTextAreaElement | null;

  function applySnapshot(snapshot: ChatModelSnapshot): void {
    const rendered = renderSnapshot(snapshot);
    if (messages) messages.innerHTML = rendered.messagesHtml;
    if (streaming) streaming.textContent = rendered.streamingLine;
    if (modeButton) modeButton.textContent = rendered.modeLabel;
    if (app) {
      app.classList.remove(
        'event4u-status--ready',
        'event4u-status--streaming',
        'event4u-status--error',
      );
      app.classList.add(rendered.statusClass);
    }
    if (sendButton && input) {
      sendButton.disabled = snapshot.streamingSummary !== null || input.value.trim().length === 0;
    }
    if (stopButton) stopButton.disabled = snapshot.streamingSummary === null;
  }

  function post(message: Outbound): void {
    vscode.postMessage(message);
  }

  function sendCurrent(): void {
    if (!input) return;
    const text = input.value.trim();
    if (text.length === 0) return;
    post({ kind: 'send', text });
    input.value = '';
  }

  function onClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'send') sendCurrent();
    else if (action === 'stop') post({ kind: 'stop' });
    else if (action === 'toggle-mode') post({ kind: 'toggle-mode' });
    else if (action === 'halt-answer') {
      const el = target.closest<HTMLElement>('[data-action="halt-answer"]');
      if (!el) return;
      const haltId = el.dataset.haltId;
      const optionId = el.dataset.optionId;
      if (haltId && optionId) post({ kind: 'halt-answer', haltId, optionId });
    }
  }

  function onSubmit(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (!form || form.dataset.action !== 'halt-text') return;
    const haltId = form.dataset.haltId;
    const inputEl = form.querySelector('input[name="text"]') as HTMLInputElement | null;
    if (!haltId || !inputEl) return;
    const text = inputEl.value.trim();
    if (text.length === 0) return;
    post({ kind: 'halt-answer', haltId, text });
    inputEl.value = '';
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return; // Shift+Enter inserts a newline
    event.preventDefault();
    sendCurrent();
  }

  function onInput(): void {
    if (!sendButton || !input) return;
    sendButton.disabled = input.value.trim().length === 0;
  }

  function onMessage(event: MessageEvent<HostInbound>): void {
    const data = event.data;
    if (data && data.kind === 'snapshot') applySnapshot(data.snapshot);
  }

  doc.body.addEventListener('click', onClick);
  doc.body.addEventListener('submit', onSubmit);
  input?.addEventListener('keydown', onKeydown);
  input?.addEventListener('input', onInput);
  win.addEventListener('message', onMessage as EventListener);

  vscode.postMessage({ kind: 'ready' });

  return {
    dispose() {
      doc.body.removeEventListener('click', onClick);
      doc.body.removeEventListener('submit', onSubmit);
      input?.removeEventListener('keydown', onKeydown);
      input?.removeEventListener('input', onInput);
      win.removeEventListener('message', onMessage as EventListener);
    },
  };
}

// Auto-start under the real webview only — tests import `bootstrap` directly.
declare const globalThis: { __EVENT4U_BOOTSTRAPPED__?: boolean };

if (
  typeof globalThis !== 'undefined' &&
  typeof acquireVsCodeApi !== 'undefined' &&
  !globalThis.__EVENT4U_BOOTSTRAPPED__
) {
  globalThis.__EVENT4U_BOOTSTRAPPED__ = true;
  bootstrap({ document, window, vscode: acquireVsCodeApi() });
}

// Helper kept here so the chat-html author can share a one-pass escape with
// the runtime renderer.
export { escapeHtml };
