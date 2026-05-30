import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SidecarClient } from './sidecar-client.js';
import { mapWorkspaceFolders, mapWorkspaceFoldersChange } from './workspace-folders.js';
import { buildChatHtml } from './webview/chat-html.js';
import { formatStatusbar } from './webview/cost-format.js';
import type { ChatModelSnapshot } from './webview/chat-model.js';

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

  // T-207 — statusbar widget. The cost number is wired via the host service
  // once the project-level controller lands (see road-to-mvp-ui-finish.md).
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  status.text = formatStatusbar('claude-sonnet-4-6', 0);
  status.tooltip = 'event4u Agent — click for cost details (Cost Dashboard ships in v1.0 Sprint 7)';
  status.command = 'event4u.openChat';
  status.show();
  context.subscriptions.push(status);

  // T-MR09 — auto-enumerate the IDE window's open roots and keep the Core in
  // sync, with no user action (handles .code-workspace multi-folder, the
  // no-folder window, renames, order changes, duplicate basenames, and
  // virtual / remote URIs — `uri.toString()` is the stable id in every case).
  sidecar ??= new SidecarClient(serverPath);
  try {
    sidecar.start();
  } catch {
    // Sidecar may already be running.
  }
  void sidecar
    .request('connect', {
      workspaceFolders: mapWorkspaceFolders(vscode.workspace.workspaceFolders),
    })
    .catch(() => {
      // Core may still be starting; folders re-sync on the next change event.
    });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      void sidecar
        ?.request('workspaceFoldersChanged', mapWorkspaceFoldersChange(event))
        .catch(() => {
          // Best-effort; the Core reconciles from the next event or reconnect.
        });
    }),
  );

  // T-203 — chat panel (Preact-free vanilla DOM webview).
  const openChat = vscode.commands.registerCommand('event4u.openChat', async () => {
    const panel = vscode.window.createWebviewPanel(
      'event4uAgentChat',
      'event4u Agent',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    sidecar ??= new SidecarClient(serverPath);
    try {
      sidecar.start();
    } catch {
      // Sidecar may already be running — surface health via the snapshot.
    }
    const healthy = await sidecar.healthy().catch(() => false);
    const initialSnapshot: ChatModelSnapshot = {
      messages: [],
      mode:
        vscode.workspace.getConfiguration('event4u').get<string>('defaultMode') === 'cli'
          ? 'cli'
          : 'api',
      streamingSummary: null,
      sidecarHealthy: healthy,
    };

    const scriptUri = panel.webview
      .asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview.js')))
      .toString();
    const nonce = randomUUID().replace(/-/g, '');
    panel.webview.html = buildChatHtml({
      scriptUri,
      cspSource: panel.webview.cspSource,
      nonce,
      initialSnapshot,
    });

    panel.webview.onDidReceiveMessage((message: unknown) => {
      void message; // Wiring to the controller lands with the project service.
    });
  });
  context.subscriptions.push(openChat);

  // T-306 — Ask event4u about Selection. Sends the selected text + path +
  // line range as a new chat turn. The chat surface is the destination once
  // the project controller lands; for now we just open the chat panel.
  const askSelection = vscode.commands.registerCommand('event4u.askAboutSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('event4u Agent: select some text first.');
      return;
    }
    await vscode.commands.executeCommand('event4u.openChat');
    // Carrying the selection through to the chat once the project service is
    // wired is captured in road-to-mvp-ui-finish.md (T-306 host integration).
  });
  context.subscriptions.push(askSelection);

  context.subscriptions.push({ dispose: () => sidecar?.dispose() });
}

export function deactivate(): void {
  sidecar?.dispose();
  sidecar = undefined;
}
