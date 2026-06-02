package de.event4u.agent.statusbar

import com.intellij.openapi.project.Project
import de.event4u.agent.protocol.RootIndexStatus
import java.util.concurrent.CopyOnWriteArrayList

/**
 * T-1304 / T-PRD07 — project-scoped holder of the latest per-root index status.
 *
 * Deliberately a thin observable state holder, NOT an RPC owner (council
 * 2026-06-02, Q1 synthesis): [WorkspaceFolderService] already owns the sidecar
 * connection + lifecycle and is the SOLE writer ([update]); a single writer
 * keeps the two services from drifting into split state (codex), while the
 * separation keeps polling/RPC out of the widget (gemini SRP).
 *
 * The index-status widget registers via [addListener] and re-renders on change.
 */
class IndexStatusService(
    @Suppress("UnusedPrivateProperty") private val project: Project,
) {
    @Volatile
    var statuses: List<RootIndexStatus> = emptyList()
        private set

    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    /** Replace the snapshot and notify listeners. Called only by WorkspaceFolderService. */
    fun update(next: List<RootIndexStatus>) {
        statuses = next
        for (l in listeners) runCatching { l() }
    }

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    companion object {
        fun getInstance(project: Project) = project.getService(IndexStatusService::class.java)
    }
}
