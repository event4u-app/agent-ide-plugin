package de.event4u.agent.statusbar

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import de.event4u.agent.chat.CostFooterFormatter
import java.awt.event.MouseEvent

/**
 * T-207 — Statusbar widget showing the active model + USD spent today.
 *
 * Refreshes by calling [refresh] from outside; the sidecar bridge (TBD)
 * pushes a new value on every step event via the host's project service.
 * Click opens a placeholder dialog — the real Cost Dashboard ships in
 * v1.0 Sprint 7.
 */
class AgentStatusBarWidget(
    @Suppress("UnusedPrivateProperty") private val project: Project,
) :
    StatusBarWidget,
        StatusBarWidget.TextPresentation {
    private var statusBar: StatusBar? = null
    private var model: String = "(no model)"
    private var todayUsd: Double = 0.0

    override fun ID(): String = WIDGET_ID

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
    }

    override fun dispose() {
        statusBar = null
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String = CostFooterFormatter.headerCost(model, todayUsd)

    override fun getTooltipText(): String = "event4u Agent — click for cost details"

    @Suppress("UnstableApiUsage")
    override fun getClickConsumer(): Consumer<MouseEvent> =
        Consumer { _: MouseEvent ->
            // Placeholder for the v1.0 Cost Dashboard. The MVP just shows a tooltip.
        }

    override fun getAlignment(): Float = 0.0f

    fun refresh(
        newModel: String,
        newTodayUsd: Double,
    ) {
        model = newModel
        todayUsd = newTodayUsd
        statusBar?.updateWidget(ID())
    }

    companion object {
        const val WIDGET_ID = "event4u-agent.status"
    }
}

class AgentStatusBarWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = AgentStatusBarWidget.WIDGET_ID

    override fun getDisplayName(): String = "event4u Agent cost"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget = AgentStatusBarWidget(project)

    override fun disposeWidget(widget: StatusBarWidget) = widget.dispose()

    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}
