package de.event4u.agent.ui

import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JComponent

/**
 * Top-of-toolwindow header (C-1). 36 px tall, wordmark on the left, three
 * icon actions on the right, 1 px separator at the bottom.
 *
 * Buttons that don't have a real action yet ship disabled per the user's
 * "build the buttons as disabled" directive — they're visible so the layout
 * locks; wiring lands when the project service exposes the hook.
 */
class Header(
    private val onNewThread: () -> Unit = {},
    private val onHistory: () -> Unit = {},
    private val onMenu: () -> Unit = {},
    historyEnabled: Boolean = false,
    newThreadEnabled: Boolean = false,
    menuEnabled: Boolean = true,
) : JBPanel<Header>(BorderLayout()) {
    init {
        border =
            JBUI.Borders.compound(
                JBUI.Borders.customLine(Theme.Colors.border(), 0, 0, 1, 0),
                JBUI.Borders.empty(0, Theme.Space.MD),
            )
        preferredSize = Dimension(0, Theme.Size.HEADER_HEIGHT)
        background = Theme.Colors.surface()

        add(buildWordmark(), BorderLayout.WEST)
        add(buildActions(historyEnabled, newThreadEnabled, menuEnabled), BorderLayout.EAST)
    }

    private fun buildWordmark(): JComponent =
        JBLabel("event4u", AllIcons.Actions.IntentionBulb, JBLabel.LEADING).apply {
            font = Theme.Fonts.body()
            foreground = Theme.Colors.primaryText()
            iconTextGap = Theme.Space.SM
        }

    private fun buildActions(
        historyEnabled: Boolean,
        newThreadEnabled: Boolean,
        menuEnabled: Boolean,
    ): JComponent {
        val cluster =
            JBPanel<JBPanel<*>>().apply {
                layout = BoxLayout(this, BoxLayout.X_AXIS)
                isOpaque = false
            }
        cluster.add(
            IconButton.create(
                AllIcons.Vcs.History,
                tooltip = "Conversation history (v1.0)",
                enabled = historyEnabled,
                onClick = onHistory,
            ),
        )
        cluster.add(Box.createHorizontalStrut(Theme.Space.XS))
        cluster.add(
            IconButton.create(
                AllIcons.General.Add,
                tooltip = "New thread",
                enabled = newThreadEnabled,
                onClick = onNewThread,
            ),
        )
        cluster.add(Box.createHorizontalStrut(Theme.Space.XS))
        cluster.add(
            IconButton.create(
                AllIcons.Actions.More,
                tooltip = "Settings + diagnostics",
                enabled = menuEnabled,
                onClick = onMenu,
            ),
        )
        return cluster
    }
}
