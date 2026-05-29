package de.event4u.agent.chat

import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.RenderingHints

/**
 * Small circular indicator for the chat header (T-202). Shows the agent's
 * current state at a glance — streaming, ready, or error.
 */
class StatusDot : JBPanel<StatusDot>() {
    enum class State(val color: Color) {
        READY(JBUI.CurrentTheme.NotificationInfo.foregroundColor()),
        STREAMING(Color(GREEN_R, GREEN_G, GREEN_B)),
        ERROR(Color(RED_R, RED_G, RED_B)),
    }

    var state: State = State.READY
        set(value) {
            field = value
            repaint()
        }

    init {
        preferredSize = Dimension(DOT_SIZE, DOT_SIZE)
        isOpaque = false
        toolTipText = "Sidecar status"
    }

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val g2 = g.create() as java.awt.Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = state.color
            val pad = (width - INNER_SIZE) / 2
            g2.fillOval(pad, pad, INNER_SIZE, INNER_SIZE)
        } finally {
            g2.dispose()
        }
    }

    private companion object {
        const val DOT_SIZE = 14
        const val INNER_SIZE = 10
        const val GREEN_R = 76
        const val GREEN_G = 175
        const val GREEN_B = 80
        const val RED_R = 200
        const val RED_G = 70
        const val RED_B = 70
    }
}
