// Spike 0-3d — PTY Bridge reproduction.
// Drop into a sandbox IntelliJ plugin project.
// Register a tool window that calls PtyBridgeSpike.attach(project, toolWindow).

package event4u.spike.ptybridge

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.terminal.JBTerminalSystemSettingsProviderBase
import com.intellij.terminal.JBTerminalWidget
import com.intellij.ui.content.ContentFactory
import com.jediterm.pty.PtyProcessTtyConnector
import com.pty4j.PtyProcess
import com.pty4j.PtyProcessBuilder
import java.nio.charset.StandardCharsets

object PtyBridgeSpike {
    fun attach(project: Project, toolWindow: ToolWindow) {
        val settings = JBTerminalSystemSettingsProviderBase()
        val widget = JBTerminalWidget(project, settings, toolWindow.disposable)

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
