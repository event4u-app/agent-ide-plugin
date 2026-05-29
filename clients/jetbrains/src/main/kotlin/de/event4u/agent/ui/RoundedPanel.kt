package de.event4u.agent.ui

import com.intellij.ui.components.JBPanel
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.LayoutManager
import java.awt.RenderingHints

/**
 * Container painted with a rounded `radius` corner and optional 1 px border.
 * Replaces the default rectangular Swing background — `setOpaque(false)` so
 * the parent's surface shows through, then we draw the rounded fill + border
 * ourselves.
 *
 * Spec: see road-to-mvp-ui-design.md § C-3 (composer container), C-2
 * (welcome card), and the radius scale in Theme.
 */
open class RoundedPanel
    @JvmOverloads
    constructor(
        layout: LayoutManager? = null,
        private val radius: Int = Theme.Radius.CARD,
        private val fillColor: () -> Color = { Theme.Colors.surfaceInset() },
        private val borderColor: () -> Color? = { Theme.Colors.border() },
    ) : JBPanel<RoundedPanel>(layout) {
        init {
            isOpaque = false
        }

        override fun paintComponent(g: Graphics) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.color = fillColor()
                g2.fillRoundRect(0, 0, width, height, radius, radius)
                borderColor()?.let { stroke ->
                    g2.color = stroke
                    g2.drawRoundRect(0, 0, width - 1, height - 1, radius, radius)
                }
            } finally {
                g2.dispose()
            }
            super.paintComponent(g)
        }
    }
