import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SidecarClient } from './sidecar-client.js';
import { getWebviewHtml } from './webview.js';

let sidecar: SidecarClient | undefined;

/**
 * Resolve the Agent Core sidecar entrypoint.
 *
 * Tricky-problem note (per road-to-mvp T-105): in development the sidecar
 * lives in the sibling `packages/core` workspace; in a packaged `.vsix` it
 * must be bundled alongside the extension and run with a bundled Node. The
 * dev path below is the MVP skeleton; packaging is Sprint 4 (T-406).
 */
function resolveSidecarPath(context: vscode.ExtensionContext): string {
  const bundled = path.join(context.extensionPath, 'sidecar', 'server.js');
  // Dev fallback: monorepo layout clients/vscode -> packages/core.
  const dev = path.join(context.extensionPath, '..', '..', 'packages', 'core', 'dist', 'server.js');
  return existsSync(bundled) ? bundled : dev;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverPath = resolveSidecarPath(context);

  const openChat = vscode.commands.registerCommand('event4u.openChat', async () => {
    const panel = vscode.window.createWebviewPanel(
      'event4uAgentChat',
      'event4u Agent',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    let healthLine = 'Sidecar: starting…';
    try {
      sidecar ??= new SidecarClient(serverPath);
      sidecar.start();
      healthLine = (await sidecar.healthy()) ? 'Sidecar healthy: pong' : 'Sidecar unreachable';
    } catch (error) {
      healthLine = `Sidecar error: ${error instanceof Error ? error.message : String(error)}`;
    }

    panel.webview.html = getWebviewHtml(healthLine);
  });

  context.subscriptions.push(openChat);
  context.subscriptions.push({ dispose: () => sidecar?.dispose() });
}

export function deactivate(): void {
  sidecar?.dispose();
  sidecar = undefined;
}
