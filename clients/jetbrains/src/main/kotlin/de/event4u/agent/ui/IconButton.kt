package de.event4u.agent.ui

import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.impl.ActionButton
import com.intellij.util.ui.JBUI
import javax.swing.Icon

/**
 * Borderless icon button — `ActionButton` factory wired to the design
 * contract's hit area + state semantics (C-6).
 *
 * Important: we use `ActionButton`, NOT `JButton`. `JButton` carries default
 * Swing chrome (focus rectangle, beveled border, grey disabled text) that
 * the design contract bans from the chat surface.
 */
object IconButton {
    /**
     * Build a borderless icon button. The action's `actionPerformed` runs the
     * supplied lambda; presentation carries the icon + tooltip + enabled flag.
     */
    fun create(
        icon: Icon,
        tooltip: String,
        enabled: Boolean = true,
        onClick: () -> Unit = {},
    ): ActionButton {
        val action =
            object : AnAction() {
                override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

                override fun update(e: AnActionEvent) {
                    e.presentation.isEnabled = enabled
                }

                override fun actionPerformed(e: AnActionEvent) = onClick()
            }
        val presentation =
            Presentation().apply {
                this.icon = icon
                description = tooltip
                isEnabled = enabled
            }
        return ActionButton(
            action,
            presentation,
            ActionPlaces.TOOLWINDOW_CONTENT,
            JBUI.size(Theme.Size.ICON_BUTTON, Theme.Size.ICON_BUTTON),
        )
    }
}
