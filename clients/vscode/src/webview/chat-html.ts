import type { ChatModelSnapshot } from './chat-model.js';
import { renderMessages } from './render.js';
import { themeCss } from './theme.js';
import { composerHtml } from './components/composer-html.js';
import { headerHtml } from './components/header-html.js';
import { welcomeHtml } from './components/welcome-html.js';

const DEFAULT_MODELS = [
  { id: 'claude-opus-4-6', priceLabel: '$15 / $75 per Mtok' },
  { id: 'claude-sonnet-4-6', priceLabel: '$3 / $15 per Mtok' },
  { id: 'claude-haiku-4-5', priceLabel: '$0.80 / $4 per Mtok' },
];

/**
 * Initial webview HTML. The host calls this once when the panel opens and
 * pushes model updates via postMessage afterwards. The bundled script
 * (chat-app.js) rebinds the DOM and applies subsequent snapshots.
 *
 * Spec: agents/roadmaps/road-to-mvp-ui-design.md § C-1 .. C-10.
 */
export function buildChatHtml(opts: {
  scriptUri: string;
  cspSource: string;
  nonce: string;
  initialSnapshot: ChatModelSnapshot;
  modelId?: string;
}): string {
  const snapshot = opts.initialSnapshot;
  const messageHtml =
    snapshot.messages.length === 0 ? welcomeHtml() : renderMessages(snapshot.messages);
  const messagesEmptyClass = snapshot.messages.length === 0 ? ' e4u-messages--empty' : '';
  const composer = composerHtml({
    mode: snapshot.mode,
    modelId: opts.modelId ?? 'claude-sonnet-4-6',
    models: DEFAULT_MODELS,
    sidecarHealthy: snapshot.sidecarHealthy,
    providerAvailable: snapshot.providerAvailable,
    streaming: snapshot.streamingSummary !== null,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'unsafe-inline'; script-src 'nonce-${opts.nonce}'; img-src ${opts.cspSource} data:;" />
  <title>event4u Agent</title>
  <style>${themeCss()}</style>
</head>
<body>
  <div class="e4u-app" id="e4u-app">
    ${headerHtml()}
    <main class="e4u-messages${messagesEmptyClass}" id="e4u-messages">${messageHtml}</main>
    ${composer}
  </div>
  <script nonce="${opts.nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}
