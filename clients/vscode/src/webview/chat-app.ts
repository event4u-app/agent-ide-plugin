/**
 * Webview chat application. Wires the static HTML built by `chat-html.ts` to
 * the host extension via `acquireVsCodeApi().postMessage`. Listens for
 * snapshot pushes from the host, re-renders the message region, mirrors
 * streaming + sidecar-health into the mode-pill status dot, and forwards
 * user actions back as Outbound messages.
 *
 * Bundle target: `clients/vscode/out/webview.js`.
 */

import type { ChatModelSnapshot } from './chat-model.js';
import { renderMessages } from './render.js';
import { welcomeHtml } from './components/welcome-html.js';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare const acquireVsCodeApi: () => VsCodeApi;

interface HostSnapshot {
  kind: 'snapshot';
  snapshot: ChatModelSnapshot;
}

interface HostAttachmentAdded {
  kind: 'attachment-added';
  label: string;
  path: string;
}

type HostInbound = HostSnapshot | HostAttachmentAdded;

type Outbound =
  | { kind: 'ready' }
  | { kind: 'send'; text: string }
  | { kind: 'stop' }
  | { kind: 'toggle-mode' }
  | { kind: 'pick-model'; modelId: string }
  | { kind: 'open-command' }
  | { kind: 'open-mention' }
  | { kind: 'attach' }
  | { kind: 'attach-files'; paths: string[] }
  | { kind: 'halt-answer'; haltId: string; optionId?: string; text?: string };

export function bootstrap(globals: { document: Document; window: Window; vscode: VsCodeApi }): {
  dispose: () => void;
} {
  const { document: doc, window: win, vscode } = globals;
  const messagesContainer = doc.getElementById('e4u-messages');
  const composer = doc.getElementById('e4u-composer') as HTMLFormElement | null;
  const input = doc.getElementById('e4u-input') as HTMLTextAreaElement | null;
  const sendButton = doc.getElementById('e4u-send') as HTMLButtonElement | null;
  const stopButton = doc.getElementById('e4u-stop') as HTMLButtonElement | null;
  const modePill = doc.getElementById('e4u-mode') as HTMLButtonElement | null;
  const modeLabel = doc.getElementById('e4u-mode-label') as HTMLSpanElement | null;
  const modelSelect = doc.getElementById('e4u-model') as HTMLSelectElement | null;
  const chipRail = doc.getElementById('e4u-chips');

  function post(message: Outbound): void {
    vscode.postMessage(message);
  }

  function applySnapshot(snapshot: ChatModelSnapshot): void {
    if (messagesContainer) {
      messagesContainer.classList.toggle('e4u-messages--empty', snapshot.messages.length === 0);
      messagesContainer.innerHTML =
        snapshot.messages.length === 0 ? welcomeHtml() : renderMessages(snapshot.messages);
    }
    if (modePill) {
      modePill.classList.remove(
        'e4u-mode-pill--ready',
        'e4u-mode-pill--streaming',
        'e4u-mode-pill--error',
      );
      const cls =
        !snapshot.sidecarHealthy || !snapshot.providerAvailable
          ? 'e4u-mode-pill--error'
          : snapshot.streamingSummary !== null
            ? 'e4u-mode-pill--streaming'
            : 'e4u-mode-pill--ready';
      modePill.classList.add(cls);
    }
    if (modeLabel) {
      modeLabel.textContent = snapshot.mode.toUpperCase();
    }
    if (stopButton) stopButton.disabled = snapshot.streamingSummary === null;
    refreshSendEnabled(snapshot.streamingSummary !== null);
  }

  function refreshSendEnabled(streaming: boolean): void {
    if (!sendButton || !input) return;
    sendButton.disabled = streaming || input.value.trim().length === 0;
  }

  function sendCurrent(): void {
    if (!input) return;
    const text = input.value.trim();
    if (text.length === 0) return;
    post({ kind: 'send', text });
    input.value = '';
    refreshSendEnabled(stopButton?.disabled === false);
  }

  function onClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    switch (action) {
      case 'send':
        sendCurrent();
        break;
      case 'stop':
        post({ kind: 'stop' });
        break;
      case 'toggle-mode':
        post({ kind: 'toggle-mode' });
        break;
      case 'open-command':
        post({ kind: 'open-command' });
        break;
      case 'open-mention':
        post({ kind: 'open-mention' });
        break;
      case 'attach':
        post({ kind: 'attach' });
        break;
      case 'halt-answer': {
        const haltId = actionEl.dataset.haltId;
        const optionId = actionEl.dataset.optionId;
        if (haltId && optionId) post({ kind: 'halt-answer', haltId, optionId });
        break;
      }
    }
  }

  function onSubmit(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (form && form.dataset.action === 'halt-text') {
      const haltId = form.dataset.haltId;
      const inputEl = form.querySelector('input[name="text"]') as HTMLInputElement | null;
      if (haltId && inputEl) {
        const text = inputEl.value.trim();
        if (text.length > 0) {
          post({ kind: 'halt-answer', haltId, text });
          inputEl.value = '';
        }
      }
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendCurrent();
    } else if (event.key === 'Escape' && stopButton && !stopButton.disabled) {
      event.preventDefault();
      post({ kind: 'stop' });
    }
  }

  function onInput(): void {
    refreshSendEnabled(stopButton?.disabled === false);
  }

  function onModelChange(): void {
    if (!modelSelect) return;
    post({ kind: 'pick-model', modelId: modelSelect.value });
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    composer?.classList.remove('e4u-composer--dragover');
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files.item(i);
      if (file) paths.push(file.name);
    }
    if (paths.length > 0) post({ kind: 'attach-files', paths });
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
    composer?.classList.add('e4u-composer--dragover');
  }

  function onDragLeave(): void {
    composer?.classList.remove('e4u-composer--dragover');
  }

  function addAttachmentChip(label: string): void {
    if (!chipRail) return;
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'e4u-chip e4u-chip--file';
    chip.dataset.action = 'noop';
    chip.textContent = label;
    const remove = doc.createElement('span');
    remove.className = 'e4u-chip__remove';
    remove.textContent = '×';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      chip.remove();
    });
    chip.appendChild(remove);
    chipRail.appendChild(chip);
  }

  function onMessage(event: MessageEvent<HostInbound>): void {
    const data = event.data;
    if (!data) return;
    if (data.kind === 'snapshot') applySnapshot(data.snapshot);
    else if (data.kind === 'attachment-added') addAttachmentChip(data.label);
  }

  doc.body.addEventListener('click', onClick);
  doc.body.addEventListener('submit', onSubmit);
  input?.addEventListener('keydown', onKeydown);
  input?.addEventListener('input', onInput);
  modelSelect?.addEventListener('change', onModelChange);
  composer?.addEventListener('dragover', onDragOver);
  composer?.addEventListener('dragleave', onDragLeave);
  composer?.addEventListener('drop', onDrop);
  win.addEventListener('message', onMessage as EventListener);

  post({ kind: 'ready' });

  return {
    dispose() {
      doc.body.removeEventListener('click', onClick);
      doc.body.removeEventListener('submit', onSubmit);
      input?.removeEventListener('keydown', onKeydown);
      input?.removeEventListener('input', onInput);
      modelSelect?.removeEventListener('change', onModelChange);
      composer?.removeEventListener('dragover', onDragOver);
      composer?.removeEventListener('dragleave', onDragLeave);
      composer?.removeEventListener('drop', onDrop);
      win.removeEventListener('message', onMessage as EventListener);
    },
  };
}

declare const globalThis: { __EVENT4U_BOOTSTRAPPED__?: boolean };

if (
  typeof globalThis !== 'undefined' &&
  typeof acquireVsCodeApi !== 'undefined' &&
  !globalThis.__EVENT4U_BOOTSTRAPPED__
) {
  globalThis.__EVENT4U_BOOTSTRAPPED__ = true;
  bootstrap({ document, window, vscode: acquireVsCodeApi() });
}
