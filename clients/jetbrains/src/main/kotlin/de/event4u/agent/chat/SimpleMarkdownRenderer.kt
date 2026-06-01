package de.event4u.agent.chat

/**
 * Minimal markdown → HTML conversion sufficient for the MVP chat surface.
 *
 * Replaces the heavier Flexmark dependency for v0. Supports: paragraphs,
 * inline `code`, fenced ```code blocks```, basic bold + italic, and bullet
 * lists (single level). Anything more elaborate (tables, KaTeX, Mermaid) is
 * cut to v1.0 Sprint 13 per the roadmap.
 *
 * Output is HTML that `JEditorPane` with `text/html` content type can render.
 */
object SimpleMarkdownRenderer {
    @Suppress("LoopWithTooManyJumpStatements")
    fun toHtml(markdown: String): String {
        val sanitized = escapeHtml(markdown)
        val lines = sanitized.lines()
        val out = StringBuilder(HEAD)
        var i = 0
        var inList = false

        while (i < lines.size) {
            val line = lines[i]
            if (line.startsWith("```")) {
                if (inList) {
                    out.append("</ul>")
                    inList = false
                }
                val (block, consumed) = readFencedBlock(lines, i)
                out.append(block)
                i += consumed
                continue
            }
            if (BULLET_REGEX.containsMatchIn(line)) {
                if (!inList) {
                    out.append("<ul>")
                    inList = true
                }
                out.append("<li>").append(applyInline(BULLET_REGEX.replace(line, ""))).append("</li>")
                i += 1
                continue
            }
            if (inList) {
                out.append("</ul>")
                inList = false
            }
            if (!line.isBlank()) {
                // Blank lines need no <br>: the tight <p> margins in HEAD already
                // separate paragraphs. Emitting <br> here doubled the vertical gap.
                out.append("<p>").append(applyInline(line)).append("</p>")
            }
            i += 1
        }
        if (inList) out.append("</ul>")
        out.append("</body></html>")
        return out.toString()
    }

    private fun readFencedBlock(
        lines: List<String>,
        start: Int,
    ): Pair<String, Int> {
        val builder = StringBuilder("<pre style='background:#2b2b2b;color:#a9b7c6;padding:8px'><code>")
        var i = start + 1
        while (i < lines.size && !lines[i].startsWith("```")) {
            builder.append(lines[i]).append('\n')
            i += 1
        }
        builder.append("</code></pre>")
        // skip the closing fence (or EOF if missing)
        val consumed = (i - start) + 1
        return builder.toString() to consumed
    }

    private fun applyInline(text: String): String {
        var current = text
        current = INLINE_CODE_REGEX.replace(current) { "<code>${it.groupValues[1]}</code>" }
        current = BOLD_REGEX.replace(current) { "<b>${it.groupValues[1]}</b>" }
        current = ITALIC_REGEX.replace(current) { "<i>${it.groupValues[1]}</i>" }
        return current
    }

    private fun escapeHtml(text: String): String =
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")

    // Tight margins so chat turns read as compact blocks, not double-spaced
    // prose. JEditorPane's HTMLEditorKit honours a <style> block in the head.
    private const val HEAD =
        "<html><head><style>" +
            "body{font-family:sans-serif;margin:0;padding:0}" +
            "p{margin:2px 0}" +
            "ul{margin:2px 0;padding-left:18px}" +
            "li{margin:0}" +
            "pre{margin:4px 0}" +
            "</style></head><body>"

    private val BULLET_REGEX = Regex("^\\s*[-*]\\s+")
    private val INLINE_CODE_REGEX = Regex("`([^`]+)`")
    private val BOLD_REGEX = Regex("\\*\\*([^*]+)\\*\\*")
    private val ITALIC_REGEX = Regex("(?<!\\*)\\*([^*]+)\\*(?!\\*)")
}
