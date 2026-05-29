package de.event4u.agent.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CostFooterFormatterTest {
    @Test
    fun `footer carries every expected segment`() {
        val out =
            CostFooterFormatter.footer(
                CostFooter(
                    durationMs = 4200L,
                    inputTokens = 18_422L,
                    cacheReadTokens = 14_200L,
                    outputTokens = 487L,
                    usd = 0.0156,
                    stepCount = 3,
                    toolCallCount = 3,
                    timeToFirstTokenMs = 412L,
                ),
            )
        assertTrue(out.contains("4.2s"))
        assertTrue(out.contains("18,422"))
        assertTrue(out.contains("cache: 14,200"))
        assertTrue(out.contains("Out: 487"))
        assertTrue(out.contains("$0.0156"))
        assertTrue(out.contains("3 steps"))
        assertTrue(out.contains("3 tool calls"))
        assertTrue(out.contains("TTFT 412ms"))
    }

    @Test
    fun `footer omits cache bucket when zero`() {
        val out =
            CostFooterFormatter.footer(
                CostFooter(
                    durationMs = 1000L,
                    inputTokens = 100L,
                    cacheReadTokens = 0L,
                    outputTokens = 10L,
                    usd = 0.0001,
                    stepCount = 1,
                    toolCallCount = 0,
                    timeToFirstTokenMs = 100L,
                ),
            )
        assertTrue(!out.contains("cache:"))
    }

    @Test
    fun `streaming line mentions both token counts and running cost`() {
        val out =
            CostFooterFormatter.streaming(
                StreamingSummary(inputTokens = 14_238L, outputTokens = 412L, usdSoFar = 0.0089),
            )
        assertTrue(out.contains("Streaming"))
        assertTrue(out.contains("14,238"))
        assertTrue(out.contains("412"))
        assertTrue(out.contains("$0.0089"))
    }

    @Test
    fun `headerCost prints model and today usd`() {
        assertEquals(
            "claude-sonnet-4-6 · $0.0156 today",
            CostFooterFormatter.headerCost("claude-sonnet-4-6", 0.0156),
        )
    }
}
