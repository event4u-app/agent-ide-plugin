package de.event4u.agent.chat

/**
 * In-memory message model for the chat UI (T-202).
 *
 * Mirrors the sidecar's `ChatMessage` / `ContentPart` schema (from
 * `packages/protocol/src/llm.ts`) but stays presentation-friendly — text is
 * pre-merged, tool calls are flattened, and a `streaming` flag marks
 * in-flight assistant turns so the renderer can show a status dot.
 */
sealed interface ChatMessage {
    val id: String
}

data class UserMessage(
    override val id: String,
    val text: String,
) : ChatMessage

data class AssistantMessage(
    override val id: String,
    val text: String,
    val streaming: Boolean,
    val toolCalls: List<ToolCallSummary> = emptyList(),
    val costFooter: CostFooter? = null,
) : ChatMessage

data class ToolCallSummary(
    val name: String,
    val argsPreview: String,
    val outcome: ToolOutcome,
    val output: String,
)

enum class ToolOutcome { OK, ERROR, PENDING }

/**
 * Step-level cost block rendered under each assistant message (T-410). The
 * sidecar's `step_events.jsonl` feeds this from the tracking layer.
 */
data class CostFooter(
    val durationMs: Long,
    val inputTokens: Long,
    val cacheReadTokens: Long,
    val outputTokens: Long,
    val usd: Double,
    val stepCount: Int,
    val toolCallCount: Int,
    val timeToFirstTokenMs: Long,
)

/**
 * Halt envelope rendered as a card with option buttons + free-text field
 * (T-305). The chat surface keeps these in the message list so the user
 * sees what the agent paused on.
 */
data class HaltMessage(
    override val id: String,
    val question: String,
    val options: List<HaltOption>,
    val allowFreeText: Boolean,
) : ChatMessage

data class HaltOption(
    val optionId: String,
    val label: String,
    val description: String?,
)

/**
 * Header summary for the in-flight turn (T-409). The chat surface renders
 * one fixed line below the input bar while a turn is streaming.
 */
data class StreamingSummary(
    val inputTokens: Long,
    val outputTokens: Long,
    val usdSoFar: Double,
)

/** Conversation-mode toggle state (T-407). */
enum class ConversationMode { API, CLI }
