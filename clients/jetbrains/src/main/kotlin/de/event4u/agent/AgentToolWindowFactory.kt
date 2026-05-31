package de.event4u.agent

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import de.event4u.agent.chat.ChatPanel
import de.event4u.agent.chat.ConversationMode
import de.event4u.agent.chat.SidecarChatController
import de.event4u.agent.settings.AgentSettings

/**
 * Tool window factory — installs the redesigned chat panel (C-1 through C-10 of
 * road-to-mvp-ui-design.md) backed by the real [SidecarChatController]: every
 * turn streams through the sidecar's `chatSend`, with a Stop button wired to
 * `chatCancel` (road-to-vertical-slice Phase 3). The controller is disposed
 * with the tool-window content so no orphan sidecar process survives a close.
 */
class AgentToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(
        project: Project,
        toolWindow: ToolWindow,
    ) {
        val controller = SidecarChatController(project, initialMode())
        val panel = ChatPanel(controller)
        val content = toolWindow.contentManager.factory.createContent(panel, "", false)
        content.setDisposer(Disposable { controller.dispose() })
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
