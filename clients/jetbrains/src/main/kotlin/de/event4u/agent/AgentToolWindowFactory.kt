package de.event4u.agent

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import de.event4u.agent.chat.ConversationMode
import de.event4u.agent.chat.JcefChatPanel
import de.event4u.agent.chat.SidecarChatController
import de.event4u.agent.settings.AgentSettings

/**
 * Tool window factory — installs the shared JCEF chat surface
 * (road-to-jcef-chat-parity: the same webview bundle the VS Code extension
 * renders) backed by the real [SidecarChatController]: every turn streams
 * through the sidecar's `chatSend`, with a Stop button wired to `chatCancel`
 * (road-to-vertical-slice Phase 3). Controller + browser are disposed with
 * the tool-window content so no orphan sidecar process survives a close.
 */
class AgentToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(
        project: Project,
        toolWindow: ToolWindow,
    ) {
        val controller = SidecarChatController(project, initialMode())
        val panel = JcefChatPanel(controller)
        val content = toolWindow.contentManager.factory.createContent(panel, "", false)
        content.setDisposer(
            Disposable {
                Disposer.dispose(panel)
                controller.dispose()
            },
        )
        toolWindow.contentManager.addContent(content)
        controller.connectAsync()
    }

    private fun initialMode(): ConversationMode =
        if (AgentSettings.instance().state.defaultMode == "cli") {
            ConversationMode.CLI
        } else {
            ConversationMode.API
        }
}
