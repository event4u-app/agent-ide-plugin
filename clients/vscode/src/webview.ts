/**
 * Webview HTML for the chat panel skeleton (T-104).
 *
 * Pure string builder so it is unit-testable without an Extension Host. The
 * Preact-based chat UI lands in Phase 2 (T-203); this is the empty shell plus
 * the sidecar-health line from the RPC hello-world (T-105).
 */
export function getWebviewHtml(healthLine: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>event4u Agent</title>
    <style>
      body {
        font-family: var(--vscode-font-family, sans-serif);
        color: var(--vscode-foreground);
        padding: 1rem;
      }
      .status { opacity: 0.8; font-size: 0.9em; }
    </style>
  </head>
  <body>
    <h2>event4u Agent</h2>
    <p class="status" data-testid="sidecar-status">${healthLine}</p>
    <p>Chat UI arrives in Sprint 2.</p>
  </body>
</html>`;
}
