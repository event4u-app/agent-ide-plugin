package de.event4u.agent.ui

import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.BoxLayout
import javax.swing.JComponent

/**
 * Empty-state card for the chat surface (C-2). Centred horizontally +
 * vertically; max-width 320 px; soft elevation via the standard
 * [RoundedPanel] painter.
 *
 * Created by [build]; consumers swap it out the moment the first message
 * arrives. Not a long-lived component — the chat panel rebuilds the message
 * region on every snapshot.
 */
object WelcomeCard {
    fun build(): JComponent {
        val card =
            RoundedPanel(radius = Theme.Radius.CARD).apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                border = JBUI.Borders.empty(Theme.Space.LG)
                maximumSize = Dimension(Theme.Size.WELCOME_CARD_MAX_WIDTH, Int.MAX_VALUE)
                preferredSize = Dimension(Theme.Size.WELCOME_CARD_MAX_WIDTH, PREFERRED_HEIGHT)
            }
        card.add(
            JBLabel("<html><b>New event4u thread</b></html>", AllIcons.Actions.IntentionBulb, JBLabel.LEADING)
                .apply {
                    font = Theme.Fonts.body()
                    border = JBUI.Borders.emptyBottom(Theme.Space.XS)
                },
        )
        card.add(
            JBLabel(
                "<html>Pick a command with <code>/</code>, attach context with " +
                    "<code>@</code>, or just ask.</html>",
            ).apply {
                font = Theme.Fonts.small()
                foreground = Theme.Colors.mutedText()
            },
        )
        val outer = RoundedPanel(GridBagLayout()).apply { isOpaque = false }
        outer.add(card, GridBagConstraints())
        return outer
    }

    private const val PREFERRED_HEIGHT = 110
}
