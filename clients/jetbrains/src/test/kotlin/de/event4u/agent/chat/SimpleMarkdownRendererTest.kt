package de.event4u.agent.chat

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SimpleMarkdownRendererTest {
    @Test
    fun `wraps paragraphs in p tags`() {
        val html = SimpleMarkdownRenderer.toHtml("Hello world\n\nSecond line.")
        assertTrue(html.contains("<p>Hello world</p>"))
        assertTrue(html.contains("<p>Second line.</p>"))
    }

    @Test
    fun `renders fenced code blocks in pre tags`() {
        val html = SimpleMarkdownRenderer.toHtml("```\nconst x = 1;\n```")
        assertTrue(html.contains("<pre"))
        assertTrue(html.contains("const x = 1;"))
    }

    @Test
    fun `inline backticks become code spans`() {
        val html = SimpleMarkdownRenderer.toHtml("Run `npm test`.")
        assertTrue(html.contains("<code>npm test</code>"))
    }

    @Test
    fun `bold and italic are emitted with semantic tags`() {
        val html = SimpleMarkdownRenderer.toHtml("**bold** and *italic*")
        assertTrue(html.contains("<b>bold</b>"))
        assertTrue(html.contains("<i>italic</i>"))
    }

    @Test
    fun `bullet lists wrap in ul tags`() {
        val html = SimpleMarkdownRenderer.toHtml("- one\n- two\n")
        assertTrue(html.contains("<ul>"))
        assertTrue(html.contains("<li>one</li>"))
        assertTrue(html.contains("<li>two</li>"))
    }

    @Test
    fun `escapes raw angle brackets`() {
        val html = SimpleMarkdownRenderer.toHtml("a < b")
        assertTrue(html.contains("a &lt; b"))
        assertFalse(html.contains("<b>"))
    }
}
