package de.event4u.agent.ui

import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import de.event4u.agent.chat.ConversationMode
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.DnDConstants
import java.awt.dnd.DropTarget
import java.awt.dnd.DropTargetAdapter
import java.awt.dnd.DropTargetDropEvent
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.io.File
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

/**
 * Three-row composer container (C-3). Owns chip rail, multi-line input,
 * and the action bar (mode pill + model pill + icon buttons).
 *
 * The container itself is a [RoundedPanel] so the chrome is one bordered
 * card — no nested borders, no JButton chrome, no default focus rectangle.
 *
 * Drag-n-drop (C-8) attaches dropped files as chips via [onAttachFiles].
 * The webview equivalent lives on the VS Code side.
 */
@Suppress("TooManyFunctions") // Composer owns three rows + lifecycle + drag-n-drop; splitting hurts cohesion.
class Composer(
    private val callbacks: Callbacks,
) : RoundedPanel(null, Theme.Radius.CARD) {
    interface Callbacks {
        fun onSend(text: String, chips: List<ChipPayload>)

        fun onStop()

        fun onModeChange(mode: ConversationMode)

        fun onAttachFiles(files: List<File>)

        fun onOpenCommandPicker()

        fun onOpenMentionPicker()

        fun onModelPick(modelId: String)

        fun availableModels(): List<ModelPill.ModelOption>
    }

    data class ChipPayload(val kind: ChipKind, val label: String, val payload: String)

    enum class ChipKind { MENTION, COMMAND, FILE }

    private val chipRail =
        JBPanel<JBPanel<*>>().apply {
            layout = WrapLayout(align = WrapLayout.LEFT)
            isOpaque = false
            border = JBUI.Borders.empty(Theme.Space.XS)
        }
    private val input =
        JBTextArea().apply {
            rows = INPUT_ROWS
            lineWrap = true
            wrapStyleWord = true
            font = Theme.Fonts.body()
            border = JBUI.Borders.empty(Theme.Space.SM)
            isOpaque = false
        }
    private val modePill = ModePill { mode -> callbacks.onModeChange(mode) }
    private val modelPill =
        ModelPill(
            initialModel = "claude-sonnet-4-6",
            models = { callbacks.availableModels() },
            onPick = callbacks::onModelPick,
        )
    private val sendButton =
        IconButton.create(
            AllIcons.Actions.Execute,
            tooltip = "Send message (Enter)",
            enabled = false,
            onClick = ::sendCurrent,
        )
    private val stopButton =
        IconButton.create(
            AllIcons.Actions.Suspend,
            tooltip = "Stop streaming (Esc)",
            enabled = false,
            onClick = callbacks::onStop,
        )
    private val paperclipButton =
        IconButton.create(
            AllIcons.General.Attachment,
            tooltip = "Attach file or image",
            enabled = false, // file picker wired in Phase 4 host pass
            onClick = {},
        )
    private val sparkleButton =
        IconButton.create(
            AllIcons.Actions.IntentionBulb,
            tooltip = "Insert command (/)",
            enabled = true,
            onClick = callbacks::onOpenCommandPicker,
        )
    private val chips = mutableListOf<ChipPayload>()

    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        border = JBUI.Borders.empty(Theme.Space.SM)
        add(buildChipRailContainer())
        add(buildInputRow())
        add(buildActionBar())
        wireKeyboard()
        wireInputListener()
        wireDropTarget()
        rebuildChipRail()
    }

    fun setStreaming(streaming: Boolean) {
        stopButton.presentation.isEnabled = streaming
        sendButton.presentation.isEnabled = !streaming && input.text.trim().isNotEmpty()
        modePill.status = if (streaming) ModePill.PillStatus.STREAMING else ModePill.PillStatus.READY
    }

    fun setSidecarHealthy(healthy: Boolean) {
        if (!healthy) modePill.status = ModePill.PillStatus.ERROR
    }

    fun setMode(mode: ConversationMode) {
        modePill.mode = mode
    }

    fun setModel(modelId: String) {
        modelPill.modelId = modelId
    }

    fun addChip(chip: ChipPayload) {
        chips.add(chip)
        rebuildChipRail()
    }

    private fun buildChipRailContainer(): JComponent =
        JBPanel<JBPanel<*>>(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyBottom(Theme.Space.XS)
            add(chipRail, BorderLayout.CENTER)
        }

    private fun buildInputRow(): JComponent =
        JBScrollPane(input).apply {
            border = BorderFactory.createEmptyBorder()
            viewport.isOpaque = false
            isOpaque = false
            preferredSize = Dimension(0, Theme.Size.INPUT_MIN_HEIGHT)
        }

    private fun buildActionBar(): JComponent {
        val left =
            JBPanel<JBPanel<*>>().apply {
                layout = BoxLayout(this, BoxLayout.X_AXIS)
                isOpaque = false
                add(modePill)
                add(Box.createHorizontalStrut(Theme.Space.SM))
                add(modelPill)
            }
        val right =
            JBPanel<JBPanel<*>>().apply {
                layout = BoxLayout(this, BoxLayout.X_AXIS)
                isOpaque = false
                add(paperclipButton)
                add(Box.createHorizontalStrut(Theme.Space.XS))
                add(sparkleButton)
                add(Box.createHorizontalStrut(Theme.Space.XS))
                add(sendButton)
                add(Box.createHorizontalStrut(Theme.Space.XS))
                add(stopButton)
            }
        return JBPanel<JBPanel<*>>(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.emptyTop(Theme.Space.XS)
            add(left, BorderLayout.WEST)
            add(right, BorderLayout.EAST)
        }
    }

    private fun wireKeyboard() {
        input.addKeyListener(
            object : KeyAdapter() {
                override fun keyPressed(e: KeyEvent) {
                    when {
                        e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown -> {
                            e.consume()
                            sendCurrent()
                        }
                        e.keyCode == KeyEvent.VK_ESCAPE && stopButton.presentation.isEnabled -> {
                            e.consume()
                            callbacks.onStop()
                        }
                    }
                }
            },
        )
    }

    private fun wireInputListener() {
        input.document.addDocumentListener(
            object : DocumentListener {
                override fun insertUpdate(e: DocumentEvent?) = onInputChanged()

                override fun removeUpdate(e: DocumentEvent?) = onInputChanged()

                override fun changedUpdate(e: DocumentEvent?) = onInputChanged()
            },
        )
    }

    private fun wireDropTarget() {
        dropTarget =
            DropTarget(
                this,
                DnDConstants.ACTION_COPY_OR_MOVE,
                object : DropTargetAdapter() {
                    override fun drop(event: DropTargetDropEvent) {
                        event.acceptDrop(DnDConstants.ACTION_COPY_OR_MOVE)
                        val transferable = event.transferable
                        if (transferable.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
                            @Suppress("UNCHECKED_CAST")
                            val files =
                                transferable.getTransferData(DataFlavor.javaFileListFlavor) as List<File>
                            callbacks.onAttachFiles(files)
                            for (file in files) {
                                addChip(
                                    ChipPayload(
                                        kind = ChipKind.FILE,
                                        label = file.name,
                                        payload = file.absolutePath,
                                    ),
                                )
                            }
                            event.dropComplete(true)
                        } else {
                            event.dropComplete(false)
                        }
                    }
                },
            )
    }

    private fun onInputChanged() {
        sendButton.presentation.isEnabled = input.text.trim().isNotEmpty()
    }

    private fun sendCurrent() {
        val text = input.text.trim()
        if (text.isEmpty()) return
        callbacks.onSend(text, chips.toList())
        input.text = ""
        chips.clear()
        rebuildChipRail()
    }

    private fun rebuildChipRail() {
        chipRail.removeAll()
        chipRail.add(
            Chip("@", Chip.Variant.INLINE, onClick = callbacks::onOpenMentionPicker),
        )
        chipRail.add(
            Chip("/", Chip.Variant.INLINE, onClick = callbacks::onOpenCommandPicker),
        )
        for (chip in chips) {
            chipRail.add(
                Chip(
                    text = chip.label,
                    variant =
                        when (chip.kind) {
                            ChipKind.MENTION -> Chip.Variant.MENTION
                            ChipKind.COMMAND -> Chip.Variant.COMMAND
                            ChipKind.FILE -> Chip.Variant.FILE
                        },
                    onRemove = {
                        chips.remove(chip)
                        rebuildChipRail()
                    },
                ),
            )
        }
        chipRail.revalidate()
        chipRail.repaint()
    }

    private companion object {
        const val INPUT_ROWS = 3
    }
}
