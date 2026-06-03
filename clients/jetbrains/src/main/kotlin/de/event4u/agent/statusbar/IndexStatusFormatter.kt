package de.event4u.agent.statusbar

import de.event4u.agent.protocol.RootIndexStatus

/**
 * T-1304 / T-PRD07 — pure presentation logic for the index-status widget.
 *
 * Aggregates the per-root [RootIndexStatus] list the Core reports into one
 * short statusbar line plus a per-root tooltip. Extracted as a pure function
 * (no IDE types) so the aggregation is unit-tested without a running IDE —
 * the same split as [de.event4u.agent.chat.CostFooterFormatter].
 *
 * Priority of the headline (council 2026-06-02, Q2=A — one short line):
 *   error (any) > indexing (any) > ready (all). Per-root detail lives in the
 *   tooltip, never the primary line.
 */
data class IndexStatusPresentation(val text: String, val tooltip: String)

object IndexStatusFormatter {
    fun present(statuses: List<RootIndexStatus>): IndexStatusPresentation {
        if (statuses.isEmpty()) {
            return IndexStatusPresentation("Index: idle", "No workspace roots indexed yet.")
        }

        val tooltip = statuses.joinToString("\n") { rootLine(it) }
        val indexedFiles = statuses.sumOf { it.fileCount }
        val errors = statuses.count { it.state == "error" }
        val indexing = statuses.filter { it.state == "indexing" }

        val text =
            when {
                errors > 0 -> "Index: error ($errors)"
                // Sum totals only when every indexing root knows its total; a single
                // unknown total makes the denominator meaningless, so drop it.
                indexing.isNotEmpty() ->
                    if (indexing.all { it.totalFiles != null }) {
                        "Indexing $indexedFiles/${indexing.sumOf { it.totalFiles ?: 0 }} files…"
                    } else {
                        "Indexing $indexedFiles files…"
                    }
                else -> "Index ready · $indexedFiles files"
            }
        return IndexStatusPresentation(text, tooltip)
    }

    private fun rootLine(s: RootIndexStatus): String {
        val total = s.totalFiles?.let { "/$it" } ?: ""
        val suffix = s.message?.let { " — $it" } ?: ""
        return "${s.stableId}: ${s.state} ${s.fileCount}$total files$suffix"
    }
}
