package de.event4u.agent.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Serializes [ChatModelSnapshot] into the exact JSON shape the shared webview
 * bundle consumes (`ChatModelSnapshot` in
 * clients/vscode/src/webview/chat-model.ts). Key names, enum literals, and
 * null-vs-absent choices are part of the cross-IDE contract — change them in
 * lockstep with the TS side only.
 */
object SnapshotJson {
    /** The full host→webview push: `{"kind":"snapshot","snapshot":{...}}`. */
    fun snapshotPayload(snapshot: ChatModelSnapshot): String =
        Json.encodeToString(
            JsonObject.serializer(),
            buildJsonObject {
                put("kind", "snapshot")
                put("snapshot", toJson(snapshot))
            },
        )

    fun toJson(snapshot: ChatModelSnapshot): JsonObject =
        buildJsonObject {
            put(
                "messages",
                buildJsonArray { snapshot.messages.forEach { add(messageJson(it)) } },
            )
            put("mode", if (snapshot.mode == ConversationMode.CLI) "cli" else "api")
            // NOTE: JsonObjectBuilder.put returns the PREVIOUS value for the
            // key (Map semantics) — never chain it with `?.let { } ?: ...`.
            val summary = snapshot.streamingSummary
            if (summary == null) {
                put("streamingSummary", JsonNull)
            } else {
                put(
                    "streamingSummary",
                    buildJsonObject {
                        put("inputTokens", summary.inputTokens)
                        put("outputTokens", summary.outputTokens)
                        put("usdSoFar", summary.usdSoFar)
                    },
                )
            }
            put("sidecarHealthy", snapshot.sidecarHealthy)
            put("providerAvailable", snapshot.providerAvailable)
        }

    private fun messageJson(message: ChatMessage): JsonObject =
        when (message) {
            is UserMessage ->
                buildJsonObject {
                    put("kind", "user")
                    put("id", message.id)
                    put("text", message.text)
                }

            is AssistantMessage ->
                buildJsonObject {
                    put("kind", "assistant")
                    put("id", message.id)
                    put("text", message.text)
                    put("streaming", message.streaming)
                    put(
                        "toolCalls",
                        buildJsonArray { message.toolCalls.forEach { add(toolCallJson(it)) } },
                    )
                    put("costFooter", message.costFooter?.let { costFooterJson(it) } ?: JsonNull)
                }

            is HaltMessage ->
                buildJsonObject {
                    put("kind", "halt")
                    put("id", message.id)
                    put("question", message.question)
                    put(
                        "options",
                        buildJsonArray {
                            message.options.forEach { option ->
                                add(
                                    buildJsonObject {
                                        put("id", option.optionId)
                                        put("label", option.label)
                                        option.description?.let { put("description", it) }
                                    },
                                )
                            }
                        },
                    )
                    put("allowFreeText", message.allowFreeText)
                }
        }

    private fun toolCallJson(toolCall: ToolCallSummary): JsonObject =
        buildJsonObject {
            put("name", toolCall.name)
            put("argsPreview", toolCall.argsPreview)
            put(
                "outcome",
                when (toolCall.outcome) {
                    ToolOutcome.OK -> "ok"
                    ToolOutcome.ERROR -> "error"
                    ToolOutcome.PENDING -> "pending"
                },
            )
            put("output", toolCall.output)
        }

    private fun costFooterJson(footer: CostFooter): JsonObject =
        buildJsonObject {
            put("durationMs", footer.durationMs)
            put("inputTokens", footer.inputTokens)
            put("cacheReadTokens", footer.cacheReadTokens)
            put("outputTokens", footer.outputTokens)
            put("usd", footer.usd)
            put("stepCount", footer.stepCount)
            put("toolCallCount", footer.toolCallCount)
            put("timeToFirstTokenMs", footer.timeToFirstTokenMs)
        }

    /** Encode [payload] as a JS string literal (valid JSON string == valid JS string). */
    fun asJsStringLiteral(payload: String): String {
        return Json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(payload))
    }
}
