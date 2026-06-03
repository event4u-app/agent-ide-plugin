package de.event4u.agent.chat

/**
 * Snapshot the chat surface receives every time the chat model changes.
 * Field-for-field mirror of the webview's `ChatModelSnapshot`
 * (clients/vscode/src/webview/chat-model.ts) — [SnapshotJson] serializes it
 * 1:1 for the JCEF bundle (road-to-jcef-chat-parity Phase 2).
 */
data class ChatModelSnapshot(
    val messages: List<ChatMessage>,
    val mode: ConversationMode,
    val streamingSummary: StreamingSummary?,
    val sidecarHealthy: Boolean,
    /**
     * Whether the active provider can actually serve a turn. The VS Code host
     * probes this (`claude --version` / key present); the JetBrains host does
     * not probe yet and stays optimistic — wiring the probe is host work
     * tracked in road-to-jcef-chat-parity Phase 4 parity notes.
     */
    val providerAvailable: Boolean = true,
)

/** Model choice offered by the composer's model pill. */
data class ModelOption(
    val id: String,
    val priceLabel: String,
)

/** Contract the chat surface speaks to. */
interface ChatController {
    var onModelChange: (ChatModelSnapshot) -> Unit

    fun snapshot(): ChatModelSnapshot

    fun send(text: String)

    fun requestStop()

    fun isStreaming(): Boolean

    fun currentMode(): ConversationMode

    fun setMode(mode: ConversationMode)

    fun availableModels(): List<ModelOption>
}
