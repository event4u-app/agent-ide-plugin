package de.event4u.agent

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import de.event4u.agent.chat.AssistantMessage
import de.event4u.agent.chat.ChatController
import de.event4u.agent.chat.ChatMessage
import de.event4u.agent.chat.ChatModelSnapshot
import de.event4u.agent.chat.ChatPanel
import de.event4u.agent.chat.ConversationMode
import de.event4u.agent.chat.UserMessage
import de.event4u.agent.ui.ModelPill
import java.util.UUID

/**
 * Tool window factory — installs the redesigned chat panel (C-1 through
 * C-10 of road-to-mvp-ui-design.md). The placeholder controller below is
 * intentionally observable — every send() lands a UserMessage + a
 * synthetic AssistantMessage so the user sees what they typed, plus a
 * clear "the agent isn't wired up yet" reply.
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
 * Visible, observable placeholder. Holds an in-memory message list and
 * publishes [ChatModelSnapshot] updates so the chat panel renders every
 * user turn + a synthetic stub reply.
 *
 * Replace this with the real sidecar-backed controller in
 * road-to-mvp-ui-finish.md (the host-integration sprint).
 */
internal class PlaceholderChatController(private val project: Project) : ChatController {
    private var mode = ConversationMode.API
    private var healthy = false
    private val messages = mutableListOf<ChatMessage>()
    override var onModelChange: (ChatModelSnapshot) -> Unit = {}

    override fun snapshot(): ChatModelSnapshot =
        ChatModelSnapshot(
            messages = messages.toList(),
            mode = mode,
            streamingSummary = null,
            sidecarHealthy = healthy,
        )

    override fun send(text: String) {
        messages.add(UserMessage(id = UUID.randomUUID().toString(), text = text))
        messages.add(
            AssistantMessage(
                id = UUID.randomUUID().toString(),
                text = STUB_REPLY,
                streaming = false,
                toolCalls = emptyList(),
                costFooter = null,
            ),
        )
        onModelChange(snapshot())
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
        const val STUB_REPLY =
            "**Agent service is not wired up yet.**\n\n" +
                "The UI surface (composer, chip rail, mode/model pills, drag-n-drop) is functional, but " +
                "the sidecar bridge that runs the LLM call lands in the next sprint — see " +
                "`agents/roadmaps/road-to-mvp-ui-finish.md § T-411a / T-412 host integration`.\n\n" +
                "Try: switch the mode pill, drag a file onto the composer, pick a different model. " +
                "These work locally without the backend; the chat reply itself just renders this stub."
    }
}
