package de.event4u.agent.chat

import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
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
        val container = card("You")
        container.add(newChatEditorPane(SimpleMarkdownRenderer.toHtml(message.text)))
        return container
    }

    private fun renderAssistant(message: AssistantMessage): JComponent {
        val container = card("Agent" + if (message.streaming) " · streaming" else "")
        if (message.text.isNotEmpty()) {
            container.add(newChatEditorPane(SimpleMarkdownRenderer.toHtml(message.text)))
        }
        for (call in message.toolCalls) container.add(renderToolCall(call))
        if (message.costFooter != null) container.add(renderCostFooter(message.costFooter))
        return container
    }

    private fun renderHalt(message: HaltMessage): JComponent {
        val container = card("Agent halted")
        container.add(JBLabel(message.question).apply { border = JBUI.Borders.empty(LABEL_PAD) })
        for (option in message.options) {
            val button = JButton(option.label)
            option.description?.let { button.toolTipText = it }
            button.actionCommand = option.optionId
            container.add(button)
        }
        return container
    }

    private fun renderToolCall(call: ToolCallSummary): JComponent {
        val container =
            JBPanel<JBPanel<*>>(BorderLayout()).apply {
                border = JBUI.Borders.empty(TOOL_CARD_PAD)
                background = UIUtil.getTextFieldBackground()
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

    private fun card(title: String): JPanel {
        val panel =
            JBPanel<JBPanel<*>>().apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                border = JBUI.Borders.empty(CARD_PAD)
                background = JBUI.CurrentTheme.ToolWindow.background()
            }
        panel.add(JBLabel("<html><b>$title</b></html>"))
        return panel
    }

    private const val CARD_PAD = 6
    private const val LABEL_PAD = 4
    private const val TOOL_CARD_PAD = 6
    private const val TOOL_HEADER_GAP = 4
    private const val COST_PAD = 4
    private const val ARG_PREVIEW_MAX = 60
}
