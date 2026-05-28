---
spike: 0.3d — JetBrains PTY Bridge
phase: 0 (Validation)
status: research-based-pre-verdict
date: 2026-05-28
runtime_validated: false
provisional_verdict: partial pass — pty4j + own JBTerminalWidget viable; survival across IDE restart NOT free → v1.0 reverts to read-only mirror; v1.5 stays read-only by default, persistent PTY is a stretch goal
---

# Spike 0.3d — JetBrains PTY Bridge

## Pass / fail criteria (from roadmap)

- **Happy-path:** `JBTerminalWidget` + `TtyConnector` rendering external PTY from node-pty sidecar, keyboard input from IDE terminal landing in PTY.
- **Failure-mode:** launch PTY-attached IDE terminal, close JetBrains window, re-open — does the PTY survive? Send 10k bytes/sec output, does the connector keep up?
- **Pass →** v1.5 full read/write IDE terminal sync on the table.
- **Fail →** v1.0 ships read-only mirror; v1.5 stays at read-only or invents a different bridge.

## Provisional verdict

**Partial pass.** Two of three sub-questions answer cleanly; one fails per documented IDE limitations.

| Sub-question | Verdict | Why |
|---|---|---|
| Can a plugin embed a custom PTY into its own `JBTerminalWidget`? | ✅ Yes | `AbstractTerminalRunner` + custom `TtyConnector` is documented and used by existing plugins (MicroPython Tools). |
| Can the connector keep up at 10k bytes/sec? | ✅ Probably | pty4j/JediTerm ship in every IntelliJ build; if 10k B/s broke them, the user would not have a usable IDE terminal. |
| Does the PTY survive IDE window close/reopen? | ❌ Not for free | Open JetBrains YouTrack tickets (IDEA-187783, IJPL-113292) confirm even native terminals don't survive. Plugin-side survival requires VS Code-class persistent-pty infrastructure (1-2 weeks of work). |

**Decision:**
- **v1.0:** ship read-only mirror via `script -f` + file tail (1-2 days, per Spike fallback). Documented in [§4](#read-only-mirror-fallback-v10).
- **v1.5:** read-write PTY via pty4j + own `JBTerminalWidget` (feasible on Classic terminal, ~1 week). Persistent survival is a stretch goal not promised by v1.5 acceptance criteria.

## Architecture — what we'd build (v1.5)

```
┌────────────────────────────────────────────────────┐
│ JetBrains IDE (Kotlin / JBR)                        │
│                                                     │
│  Our tool window:                                   │
│  ┌───────────────────────────────────────────┐     │
│  │ JBTerminalWidget (we own this instance)   │     │
│  │   │                                       │     │
│  │   │  bytes ← read() / write() →           │     │
│  │   ▼                                       │     │
│  │ Custom TtyConnector                       │     │
│  └─────────────────────┬─────────────────────┘     │
│                         │                           │
└─────────────────────────┼───────────────────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │ pty4j PtyProcess        │   ← in-JVM PTY
              │ (or node-pty sidecar)   │
              └─────────────────────────┘
                          │
                          ▼
                  /bin/zsh, claude --resume, …
```

**Why pty4j over node-pty + Node sidecar.** pty4j is bundled with every JetBrains IDE (same authors as JediTerm + JBTerminalWidget), is the Java equivalent of node-pty, and removes one process boundary. The Node sidecar in our overall architecture handles **LLM transport** — not the user's shell PTY. Using node-pty for the PTY would mean routing the user's keystrokes through Java → JSON-RPC → Node → node-pty, which is needless overhead and a Windows-ConPTY support tax we don't want to own.

**The catch — Reworked Terminal 2025.2 default.** Per the [JetBrains 2025.2 platform announcement](https://platform.jetbrains.com/t/terminal-implementation-changes-from-v2025-2-of-intellij-based-ides/2264):
- `JBTerminalWidget` and `ShellTerminalWidget` are **compatible only with the classic terminal**.
- New `com.intellij.terminal.ui.TerminalWidget` interface is the forward path.
- **Escape hatch (verbatim):** *"Plugins creating their own terminal components using existing creation APIs will continue functioning, as these return the classic terminal regardless of which Terminal engine option is selected."*

So our own tool-window widget stays on Classic, even when the user's built-in Terminal tool window is Reworked. UX wart: our terminal looks visually different from the user's default. Livable, not great. Track-2 work for v1.5+ — migrate to `TerminalWidget` when the new engine's plugin API matures.

## Reproduction script — runtime spike (≤2 days)

```kotlin
// agents/analysis/spike-code/0-3d/PtyBridgeSpike.kt
// Drop into a sandbox IntelliJ plugin project.
// Register a tool window that calls PtyBridgeSpike.attach(toolWindow).

package event4u.spike.ptybridge

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.terminal.JBTerminalWidget
import com.intellij.terminal.JBTerminalSystemSettingsProviderBase
import com.intellij.ui.content.ContentFactory
import com.jediterm.pty.PtyProcessTtyConnector
import com.pty4j.PtyProcess
import com.pty4j.PtyProcessBuilder
import java.nio.charset.StandardCharsets

object PtyBridgeSpike {
    fun attach(project: Project, toolWindow: ToolWindow) {
        val settings = JBTerminalSystemSettingsProviderBase()
        val widget = JBTerminalWidget(project, settings, /*parent=*/ toolWindow.disposable)

        // Spawn an actual shell (real PTY, full ANSI capability)
        val process: PtyProcess = PtyProcessBuilder()
            .setCommand(arrayOf("/bin/zsh", "-l"))
            .setEnvironment(System.getenv())
            .setRedirectErrorStream(true)
            .start()

        val connector = PtyProcessTtyConnector(process, StandardCharsets.UTF_8)
        widget.createTerminalSession(connector)
        widget.start()

        val content = ContentFactory.getInstance().createContent(widget, "Spike PTY", false)
        toolWindow.contentManager.addContent(content)
    }
}
```

### Execution protocol

1. **Setup.** Open sandbox IntelliJ Community 2024.2 (or 2025.1) with the spike plugin. Open the registered tool window.
2. **Happy-path.**
   - Type a command (`ls -la`), observe output. ANSI colors visible. Cursor movement works (try `top` or `htop`).
   - Type a multi-line interactive (e.g., `vim README.md`), confirm it renders.
3. **Failure-mode A — close/reopen IDE.** Run a long process (`sleep 600`), close the IDE window, reopen.
   - **Expected per research:** PTY dies on close, no survival without persistence layer. Spike marks this `documented limitation, not a defect`.
4. **Failure-mode B — 10 KB/s output.** Run `yes hello | pv -L 10240 | cat` in the spike PTY. Observe:
   - Does the widget freeze? Drop characters?
   - Memory growth across 60 seconds (JVM heap via `jcmd <pid> GC.heap_info`).
   - **Pass:** widget stays responsive, no character loss visible, heap delta <30 MB.
   - **Fail:** UI freeze, scroll lag >500ms, or heap growth >100 MB.

### Optional — node-pty sidecar variant

If the user wants to validate node-pty + Node sidecar (despite the recommendation above), the connector becomes:

```kotlin
// Spawn `node sidecar.js` instead of pty4j directly.
val nodeProc = ProcessBuilder("node", "sidecar.js")
    .redirectErrorStream(true)
    .start()
// Implement a TtyConnector that reads/writes nodeProc's stdin/stdout.
// The sidecar uses node-pty to host the actual shell.
```

This duplicates VS Code's pty-host pattern. Worth it only if we want one Node sidecar to also handle LLM transport AND PTY in the same process. Not recommended for MVP/v1.5.

## Survival-across-restart — what it would take

If product requires "close laptop, reopen, terminal still there with your `claude code` session intact":

1. **External lifecycle.** PTY runs in a daemon (`launchd`/`systemd`/Windows Service) outside the IDE JVM. IDE reconnects via Unix socket / named pipe on launch.
2. **Buffer replay.** Daemon retains an N-line scrollback buffer (VS Code does ~1000 lines). On reconnect, send the buffer before resuming live stream.
3. **Session ID.** Plugin stores the daemon's session ID per project; reconnect uses the ID.

**Estimated cost:** 1-2 weeks of solo-dev work (daemon shape, IPC, buffer ring, reconnect protocol, Windows service handling). Out of scope for v1.5 unless promoted explicitly.

**Cheaper alternative for "session feels persistent":** rely on the `claude --resume <session_id>` mechanism (Spike 0.3c). The PTY itself dies on IDE close, but the underlying Claude session is resumable on next launch. UX: "Terminal closed — your Claude session is saved, reopen to continue."

## Read-only mirror fallback (v1.0)

Per the roadmap's Fail-path. Approach: **`script(1)` typescript + file tail**.

```bash
# User-side (or auto-launched by the plugin)
script -F /tmp/event4u-agent-mirror.log /bin/zsh
# script -F = flush after every write (BSD/macOS) / use -f on Linux

# Plugin-side: a tool window panel tails /tmp/event4u-agent-mirror.log
# Parse ANSI escape sequences, render to a JTextPane or a JBTerminalWidget
# in display-only mode (no TtyConnector, no input wiring).
```

**Pros:**
- Trivial to implement (1-2 days).
- Survives IDE close/reopen (file persists).
- Full ANSI fidelity (script captures escape sequences).
- Cross-platform with the `-F`/`-f` flag swap.

**Cons:**
- User must launch with `script -F …` (or we auto-wrap their shell). Friction.
- Read-only — no typing back. Acceptable per the spike's fallback definition.
- Windows: `script(1)` isn't standard; use `Start-Transcript` in PowerShell or build a thin file-watcher around `node-pty`'s output.

This is the **v1.0 shipped behavior**.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Reworked Terminal default (2025.2+) makes our Classic widget feel "second-class" | high | Surface "Reworked Terminal coming" in plugin notes; track new `TerminalWidget` API maturity |
| 10 KB/s burst causes UI lag | low | pty4j powers the user's daily terminal; if it broke at 10 KB/s, no one would use IntelliJ |
| pty4j ABI drift across IDE versions | low | pty4j is bundled per IDE version; we use whatever the platform ships |
| Read-only mirror via `script` fails on Windows | medium | Windows fallback uses PowerShell `Start-Transcript` or our own node-pty-backed mirror |
| ANSI parser drift between our renderer and the user's terminal | medium | Use JediTerm's parser (open-source, same code path as JBTerminalWidget) — don't roll our own |

## Verdict

**Provisional pass with one downgrade.**
- v1.5 read-write PTY: ✅ feasible via pty4j + own JBTerminalWidget. ~1 week to ship.
- v1.5 survival across restart: ❌ downgraded — NOT promised; either accept Claude `--resume` as the survival surface OR budget 1-2 extra weeks for persistent-pty daemon.
- v1.0 read-only mirror: ✅ ships via `script -F` + file tail. ~1-2 days.

Acceptance criterion for the roadmap: **read this as Pass for v1.0 read-only mirror, partial pass for v1.5 read-write, NOT promised for v1.5 survival.**

## Sources

- [Embedded Terminal — Plugin SDK](https://plugins.jetbrains.com/docs/intellij/embedded-terminal.html)
- [Terminal Implementation Changes from v2025.2](https://platform.jetbrains.com/t/terminal-implementation-changes-from-v2025-2-of-intellij-based-ides/2264)
- [JetBrains Terminal: A New Architecture (Apr 2025)](https://blog.jetbrains.com/idea/2025/04/jetbrains-terminal-a-new-architecture/)
- [AbstractTerminalRunner.java — intellij-community](https://github.com/JetBrains/intellij-community/blob/master/plugins/terminal/src/org/jetbrains/plugins/terminal/AbstractTerminalRunner.java)
- [BasicTerminalShellExample.java — JetBrains/jediterm](https://github.com/JetBrains/jediterm/blob/master/JediTerm/src/main/java/com/jediterm/example/BasicTerminalShellExample.java)
- [IDEA-187783 / IJPL-113292 — restore terminal sessions after restart](https://youtrack.jetbrains.com/issue/IDEA-187783/restore-terminal-sessions-after-a-IntelliJ-restart)
- [microsoft/node-pty README](https://github.com/microsoft/node-pty)
- [VS Code Terminal Backend architecture](https://deepwiki.com/microsoft/vscode/6-integrated-terminal)
