package de.event4u.agent.ui

import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import de.event4u.agent.chat.ConversationMode
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

/**
 * Mode pill — replaces the giant rectangular `JButton("API")` with a 24 px
 * tall pill carrying a 6 px status dot + the active mode label.
 *
 * Click cycles AUTO → API → CLI → AUTO. The status dot reflects the
 * sidecar-derived [PillStatus] (READY / STREAMING / ERROR) — moved here
 * from the standalone top-bar dot per the design contract (C-9).
 *
 * Spec: road-to-mvp-ui-design.md § C-4.
 */
class ModePill(
    initialMode: ConversationMode = ConversationMode.API,
    private val onModeChange: (ConversationMode) -> Unit = {},
) : JBLabel() {
    enum class PillStatus(val color: Color) {
        READY(Theme.Colors.STATUS_READY),
        STREAMING(Theme.Colors.STATUS_STREAMING),
        ERROR(Theme.Colors.STATUS_ERROR),
    }

    var mode: ConversationMode = initialMode
        set(value) {
            field = value
            text = labelFor(value)
            repaint()
        }
    var status: PillStatus = PillStatus.READY
        set(value) {
            field = value
            repaint()
        }

    init {
        font = Theme.Fonts.small()
        foreground = Theme.Colors.primaryText()
        text = labelFor(mode)
        border =
            JBUI.Borders.empty(
                Theme.Space.XXS,
                Theme.Size.STATUS_DOT + Theme.Space.SM + DOT_LABEL_GAP,
                Theme.Space.XXS,
                Theme.Space.SM,
            )
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Mode: ${labelFor(mode)}. Click to cycle Auto → API → CLI."
        isOpaque = false
        preferredSize = Dimension(PILL_WIDTH, Theme.Size.PILL_HEIGHT)
        addMouseListener(
            object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) = cycle()
            },
        )
    }

    private fun cycle() {
        mode =
            when (mode) {
                ConversationMode.API -> ConversationMode.CLI
                ConversationMode.CLI -> ConversationMode.API
            }
        toolTipText = "Mode: ${labelFor(mode)}. Click to cycle Auto → API → CLI."
        onModeChange(mode)
    }

    private fun labelFor(m: ConversationMode): String = m.name

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = Theme.Colors.surfaceInset()
            g2.fillRoundRect(0, 0, width, height, Theme.Radius.CHIP, Theme.Radius.CHIP)
            g2.color = status.color
            val dotY = (height - Theme.Size.STATUS_DOT) / 2
            g2.fillOval(Theme.Space.SM, dotY, Theme.Size.STATUS_DOT, Theme.Size.STATUS_DOT)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private companion object {
        const val DOT_LABEL_GAP = 2
        const val PILL_WIDTH = 80
    }
}
