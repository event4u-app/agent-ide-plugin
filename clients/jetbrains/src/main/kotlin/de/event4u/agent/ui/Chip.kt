package de.event4u.agent.ui

import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon

/**
 * Pill-shape chip carrying an optional leading icon, a label, and an optional
 * trailing × hit zone. Replaces the misuse of `JLabel` + raw border that the
 * design contract bans (C-7).
 *
 * Variants:
 *   - `MENTION`  ─ `@` context chip; muted background, default text.
 *   - `COMMAND`  ─ `/` slash-command chip; accent background, white text.
 *   - `FILE`     ─ attached file or image chip; muted background, file icon.
 *   - `INLINE`   ─ leading composer-row buttons (`@`, `/`); same shape, no ×.
 */
class Chip(
    text: String,
    private val variant: Variant = Variant.MENTION,
    icon: Icon? = null,
    private val onRemove: (() -> Unit)? = null,
    private val onClick: (() -> Unit)? = null,
) : JBLabel("$text${if (onRemove != null) "  ×" else ""}", icon, LEADING) {
    enum class Variant { MENTION, COMMAND, FILE, INLINE }

    init {
        font = Theme.Fonts.small()
        foreground =
            when (variant) {
                Variant.COMMAND -> JBUI.CurrentTheme.Button.foreground()
                else -> Theme.Colors.primaryText()
            }
        border = JBUI.Borders.empty(Theme.Space.XXS, Theme.Space.SM)
        isOpaque = false
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        preferredSize = Dimension(preferredSize.width, Theme.Size.CHIP_HEIGHT)
        addMouseListener(
            object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) {
                    if (onRemove != null && e.x > width - REMOVE_HIT_WIDTH) {
                        onRemove.invoke()
                    } else {
                        onClick?.invoke()
                    }
                }
            },
        )
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = backgroundFor(variant)
            g2.fillRoundRect(0, 0, width, height, Theme.Radius.CHIP, Theme.Radius.CHIP)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private fun backgroundFor(v: Variant): Color =
        when (v) {
            Variant.COMMAND -> Theme.Colors.accent()
            else -> Theme.Colors.surfaceInset()
        }

    private companion object {
        const val REMOVE_HIT_WIDTH = 16
    }
}
