package de.event4u.agent

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import de.event4u.agent.chat.ChatController
import de.event4u.agent.chat.ChatModelSnapshot
import de.event4u.agent.chat.ChatPanel
import de.event4u.agent.chat.ConversationMode
import de.event4u.agent.ui.ModelPill

/**
 * Tool window factory — installs the redesigned chat panel (C-1 through
 * C-10 of road-to-mvp-ui-design.md). The Swing chat surface uses the new
 * primitives library; the placeholder controller surfaces sidecar-health
 * via the mode-pill status dot until the project service lands.
 */
class AgentToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(
        project: Project,
        toolWindow: ToolWindow,
    ) {
        val controller = PlaceholderChatController(project)
        val panel = ChatPanel(controller)
        val content = toolWindow.contentManager.factory.createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
        controller.pingSidecarAsync()
    }
}

/**
 * Minimal controller — `send` / `requestStop` log to stderr until the
 * project service binds a real chat orchestrator. The mode pill cycles
 * locally so the user gets immediate feedback even without backend wiring.
 */
internal class PlaceholderChatController(private val project: Project) : ChatController {
    private var mode = ConversationMode.API
    private var healthy = false
    override var onModelChange: (ChatModelSnapshot) -> Unit = {}

    override fun snapshot(): ChatModelSnapshot =
        ChatModelSnapshot(
            messages = emptyList(),
            mode = mode,
            streamingSummary = null,
            sidecarHealthy = healthy,
        )

    override fun send(text: String) {
        System.err.println("event4u-agent: user-turn placeholder for ${text.take(MAX_LOG)}…")
    }

    override fun requestStop() {
        // No streaming yet — placeholder.
    }

    override fun isStreaming(): Boolean = false

    override fun currentMode(): ConversationMode = mode

    override fun setMode(mode: ConversationMode) {
        this.mode = mode
        onModelChange(snapshot())
    }

    override fun availableModels(): List<ModelPill.ModelOption> =
        listOf(
            ModelPill.ModelOption("claude-opus-4-6", "$15 / $75 per Mtok"),
            ModelPill.ModelOption("claude-sonnet-4-6", "$3 / $15 per Mtok"),
            ModelPill.ModelOption("claude-haiku-4-5", "$0.80 / $4 per Mtok"),
        )

    fun pingSidecarAsync() {
        Thread {
            val serverPath = resolveSidecarPath()
            healthy =
                runCatching {
                    val client = SidecarClient(serverPath)
                    client.start()
                    val ok = client.healthy()
                    client.dispose()
                    ok
                }.getOrDefault(false)
            onModelChange(snapshot())
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun resolveSidecarPath(): String {
        val base = project.basePath ?: "."
        return "$base/packages/core/dist/server.js"
    }

    private companion object {
        const val MAX_LOG = 80
    }
}
