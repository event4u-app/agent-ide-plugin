package de.event4u.agent.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Locks the host→webview JSON contract: the shapes here must stay
 * field-for-field identical to `ChatModelSnapshot` in
 * clients/vscode/src/webview/chat-model.ts. A breaking rename on either side
 * shows up as a failing assertion, not a blank chat panel.
 */
class SnapshotJsonTest {
    @Test
    fun `payload wraps the snapshot in a kind envelope`() {
        val payload = SnapshotJson.snapshotPayload(emptySnapshot())
        assertTrue(payload.startsWith("""{"kind":"snapshot","snapshot":{"""), payload)
    }

    @Test
    fun `empty snapshot serializes mode + health + availability`() {
        val json = SnapshotJson.toJson(emptySnapshot()).toString()
        assertEquals(
            """{"messages":[],"mode":"api","streamingSummary":null,"sidecarHealthy":true,"providerAvailable":true}""",
            json,
        )
    }

    @Test
    fun `cli mode serializes as lowercase cli`() {
        val json = SnapshotJson.toJson(emptySnapshot().copy(mode = ConversationMode.CLI)).toString()
        assertTrue(""""mode":"cli"""" in json, json)
    }

    @Test
    fun `user message carries kind id text`() {
        val snapshot = emptySnapshot().copy(messages = listOf(UserMessage(id = "u1", text = "hello")))
        val json = SnapshotJson.toJson(snapshot).toString()
        assertTrue(""""messages":[{"kind":"user","id":"u1","text":"hello"}]""" in json, json)
    }

    @Test
    fun `assistant message serializes toolCalls and costFooter`() {
        val snapshot =
            emptySnapshot().copy(
                messages =
                    listOf(
                        AssistantMessage(
                            id = "a1",
                            text = "done",
                            streaming = false,
                            toolCalls =
                                listOf(
                                    ToolCallSummary(
                                        name = "read",
                                        argsPreview = "{path}",
                                        outcome = ToolOutcome.OK,
                                        output = "ok",
                                    ),
                                ),
                            costFooter =
                                CostFooter(
                                    durationMs = 1200,
                                    inputTokens = 10,
                                    cacheReadTokens = 5,
                                    outputTokens = 20,
                                    usd = 0.01,
                                    stepCount = 1,
                                    toolCallCount = 1,
                                    timeToFirstTokenMs = 300,
                                ),
                        ),
                    ),
            )
        val json = SnapshotJson.toJson(snapshot).toString()
        val expectedToolCalls = """"toolCalls":[{"name":"read","argsPreview":"{path}","outcome":"ok","output":"ok"}]"""
        assertTrue(""""kind":"assistant"""" in json, json)
        assertTrue(expectedToolCalls in json, json)
        assertTrue(""""costFooter":{"durationMs":1200,"inputTokens":10""" in json, json)
    }

    @Test
    fun `streaming assistant message serializes streaming true and null costFooter`() {
        val snapshot =
            emptySnapshot().copy(
                messages = listOf(AssistantMessage(id = "a2", text = "", streaming = true)),
            )
        val json = SnapshotJson.toJson(snapshot).toString()
        assertTrue(""""streaming":true""" in json, json)
        assertTrue(""""costFooter":null""" in json, json)
    }

    @Test
    fun `halt message maps optionId onto the webview's id key`() {
        val snapshot =
            emptySnapshot().copy(
                messages =
                    listOf(
                        HaltMessage(
                            id = "h1",
                            question = "Proceed?",
                            options =
                                listOf(
                                    HaltOption(optionId = "yes", label = "Yes", description = "go"),
                                    HaltOption(optionId = "no", label = "No", description = null),
                                ),
                            allowFreeText = true,
                        ),
                    ),
            )
        val json = SnapshotJson.toJson(snapshot).toString()
        val expectedOptions = """"options":[{"id":"yes","label":"Yes","description":"go"},{"id":"no","label":"No"}]"""
        assertTrue(expectedOptions in json, json)
        assertTrue(""""allowFreeText":true""" in json, json)
    }

    @Test
    fun `streaming summary serializes the three usage fields`() {
        val snapshot = emptySnapshot().copy(streamingSummary = StreamingSummary(1, 2, 0.5))
        val json = SnapshotJson.toJson(snapshot).toString()
        assertTrue(""""streamingSummary":{"inputTokens":1,"outputTokens":2,"usdSoFar":0.5}""" in json, json)
    }

    @Test
    fun `js string literal escaping is JSON string escaping`() {
        val literal = SnapshotJson.asJsStringLiteral("""he said "hi" \ there""")
        assertEquals(""""he said \"hi\" \\ there"""", literal)
    }

    private fun emptySnapshot(): ChatModelSnapshot =
        ChatModelSnapshot(
            messages = emptyList(),
            mode = ConversationMode.API,
            streamingSummary = null,
            sidecarHealthy = true,
        )
}
