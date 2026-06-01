package de.event4u.agent.chat

import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import de.event4u.agent.ui.RoundedPanel
import de.event4u.agent.ui.Theme
import java.awt.BorderLayout
import java.awt.Component
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Pure-function renderer: a [ChatMessage] → a Swing [JComponent]. Stateless,
 * unit-testable for structure assertions (the live render needs the IDE).
 */
object ChatMessageRenderer {
    fun render(message: ChatMessage): JComponent =
        when (message) {
            is UserMessage -> renderUser(message)
            is AssistantMessage -> renderAssistant(message)
            is HaltMessage -> renderHalt(message)
        }

    private fun renderUser(message: UserMessage): JComponent {
        val container = card("You", tinted = true)
        container.add(body(message.text))
        return container
    }

    private fun renderAssistant(message: AssistantMessage): JComponent {
        val container = card("Agent" + if (message.streaming) " · streaming" else "", tinted = false)
        if (message.text.isNotEmpty()) {
            container.add(body(message.text))
        }
        for (call in message.toolCalls) container.add(renderToolCall(call))
        if (message.costFooter != null) container.add(renderCostFooter(message.costFooter))
        return container
    }

    private fun renderHalt(message: HaltMessage): JComponent {
        val container = card("Agent halted", tinted = true)
        container.add(
            JBLabel(message.question).apply {
                border = JBUI.Borders.empty(LABEL_PAD)
                alignmentX = Component.LEFT_ALIGNMENT
            },
        )
        for (option in message.options) {
            val button = JButton(option.label)
            option.description?.let { button.toolTipText = it }
            button.actionCommand = option.optionId
            button.alignmentX = Component.LEFT_ALIGNMENT
            container.add(button)
        }
        return container
    }

    private fun body(markdown: String): JComponent =
        newChatEditorPane(SimpleMarkdownRenderer.toHtml(markdown)).apply {
            alignmentX = Component.LEFT_ALIGNMENT
        }

    private fun renderToolCall(call: ToolCallSummary): JComponent {
        val container =
            JBPanel<JBPanel<*>>(BorderLayout()).apply {
                border = JBUI.Borders.empty(TOOL_CARD_PAD)
                background = UIUtil.getTextFieldBackground()
                alignmentX = Component.LEFT_ALIGNMENT
            }
        val header = JBLabel(toolHeader(call)).apply { border = JBUI.Borders.emptyBottom(TOOL_HEADER_GAP) }
        container.add(header, BorderLayout.NORTH)
        if (call.output.isNotEmpty()) {
            container.add(
                newChatEditorPane(SimpleMarkdownRenderer.toHtml("```\n${call.output}\n```")),
                BorderLayout.CENTER,
            )
        }
        return container
    }

    private fun renderCostFooter(footer: CostFooter): JComponent =
        JBLabel(CostFooterFormatter.footer(footer)).apply {
            border = JBUI.Borders.empty(COST_PAD)
            font = Theme.Fonts.small()
            foreground = Theme.Colors.mutedText()
            alignmentX = Component.LEFT_ALIGNMENT
        }

    private fun toolHeader(call: ToolCallSummary): String {
        val mark =
            when (call.outcome) {
                ToolOutcome.OK -> "✅"
                ToolOutcome.ERROR -> "❌"
                ToolOutcome.PENDING -> "…"
            }
        return "$mark ${call.name}(${truncate(call.argsPreview, ARG_PREVIEW_MAX)})"
    }

    private fun truncate(
        text: String,
        max: Int,
    ): String = if (text.length <= max) text else text.take(max) + "…"

    /**
     * One message card. User + halt turns get a tinted [RoundedPanel] bubble
     * (fill + 1 px border) so they read as distinct from the agent's plain
     * turns; the agent's turn stays transparent over the surface. Every child
     * is left-aligned so the vertical [BoxLayout] does not centre short content.
     */
    private fun card(
        title: String,
        tinted: Boolean,
    ): JPanel {
        val panel: JPanel =
            if (tinted) {
                RoundedPanel(
                    fillColor = { Theme.Colors.surfaceInset() },
                    borderColor = { Theme.Colors.border() },
                )
            } else {
                JBPanel<JBPanel<*>>().apply { isOpaque = false }
            }
        panel.layout = BoxLayout(panel, BoxLayout.Y_AXIS)
        panel.border = JBUI.Borders.empty(CARD_PAD_V, CARD_PAD_H)
        panel.alignmentX = Component.LEFT_ALIGNMENT
        panel.add(
            JBLabel(title).apply {
                font = Theme.Fonts.small()
                foreground = Theme.Colors.mutedText()
                border = JBUI.Borders.emptyBottom(ROLE_GAP)
                alignmentX = Component.LEFT_ALIGNMENT
            },
        )
        return panel
    }

    private const val CARD_PAD_V = 6
    private const val CARD_PAD_H = 10
    private const val ROLE_GAP = 2
    private const val LABEL_PAD = 4
    private const val TOOL_CARD_PAD = 6
    private const val TOOL_HEADER_GAP = 4
    private const val COST_PAD = 4
    private const val ARG_PREVIEW_MAX = 60
}
