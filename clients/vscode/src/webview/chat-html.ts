import { escapeHtml } from './markdown.js';
import type { ChatModelSnapshot } from './chat-model.js';
import { renderSnapshot } from './render.js';

/**
 * The webview's initial HTML. The host extension calls this once when the
 * panel opens and pushes incremental updates via postMessage afterwards.
 * The bundled webview script is referenced as `scriptUri`.
 */
export function buildChatHtml(opts: {
  scriptUri: string;
  cspSource: string;
  nonce: string;
  initialSnapshot: ChatModelSnapshot;
}): string {
  const initial = renderSnapshot(opts.initialSnapshot);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'unsafe-inline'; script-src 'nonce-${opts.nonce}';" />
  <title>event4u Agent</title>
  <style>
    :root { color-scheme: var(--vscode-color-scheme); }
    body { margin: 0; padding: 0; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .event4u-app { display: flex; flex-direction: column; height: 100vh; }
    .event4u-header { display: flex; align-items: center; gap: .5rem; padding: .5rem .75rem; border-bottom: 1px solid var(--vscode-panel-border); }
    .event4u-status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-foreground); }
    .event4u-status--ready .event4u-status-dot { background: var(--vscode-charts-blue, #4af); }
    .event4u-status--streaming .event4u-status-dot { background: var(--vscode-charts-green, #4caf50); }
    .event4u-status--error .event4u-status-dot { background: var(--vscode-charts-red, #c84646); }
    .event4u-streaming { flex: 1; font-size: 0.85em; opacity: 0.8; }
    .event4u-mode-toggle { background: transparent; color: inherit; border: 1px solid var(--vscode-panel-border); padding: .15rem .5rem; cursor: pointer; }
    #chat-messages { flex: 1; overflow-y: auto; padding: .75rem; display: flex; flex-direction: column; gap: .5rem; }
    .event4u-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: .5rem .75rem; background: var(--vscode-editor-background); }
    .event4u-card header { font-weight: 600; margin-bottom: .25rem; opacity: 0.8; }
    .event4u-card--user { background: var(--vscode-editor-inactiveSelectionBackground, transparent); }
    .event4u-card--halt { border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); }
    .event4u-halt-options { display: flex; flex-wrap: wrap; gap: .25rem; margin: .25rem 0; }
    .event4u-halt-option { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .25rem .5rem; cursor: pointer; }
    .event4u-tool-call summary { cursor: pointer; }
    .event4u-cost { font-size: 0.8em; opacity: 0.7; margin-top: .25rem; }
    .event4u-streaming-tag { font-size: 0.75em; opacity: 0.7; }
    .event4u-codeblock { background: var(--vscode-textCodeBlock-background); padding: .5rem; overflow-x: auto; }
    .event4u-input { display: flex; gap: .5rem; padding: .5rem .75rem; border-top: 1px solid var(--vscode-panel-border); }
    .event4u-input textarea { flex: 1; min-height: 40px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: .25rem .5rem; font-family: inherit; }
    .event4u-input button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0 .75rem; cursor: pointer; }
    .event4u-input button[disabled] { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="event4u-app ${initial.statusClass}" id="event4u-app">
    <header class="event4u-header">
      <span class="event4u-status-dot" title="Sidecar status"></span>
      <span class="event4u-streaming" id="event4u-streaming">${escapeHtml(initial.streamingLine)}</span>
      <button class="event4u-mode-toggle" data-action="toggle-mode" id="event4u-mode">${escapeHtml(initial.modeLabel)}</button>
    </header>
    <main id="chat-messages">${initial.messagesHtml}</main>
    <footer class="event4u-input">
      <textarea id="event4u-input" placeholder="Ask event4u Agent…"></textarea>
      <button id="event4u-send" data-action="send">Send</button>
      <button id="event4u-stop" data-action="stop" disabled>Stop</button>
    </footer>
  </div>
  <script nonce="${opts.nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}
