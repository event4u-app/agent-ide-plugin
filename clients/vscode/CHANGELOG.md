# Changelog

All notable changes to the event4u Agent VS Code extension.

## 0.1.0

- First packageable artifact: `vsce package` produces a `.vsix` with the Agent
  Core sidecar bundled (`sidecar/server.js`), runnable with no repo checkout.
- Spawn the bundled sidecar with `ELECTRON_RUN_AS_NODE` so VS Code's own Node
  runtime hosts it — no system Node prerequisite.
- Chat → send → stream → stop → cost against Anthropic (API) or the Claude CLI
  (keyless), provider selectable per turn.
