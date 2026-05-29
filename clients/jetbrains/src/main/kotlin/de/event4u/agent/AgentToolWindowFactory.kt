package de.event4u.agent

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import de.event4u.agent.chat.ChatController
import de.event4u.agent.chat.ChatModelSnapshot
import de.event4u.agent.chat.ChatPanel
import de.event4u.agent.chat.ConversationMode

/**
 * Tool window factory — installs the Swing chat panel (T-202) backed by a
 * [PlaceholderChatController] until the real sidecar-backed controller lands
 * with the project service that owns [SidecarClient].
 *
 * The Compose/Jewel migration is deferred to v1.0 once jewel 1.0 ships and
 * `StatusBarWidget` integration matures — see the council verdict at
 * `agents/runtime/council/responses/jetbrains-ui-2026-05-29.json`.
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
 * Minimal controller that surfaces sidecar-health but routes user input to
 * stderr until the project service lands. Real implementation lives in the
 * follow-up wiring task (see road-to-mvp-ui-finish.md, T-411a / T-412 host
 * integration).
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
