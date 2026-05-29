package de.event4u.agent.chat

import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.impl.ActionToolbarImpl
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.KeyEvent
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

/**
 * T-202 — JetBrains chat surface (Swing).
 *
 * The chat is a presentational layer over the sidecar — every interaction
 * funnels back through an injected [ChatController]. The Tool Window factory
 * builds + installs this panel; the controller is owned by the project-level
 * service (TBD) that holds the [de.event4u.agent.SidecarClient] handle.
 */
class ChatPanel(private val controller: ChatController) : JBPanel<ChatPanel>(BorderLayout()) {
    private val messagesContainer =
        JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(PANEL_PADDING)
            background = JBUI.CurrentTheme.ToolWindow.background()
        }
    private val messagesScroll =
        JBScrollPane(messagesContainer).apply {
            border = JBUI.Borders.empty()
            verticalScrollBar.unitIncrement = SCROLL_UNIT
        }
    private val statusDot = StatusDot()
    private val streamingLabel =
        JBLabel(" ").apply {
            border = JBUI.Borders.emptyLeft(STREAMING_LEFT_PAD)
        }
    private val inputArea =
        JBTextArea().apply {
            rows = INPUT_ROWS
            lineWrap = true
            wrapStyleWord = true
        }
    private val sendButton = JButton("Send")
    private val stopButton = JButton("Stop").apply { isEnabled = false }
    private val modeToggle = JButton("API")

    init {
        border = JBUI.Borders.empty(PANEL_PADDING)
        add(buildHeader(), BorderLayout.NORTH)
        add(messagesScroll, BorderLayout.CENTER)
        add(buildInputArea(), BorderLayout.SOUTH)
        wireKeyboard()
        wireSendStop()
        wireModeToggle()
        controller.onModelChange = ::renderModel
        renderModel(controller.snapshot())
    }

    private fun buildHeader(): JComponent =
        JBPanel<JBPanel<*>>(BorderLayout()).apply {
            border = JBUI.Borders.emptyBottom(HEADER_BOTTOM_PAD)
            add(statusDot, BorderLayout.WEST)
            add(modeToggle, BorderLayout.EAST)
            add(streamingLabel, BorderLayout.CENTER)
        }

    private fun buildInputArea(): JComponent {
        val buttons =
            Box.createHorizontalBox().apply {
                add(sendButton)
                add(Box.createHorizontalStrut(BUTTON_GAP))
                add(stopButton)
            }
        val inputScroll =
            JBScrollPane(inputArea).apply {
                preferredSize = Dimension(0, INPUT_PREFERRED_HEIGHT)
                border = JBUI.Borders.customLine(JBUI.CurrentTheme.CustomFrameDecorations.separatorForeground())
            }
        return JBPanel<JBPanel<*>>(BorderLayout()).apply {
            border = JBUI.Borders.emptyTop(INPUT_TOP_PAD)
            add(inputScroll, BorderLayout.CENTER)
            add(buttons, BorderLayout.SOUTH)
        }
    }

    private fun wireKeyboard() {
        val enter = KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0)
        inputArea.inputMap.put(enter, "send")
        inputArea.actionMap.put(
            "send",
            object : javax.swing.AbstractAction() {
                override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                    sendCurrentInput()
                }
            },
        )
        val shiftEnter = KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, KeyEvent.SHIFT_DOWN_MASK)
        inputArea.inputMap.put(shiftEnter, "insert-newline")
        inputArea.actionMap.put(
            "insert-newline",
            object : javax.swing.AbstractAction() {
                override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                    inputArea.insert("\n", inputArea.caretPosition)
                }
            },
        )
        val esc = KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0)
        inputArea.inputMap.put(esc, "stop-on-esc")
        inputArea.actionMap.put(
            "stop-on-esc",
            object : javax.swing.AbstractAction() {
                override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                    if (stopButton.isEnabled) controller.requestStop()
                }
            },
        )
        inputArea.document.addDocumentListener(
            object : DocumentListener {
                override fun insertUpdate(e: DocumentEvent?) = onInputChanged()

                override fun removeUpdate(e: DocumentEvent?) = onInputChanged()

                override fun changedUpdate(e: DocumentEvent?) = onInputChanged()
            },
        )
    }

    private fun onInputChanged() {
        sendButton.isEnabled = inputArea.text.trim().isNotEmpty() && !controller.isStreaming()
    }

    private fun wireSendStop() {
        sendButton.addActionListener { sendCurrentInput() }
        stopButton.addActionListener { controller.requestStop() }
    }

    private fun wireModeToggle() {
        modeToggle.addActionListener {
            val next =
                if (controller.currentMode() == ConversationMode.API) {
                    ConversationMode.CLI
                } else {
                    ConversationMode.API
                }
            controller.setMode(next)
        }
    }

    private fun sendCurrentInput() {
        val text = inputArea.text.trim()
        if (text.isEmpty() || controller.isStreaming()) return
        controller.send(text)
        inputArea.text = ""
    }

    /**
     * Re-render the message list. Called both on incremental streaming chunks
     * and on full model swaps. The container is rebuilt rather than diffed —
     * MVP message counts are bounded and the diff cost would dwarf the rebuild.
     */
    fun renderModel(snapshot: ChatModelSnapshot) {
        if (!SwingUtilities.isEventDispatchThread()) {
            SwingUtilities.invokeLater { renderModel(snapshot) }
            return
        }
        messagesContainer.removeAll()
        for (message in snapshot.messages) {
            messagesContainer.add(ChatMessageRenderer.render(message))
            messagesContainer.add(Box.createVerticalStrut(MESSAGE_GAP))
        }
        messagesContainer.revalidate()
        messagesContainer.repaint()
        statusDot.state = snapshot.statusDotState()
        streamingLabel.text = snapshot.streamingSummary?.let { CostFooterFormatter.streaming(it) } ?: " "
        stopButton.isEnabled = snapshot.streamingSummary != null
        sendButton.isEnabled = snapshot.streamingSummary == null && inputArea.text.trim().isNotEmpty()
        modeToggle.text = snapshot.mode.name
    }

    private companion object {
        const val PANEL_PADDING = 8
        const val HEADER_BOTTOM_PAD = 6
        const val INPUT_TOP_PAD = 6
        const val INPUT_ROWS = 3
        const val INPUT_PREFERRED_HEIGHT = 80
        const val BUTTON_GAP = 6
        const val MESSAGE_GAP = 8
        const val STREAMING_LEFT_PAD = 8
        const val SCROLL_UNIT = 16
    }
}

/**
 * Snapshot the Tool Window receives every time the chat model changes. The
 * controller assembles it; the panel re-renders.
 */
data class ChatModelSnapshot(
    val messages: List<ChatMessage>,
    val mode: ConversationMode,
    val streamingSummary: StreamingSummary?,
    val sidecarHealthy: Boolean,
) {
    fun statusDotState(): StatusDot.State =
        when {
            !sidecarHealthy -> StatusDot.State.ERROR
            streamingSummary != null -> StatusDot.State.STREAMING
            else -> StatusDot.State.READY
        }
}

/**
 * Contract the chat panel speaks to. The real implementation lives in the
 * project-level service that owns the sidecar; the panel doesn't care.
 */
interface ChatController {
    var onModelChange: (ChatModelSnapshot) -> Unit

    fun snapshot(): ChatModelSnapshot

    fun send(text: String)

    fun requestStop()

    fun isStreaming(): Boolean

    fun currentMode(): ConversationMode

    fun setMode(mode: ConversationMode)
}

/** Convenience action toolbar builder — kept here to keep AgentToolWindowFactory thin. */
internal fun buildEmptyToolbar(place: String): ActionToolbar =
    ActionToolbarImpl(place, DefaultActionGroup(), true).apply {
        targetComponent = null
    }

/** Build a JEditorPane configured for the chat markdown render path. */
internal fun newChatEditorPane(html: String): JEditorPane =
    JEditorPane().apply {
        contentType = "text/html"
        text = html
        isEditable = false
        border = JBUI.Borders.empty(EDITOR_PAD)
        background = JBUI.CurrentTheme.ToolWindow.background()
    }

private const val EDITOR_PAD = 4
