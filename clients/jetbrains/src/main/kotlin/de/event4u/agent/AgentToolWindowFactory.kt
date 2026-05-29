package de.event4u.agent

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.SwingUtilities

/**
 * Placeholder tool window for the MVP skeleton (T-103). Shows a sidecar-health
 * line produced by pinging the Node Agent Core (T-105). The Compose/JCEF chat
 * UI replaces this panel in Sprint 2 (ADR-003 / T-202).
 */
class AgentToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = JBPanel<JBPanel<*>>(BorderLayout()).apply {
            border = JBUI.Borders.empty(PANEL_PADDING)
        }
        val status = JBLabel("Sidecar: starting…")
        panel.add(status, BorderLayout.NORTH)

        pingSidecarAsync(project) { line ->
            SwingUtilities.invokeLater { status.text = line }
        }

        val content = toolWindow.contentManager.factory.createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }

    private fun pingSidecarAsync(project: Project, onResult: (String) -> Unit) {
        Thread {
            val serverPath = resolveSidecarPath(project)
            val line = runCatching {
                val client = SidecarClient(serverPath)
                client.start()
                val healthy = client.healthy()
                client.dispose()
                if (healthy) "Sidecar healthy: pong" else "Sidecar unreachable"
            }.getOrElse { "Sidecar error: ${it.message}" }
            onResult(line)
        }.apply {
            isDaemon = true
            start()
        }
    }

    /**
     * Dev resolution: the sidecar bundle lives in the sibling `packages/core`
     * workspace. Packaging the sidecar into the plugin distribution with a
     * bundled Node is Sprint 4 (T-406) — the same tricky-problem note as the
     * VS Code client.
     */
    private fun resolveSidecarPath(project: Project): String {
        val base = project.basePath ?: "."
        return "$base/packages/core/dist/server.js"
    }

    private companion object {
        /** Tool-window content inset, in px. */
        const val PANEL_PADDING = 12
    }
}
