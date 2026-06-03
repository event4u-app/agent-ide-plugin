import { composerHtml } from './components/composer-html.js';
import { headerHtml } from './components/header-html.js';
import { welcomeHtml } from './components/welcome-html.js';
import { DEFAULT_MODELS } from './chat-html.js';
import { themeCss } from './theme.js';

/**
 * Self-contained HTML document for the JetBrains JCEF host
 * (road-to-jcef-chat-parity Phase 1, council fork 2A: `loadHTML()` with the
 * bundle inlined — no URLs, no scheme handler).
 *
 * Differences from the VS Code shell (`chat-html.ts`):
 *  - No CSP meta / nonce — the document is host-built from plugin resources,
 *    never remote, and JCEF `loadHTML` has no `webview.cspSource` notion.
 *  - The chat-app bundle is inlined via the `%E4U_BUNDLE%` placeholder
 *    (substituted by `scripts/build-jcef-html.mjs` at build time).
 *  - Two Kotlin-side placeholders:
 *      `<!--%E4U_BRIDGE%-->` — replaced with the `JBCefJSQuery` hook script
 *        (defines `window.__e4uJcefPost`) BEFORE the bundle runs.
 *      `%E4U_THEME%` (in a CSS comment inside `<style id="e4u-jb-theme">`) —
 *        replaced with `:root` variable overrides mapped from the IDE theme.
 *  - The empty-state snapshot is optimistic (healthy, provider available);
 *    the Kotlin host pushes the real snapshot right after the webview's
 *    `ready` message, exactly like the VS Code host does.
 */
export function buildJcefChatHtml(): string {
  const composer = composerHtml({
    mode: 'api',
    modelId: 'claude-sonnet-4-6',
    models: DEFAULT_MODELS,
    sidecarHealthy: true,
    providerAvailable: true,
    streaming: false,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>event4u Agent</title>
  <style>${themeCss()}</style>
  <style id="e4u-jb-theme">/*%E4U_THEME%*/</style>
</head>
<body>
  <div class="e4u-app" id="e4u-app">
    ${headerHtml()}
    <main class="e4u-messages e4u-messages--empty" id="e4u-messages">${welcomeHtml()}</main>
    ${composer}
  </div>
  <!--%E4U_BRIDGE%-->
  <script>%E4U_BUNDLE%</script>
</body>
</html>`;
}
