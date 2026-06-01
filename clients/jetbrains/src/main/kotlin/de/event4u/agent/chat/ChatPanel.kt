package de.event4u.agent.chat

import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import de.event4u.agent.ui.Composer
import de.event4u.agent.ui.Header
import de.event4u.agent.ui.ModelPill
import de.event4u.agent.ui.Theme
import de.event4u.agent.ui.WelcomeCard
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.Rectangle
import java.io.File
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.SwingUtilities

/**
 * T-202 — JetBrains chat surface (Swing).
 *
 * Three regions stacked in a [BorderLayout]:
 *   NORTH  ─ [Header] (logo + icon actions)
 *   CENTER ─ message list OR [WelcomeCard] when empty
 *   SOUTH  ─ [Composer] (chip rail + input + action bar)
 *
 * Every interaction funnels back through the injected [ChatController]; the
 * panel itself is presentational.
 */
class ChatPanel(private val controller: ChatController) : JBPanel<ChatPanel>(BorderLayout()) {
    private val messagesContainer = MessageListPanel()
    private val messagesScroll =
        JBScrollPane(messagesContainer).apply {
            border = JBUI.Borders.empty()
            verticalScrollBar.unitIncrement = SCROLL_UNIT
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            viewport.background = Theme.Colors.surface()
            isOpaque = false
        }
    private val composer =
        Composer(
            object : Composer.Callbacks {
                override fun onSend(
                    text: String,
                    chips: List<Composer.ChipPayload>,
                ) {
                    controller.send(text)
                }

                override fun onStop() {
                    controller.requestStop()
                }

                override fun onModeChange(mode: ConversationMode) {
                    controller.setMode(mode)
                }

                override fun onAttachFiles(files: List<File>) {
                    // Host wiring — see road-to-mvp-ui-finish.md Phase 4 § Step 3.
                }

                override fun onOpenCommandPicker() {
                    // Wired when the command picker overlay lands (T-402 host integration).
                }

                override fun onOpenMentionPicker() {
                    // Wired when the @-mention overlay lands (v1.0 Sprint 11).
                }

                override fun onModelPick(modelId: String) {
                    // Host service persists this; for now the pill updates locally.
                }

                override fun availableModels(): List<ModelPill.ModelOption> = controller.availableModels()
            },
        )

    init {
        border = JBUI.Borders.empty()
        background = Theme.Colors.surface()
        add(buildHeader(), BorderLayout.NORTH)
        add(buildCenter(), BorderLayout.CENTER)
        add(buildComposerArea(), BorderLayout.SOUTH)
        controller.onModelChange = ::renderModel
        renderModel(controller.snapshot())
    }

    private fun buildHeader(): JComponent =
        Header(
            historyEnabled = false,
            newThreadEnabled = false,
            menuEnabled = false,
        )

    private fun buildCenter(): JComponent =
        JBPanel<JBPanel<*>>(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty()
            add(messagesScroll, BorderLayout.CENTER)
        }

    private fun buildComposerArea(): JComponent =
        JBPanel<JBPanel<*>>(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(Theme.Space.MD)
            add(composer, BorderLayout.CENTER)
        }

    /**
     * Re-render the message region. Welcome card replaces the message list
     * when there are no messages yet.
     */
    fun renderModel(snapshot: ChatModelSnapshot) {
        if (!SwingUtilities.isEventDispatchThread()) {
            SwingUtilities.invokeLater { renderModel(snapshot) }
            return
        }
        messagesContainer.removeAll()
        if (snapshot.messages.isEmpty()) {
            messagesContainer.add(WelcomeCard.build())
        } else {
            for (message in snapshot.messages) {
                messagesContainer.add(ChatMessageRenderer.render(message))
                messagesContainer.add(Box.createVerticalStrut(Theme.Space.SM))
            }
        }
        messagesContainer.revalidate()
        messagesContainer.repaint()
        composer.setStreaming(snapshot.streamingSummary != null)
        composer.setSidecarHealthy(snapshot.sidecarHealthy)
        composer.setMode(snapshot.mode)
    }

    /**
     * Vertical message list that tracks the viewport width. Without
     * [getScrollableTracksViewportWidth] returning `true`, the surrounding
     * [JBScrollPane] hands the list its (very wide) preferred width instead of
     * the visible width — so message text ran off to the right and the
     * `JEditorPane` bodies never wrapped. Tracking the width pins the list to
     * the viewport, and the cards/editor panes wrap inside it.
     */
    private class MessageListPanel : JPanel(), Scrollable {
        init {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(Theme.Space.MD)
            isOpaque = false
            alignmentX = Component.LEFT_ALIGNMENT
        }

        override fun getPreferredScrollableViewportSize(): Dimension = preferredSize

        override fun getScrollableUnitIncrement(
            visibleRect: Rectangle,
            orientation: Int,
            direction: Int,
        ): Int = SCROLL_UNIT

        override fun getScrollableBlockIncrement(
            visibleRect: Rectangle,
            orientation: Int,
            direction: Int,
        ): Int = visibleRect.height

        override fun getScrollableTracksViewportWidth(): Boolean = true

        override fun getScrollableTracksViewportHeight(): Boolean = false
    }

    private companion object {
        const val SCROLL_UNIT = 16
    }
}

/**
 * Snapshot the Tool Window receives every time the chat model changes.
 */
data class ChatModelSnapshot(
    val messages: List<ChatMessage>,
    val mode: ConversationMode,
    val streamingSummary: StreamingSummary?,
    val sidecarHealthy: Boolean,
)

/** Contract the chat panel speaks to. */
interface ChatController {
    var onModelChange: (ChatModelSnapshot) -> Unit

    fun snapshot(): ChatModelSnapshot

    fun send(text: String)

    fun requestStop()

    fun isStreaming(): Boolean

    fun currentMode(): ConversationMode

    fun setMode(mode: ConversationMode)

    fun availableModels(): List<ModelPill.ModelOption>
}

/** Helper kept here so other modules can build a chat-render editor pane. */
internal fun newChatEditorPane(html: String): JEditorPane =
    JEditorPane().apply {
        contentType = "text/html"
        text = html
        isEditable = false
        border = JBUI.Borders.empty(Theme.Space.XS)
        // Transparent so the parent card's background (tinted user bubble or the
        // plain surface) shows through instead of a clashing opaque rectangle.
        isOpaque = false
        alignmentX = Component.LEFT_ALIGNMENT
    }
