/**
 * Host abstraction for the shared chat webview (road-to-jcef-chat-parity
 * Phase 1). The same bundle runs inside two hosts:
 *
 *  - VS Code webview — outbound via `acquireVsCodeApi().postMessage`,
 *    inbound via `window` `message` events.
 *  - JetBrains JCEF (`JBCefBrowser`) — outbound via `window.__e4uJcefPost`
 *    (a `JBCefJSQuery` hook the Kotlin host inlines into the HTML before the
 *    bundle script), inbound via `window.__e4uHostMessage(json)` which the
 *    Kotlin host invokes through `executeJavaScript`.
 *
 * `detectHostBridge` picks the right implementation at bootstrap time, so
 * `chat-app.ts` stays host-agnostic.
 */

export interface HostBridge {
  post(message: unknown): void;
  /** Subscribe to host→webview messages. Returns an unsubscribe function. */
  onMessage(handler: (message: unknown) => void): () => void;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
}

/** Globals the two hosts may (or may not) provide. */
export interface HostGlobals {
  acquireVsCodeApi?: () => VsCodeApi;
  /** JCEF outbound hook — Kotlin inlines this before the bundle script. */
  __e4uJcefPost?: (json: string) => void;
  /** JCEF inbound hook — the bridge installs it; Kotlin calls it. */
  __e4uHostMessage?: (json: string) => void;
}

export function createVsCodeBridge(vscode: VsCodeApi, win: Window): HostBridge {
  return {
    post(message: unknown): void {
      vscode.postMessage(message);
    },
    onMessage(handler: (message: unknown) => void): () => void {
      const listener = (event: Event): void => {
        handler((event as MessageEvent<unknown>).data);
      };
      win.addEventListener('message', listener);
      return () => win.removeEventListener('message', listener);
    },
  };
}

export function createJcefBridge(globals: HostGlobals): HostBridge {
  const handlers = new Set<(message: unknown) => void>();
  globals.__e4uHostMessage = (json: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return; // Malformed host payload — drop rather than crash the UI.
    }
    for (const handler of handlers) handler(parsed);
  };
  return {
    post(message: unknown): void {
      globals.__e4uJcefPost?.(JSON.stringify(message));
    },
    onMessage(handler: (message: unknown) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/**
 * Pick the bridge for the current host. VS Code wins when its API is present;
 * otherwise the JCEF hooks are assumed (the Kotlin host inlines
 * `__e4uJcefPost` before the bundle script runs). Returns `null` when neither
 * host is detected (e.g. the bundle opened in a plain browser tab).
 */
export function detectHostBridge(globals: HostGlobals, win: Window): HostBridge | null {
  if (typeof globals.acquireVsCodeApi === 'function') {
    return createVsCodeBridge(globals.acquireVsCodeApi(), win);
  }
  if (typeof globals.__e4uJcefPost === 'function') {
    return createJcefBridge(globals);
  }
  return null;
}
