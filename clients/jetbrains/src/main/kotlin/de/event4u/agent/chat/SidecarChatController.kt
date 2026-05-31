package de.event4u.agent.chat

import com.intellij.openapi.project.Project
import de.event4u.agent.SidecarClient
import de.event4u.agent.SidecarLocator
import de.event4u.agent.protocol.ChatSendResponse
import de.event4u.agent.protocol.Envelope
import de.event4u.agent.ui.ModelPill
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import java.util.UUID

/**
 * Real chat controller (road-to-vertical-slice Phase 3). Bridges the chat panel
 * to the sidecar's streaming `chatSend` / `chatCancel`, replacing the stub
 * `PlaceholderChatController`.
 *
 * One stable `conversationId` per controller (council: matches the persistence
 * store + lets `chatCancel` target the live turn). The streaming read runs on a
 * daemon thread (never the EDT — [ChatPanel.renderModel] self-marshals to the
 * EDT), and Stop sends `chatCancel` on its own thread so the blocked reader
 * never deadlocks the UI. Mode maps to a provider: API → the sidecar default,
 * CLI → the keyless `claude-cli` backend (chats with zero key config).
 */
@Suppress("TooManyFunctions") // Implements the full ChatController interface (7 methods) + connect/dispose lifecycle.
class SidecarChatController(
    private val project: Project,
    initialMode: ConversationMode = ConversationMode.API,
) : ChatController {
    private val json = Json { ignoreUnknownKeys = true }
    private val conversationId = UUID.randomUUID().toString()
    private val messages = mutableListOf<ChatMessage>()
    private var mode = initialMode

    @Volatile private var healthy = false

    @Volatile private var streaming = false
    private var assistantIndex = -1
    private var client: SidecarClient? = null

    override var onModelChange: (ChatModelSnapshot) -> Unit = {}

    override fun snapshot(): ChatModelSnapshot =
        ChatModelSnapshot(
            messages = messages.toList(),
            mode = mode,
            streamingSummary = if (streaming) StreamingSummary(0, 0, 0.0) else null,
            sidecarHealthy = healthy,
        )

    /** Start the sidecar and report health; safe to call on tool-window open. */
    fun connectAsync() {
        Thread {
            healthy = runCatching { ensureClient().healthy() }.getOrDefault(false)
            onModelChange(snapshot())
        }.apply {
            isDaemon = true
            start()
        }
    }

    override fun send(text: String) {
        if (streaming) return
        messages.add(UserMessage(id = UUID.randomUUID().toString(), text = text))
        messages.add(AssistantMessage(id = UUID.randomUUID().toString(), text = "", streaming = true))
        assistantIndex = messages.lastIndex
        streaming = true
        onModelChange(snapshot())

        Thread {
            val data =
                buildJsonObject {
                    put("conversationId", JsonPrimitive(conversationId))
                    put("message", JsonPrimitive(text))
                    if (mode == ConversationMode.CLI) put("providerId", JsonPrimitive("claude-cli"))
                }
            val terminal =
                runCatching {
                    ensureClient().requestStream("chatSend", data) { frame ->
                        val token =
                            (frame.data as? JsonObject)?.get("token")?.let { (it as? JsonPrimitive)?.content }.orEmpty()
                        if (token.isNotEmpty()) {
                            (messages.getOrNull(assistantIndex) as? AssistantMessage)?.let {
                                messages[assistantIndex] = it.copy(text = it.text + token)
                                onModelChange(snapshot())
                            }
                        }
                    }
                }.getOrNull()
            (messages.getOrNull(assistantIndex) as? AssistantMessage)?.let {
                messages[assistantIndex] = finalize(it, terminal)
            }
            streaming = false
            onModelChange(snapshot())
        }.apply {
            isDaemon = true
            start()
        }
    }

    /** Fold the terminal envelope (or a timeout/error) into the final assistant message. */
    private fun finalize(
        current: AssistantMessage,
        terminal: Envelope?,
    ): AssistantMessage =
        when {
            terminal == null ->
                current.copy(
                    text = current.text.ifEmpty { "⚠️ no response from the sidecar (timed out)" },
                    streaming = false,
                )

            terminal.messageType == "error" -> {
                val obj = terminal.data as? JsonObject
                val code = (obj?.get("code") as? JsonPrimitive)?.content ?: "error"
                val message = (obj?.get("message") as? JsonPrimitive)?.content ?: "request failed"
                current.copy(text = "⚠️ $code: $message", streaming = false)
            }

            else -> {
                val resp = runCatching { json.decodeFromJsonElement<ChatSendResponse>(terminal.data) }.getOrNull()
                current.copy(
                    text = resp?.text?.ifEmpty { current.text } ?: current.text,
                    streaming = false,
                    costFooter =
                        resp?.let {
                            CostFooter(
                                durationMs = 0,
                                inputTokens = it.usage.inputTokens.toLong(),
                                cacheReadTokens = (it.usage.cacheReadTokens ?: 0).toLong(),
                                outputTokens = it.usage.outputTokens.toLong(),
                                usd = it.cost.totalUsd,
                                stepCount = 1,
                                toolCallCount = 0,
                                timeToFirstTokenMs = 0,
                            )
                        },
                )
            }
        }

    override fun requestStop() {
        if (!streaming) return
        Thread {
            val data = buildJsonObject { put("conversationId", JsonPrimitive(conversationId)) }
            runCatching { ensureClient().request("chatCancel", data) }
            // The terminal (cancelled) envelope arrives via the stream and finishes the turn.
        }.apply {
            isDaemon = true
            start()
        }
    }

    override fun isStreaming(): Boolean = streaming

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

    fun dispose() {
        client?.dispose()
        client = null
    }

    @Synchronized
    private fun ensureClient(): SidecarClient {
        client?.let { return it }
        val created = SidecarClient(SidecarLocator.locate(project.basePath))
        created.start()
        client = created
        return created
    }
}
