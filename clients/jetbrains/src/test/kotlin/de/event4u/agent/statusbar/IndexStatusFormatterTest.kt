package de.event4u.agent.statusbar

import de.event4u.agent.protocol.RootIndexStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class IndexStatusFormatterTest {
    private fun root(
        id: String,
        state: String,
        files: Int,
        total: Int? = null,
        message: String? = null,
    ) = RootIndexStatus(stableId = id, state = state, fileCount = files, totalFiles = total, message = message)

    @Test
    fun `empty list reports idle`() {
        val p = IndexStatusFormatter.present(emptyList())
        assertEquals("Index: idle", p.text)
    }

    @Test
    fun `all ready sums the indexed file counts`() {
        val p = IndexStatusFormatter.present(listOf(root("a", "ready", 120), root("b", "ready", 80)))
        assertEquals("Index ready · 200 files", p.text)
    }

    @Test
    fun `indexing with known totals shows N over M`() {
        val p = IndexStatusFormatter.present(listOf(root("a", "indexing", 40, total = 100)))
        assertEquals("Indexing 40/100 files…", p.text)
    }

    @Test
    fun `indexing drops the denominator when any total is unknown`() {
        val p =
            IndexStatusFormatter.present(
                listOf(root("a", "indexing", 40, total = 100), root("b", "indexing", 10, total = null)),
            )
        assertEquals("Indexing 50 files…", p.text)
    }

    @Test
    fun `indexing outranks ready in a mixed set`() {
        val p = IndexStatusFormatter.present(listOf(root("a", "ready", 100), root("b", "indexing", 5, total = 50)))
        assertTrue(p.text.startsWith("Indexing"), p.text)
    }

    @Test
    fun `any error outranks indexing and ready`() {
        val p =
            IndexStatusFormatter.present(
                listOf(root("a", "ready", 100), root("b", "indexing", 5), root("c", "error", 0, message = "EACCES")),
            )
        assertEquals("Index: error (1)", p.text)
        assertTrue(p.tooltip.contains("EACCES"), p.tooltip)
    }

    @Test
    fun `tooltip carries a per-root line`() {
        val p = IndexStatusFormatter.present(listOf(root("repo-1", "ready", 42)))
        assertTrue(p.tooltip.contains("repo-1: ready 42 files"), p.tooltip)
    }
}
