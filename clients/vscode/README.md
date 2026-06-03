# event4u Agent — VS Code

AI coding assistant powered by your `agent-config` tree. Chat, stream, stop, and
see token cost — backed by a local Node sidecar (the "Agent Core").

## Requirements

- **VS Code** 1.90+.
- **No system Node required.** The extension bundles the Agent Core sidecar and
  runs it with VS Code's own Node runtime (`ELECTRON_RUN_AS_NODE`), so a packaged
  `.vsix` works on a clean machine with no repo checkout.

## Modes

- **CLI mode** (keyless) — uses the `claude` CLI if it is on your PATH. The
  fastest way to try the agent with no API key.
- **API mode** — set `event4u.anthropicApiKey` in settings, or export
  `ANTHROPIC_API_KEY` before launching VS Code.

Switch modes from the composer mode pill. `event4u.defaultMode` (`api` / `cli` /
`auto`) sets the default; `auto` picks CLI when `claude` is on PATH, else API.

## Build a `.vsix` locally

```bash
# from the repo root
task vscode:package
# or, from clients/vscode
pnpm run package
```

This builds the extension, bundles the sidecar into `sidecar/server.js`, and
produces `event4u-agent.vsix`.

## Shared chat webview

`src/webview/` is the chat UI for BOTH IDE clients (ADR-055): the VS Code
extension renders it as a webview, and `pnpm run build` additionally emits a
self-contained `chat.html` (via `scripts/build-jcef-html.mjs`) that the
JetBrains plugin loads into JCEF. The host integration is abstracted in
`src/webview/host-bridge.ts` — keep this folder free of `vscode` API imports.

## License

MIT — see [LICENSE](./LICENSE).
