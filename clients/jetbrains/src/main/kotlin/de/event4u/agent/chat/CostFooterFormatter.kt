package de.event4u.agent.chat

import java.util.Locale

/**
 * Format the step-level cost footer (T-410) and the in-flight streaming
 * summary (T-409). Pure-function helpers so unit tests can validate the
 * output without spinning up Swing.
 */
object CostFooterFormatter {
    fun footer(cost: CostFooter): String {
        val cache = if (cost.cacheReadTokens > 0) " (cache: ${formatTokens(cost.cacheReadTokens)})" else ""
        val durationSeconds = cost.durationMs / MILLIS_PER_SECOND
        val durationFraction = cost.durationMs % MILLIS_PER_SECOND / DECISECOND_PER_MILLIS
        return buildString {
            append("⏱ ").append(durationSeconds).append('.').append(durationFraction).append("s")
            append(" · In: ").append(formatTokens(cost.inputTokens)).append(cache)
            append(" · Out: ").append(formatTokens(cost.outputTokens))
            append(" · $").append(formatUsd(cost.usd))
            append(" · ").append(cost.stepCount).append(" steps")
            append(" · ").append(cost.toolCallCount).append(" tool calls")
            append(" · TTFT ").append(cost.timeToFirstTokenMs).append("ms")
        }
    }

    fun streaming(summary: StreamingSummary): String =
        buildString {
            append("🟢 Streaming · In: ").append(formatTokens(summary.inputTokens))
            append(" / Out: ").append(formatTokens(summary.outputTokens))
            append(" · $").append(formatUsd(summary.usdSoFar)).append(" so far")
        }

    fun headerCost(
        model: String,
        todayUsd: Double,
    ): String = "$model · $${formatUsd(todayUsd)} today"

    // Locale.US is pinned so token grouping (",") and the decimal point (".")
    // stay stable regardless of the developer's / IDE's default locale.
    fun formatTokens(n: Long): String = if (n >= THOUSAND) "%,d".format(Locale.US, n) else n.toString()

    fun formatUsd(usd: Double): String =
        // 4 dp for sub-cent visibility on small turns; trailing zeros trimmed,
        // never below a single leading digit (0.0 → "0").
        "%.4f".format(Locale.US, usd).trimEnd('0').trimEnd('.')

    private const val MILLIS_PER_SECOND = 1000
    private const val DECISECOND_PER_MILLIS = 100
    private const val THOUSAND = 1000L
}
