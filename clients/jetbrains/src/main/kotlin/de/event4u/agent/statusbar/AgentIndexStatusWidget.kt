package de.event4u.agent.statusbar

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import java.awt.event.MouseEvent

/**
 * T-1304 / T-PRD07 — statusbar widget showing the workspace index status
 * ("Indexing N/M files…" / "Index ready · N files"), a sibling of the cost
 * widget ([AgentStatusBarWidget]).
 *
 * Reads the snapshot from [IndexStatusService] (the sole writer is
 * [WorkspaceFolderService], which captures the connect/`workspaceFoldersChanged`
 * responses and polls `rootStatus` while indexing). Registers as a listener so
 * a status push re-renders the widget on the EDT. The widget is display-only —
 * it updates itself from the connect/change responses + the background poll
 * while indexing; no click action (reindex RPC deferred, council Q3=A).
 */
class AgentIndexStatusWidget(private val project: Project) :
    StatusBarWidget,
    StatusBarWidget.TextPresentation {
    private var statusBar: StatusBar? = null
    private val service = IndexStatusService.getInstance(project)
    private val listener: () -> Unit = { refresh() }

    override fun ID(): String = WIDGET_ID

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
        service.addListener(listener)
        refresh()
    }

    override fun dispose() {
        service.removeListener(listener)
        statusBar = null
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String = IndexStatusFormatter.present(service.statuses).text

    override fun getTooltipText(): String = IndexStatusFormatter.present(service.statuses).tooltip

    override fun getClickConsumer(): Consumer<MouseEvent>? = null

    override fun getAlignment(): Float = 0.0f

    /** Re-render on the EDT — status pushes arrive from a background poll thread. */
    private fun refresh() {
        ApplicationManager.getApplication().invokeLater { statusBar?.updateWidget(ID()) }
    }

    companion object {
        const val WIDGET_ID = "event4u-agent.index-status"
    }
}

class AgentIndexStatusWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = AgentIndexStatusWidget.WIDGET_ID

    override fun getDisplayName(): String = "event4u Agent index status"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget = AgentIndexStatusWidget(project)

    override fun disposeWidget(widget: StatusBarWidget) = widget.dispose()

    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}
