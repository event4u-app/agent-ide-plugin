package de.event4u.agent.ui

import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

/**
 * Model pill — shows the active model + opens a picker. Replaces the silent
 * `(no model)` in the statusbar (C-5).
 *
 * Constructor takes a label provider so the host can pass formatted price
 * annotations; the popup is rendered via `JBPopupFactory`, the same API the
 * IntelliJ Platform itself uses for choose-from-list flows.
 */
class ModelPill(
    initialModel: String,
    private val models: () -> List<ModelOption>,
    private val onPick: (String) -> Unit = {},
) : JBLabel() {
    data class ModelOption(val id: String, val priceLabel: String)

    var modelId: String = initialModel
        set(value) {
            field = value
            text = "$value  ▾"
            repaint()
        }

    init {
        font = Theme.Fonts.small()
        foreground = Theme.Colors.primaryText()
        text = "$initialModel  ▾"
        border = JBUI.Borders.empty(Theme.Space.XXS, Theme.Space.SM)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Active model — click to switch."
        isOpaque = false
        preferredSize = Dimension(PILL_WIDTH, Theme.Size.PILL_HEIGHT)
        addMouseListener(
            object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) = showPicker()
            },
        )
    }

    private fun showPicker() {
        val options = models()
        if (options.isEmpty()) return
        val step =
            object : BaseListPopupStep<ModelOption>("Pick a model", options) {
                override fun getTextFor(value: ModelOption): String = "${value.id}    ${value.priceLabel}"

                override fun onChosen(
                    selectedValue: ModelOption?,
                    finalChoice: Boolean,
                ): PopupStep<*>? {
                    selectedValue?.let {
                        modelId = it.id
                        onPick(it.id)
                    }
                    return null
                }
            }
        JBPopupFactory.getInstance().createListPopup(step).showUnderneathOf(this)
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = Theme.Colors.surfaceInset()
            g2.fillRoundRect(0, 0, width, height, Theme.Radius.CHIP, Theme.Radius.CHIP)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private companion object {
        const val PILL_WIDTH = 160
    }
}
