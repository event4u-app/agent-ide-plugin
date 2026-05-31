package de.event4u.agent.workspace

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootEvent
import com.intellij.openapi.roots.ModuleRootListener
import de.event4u.agent.SidecarClient
import de.event4u.agent.SidecarLocator
import kotlinx.serialization.json.JsonObject

/**
 * T-MR10 — owns the project's workspace-folder sync with the Core.
 *
 * On [start]: enumerate the module content roots, open a dedicated sidecar
 * connection, send `connect`, and subscribe to root changes. Each
 * [ModuleRootListener] event re-enumerates, diffs against the last view, and
 * pushes a `workspaceFoldersChanged` delta. Project-scoped + [Disposable] so
 * the sidecar and the message-bus subscription tear down when the project
 * closes — `connect` over a [project.messageBus] connection parented to `this`.
 *
 * The dedicated sidecar is intentional for Phase B: it proves the client-side
 * enumeration reaches a Core with no user action. Consolidating this with the
 * chat's sidecar is host-integration work (road-to-mvp-ui-finish).
 */
class WorkspaceFolderService(private val project: Project) : Disposable {
    private var sidecar: SidecarClient? = null
    private var lastRoots: List<RootInfo> = emptyList()
    private var started = false

    @Synchronized
    fun start() {
        if (started) return
        started = true

        val client = SidecarClient(resolveSidecarPath())
        sidecar = client
        runCatching { client.start() }

        lastRoots = ModuleRootEnumerator.enumerate(project)
        sendAsync("connect", WorkspaceFolderMapper.connectPayload(lastRoots))

        project.messageBus
            .connect(this)
            .subscribe(
                ModuleRootListener.TOPIC,
                object : ModuleRootListener {
                    override fun rootsChanged(event: ModuleRootEvent) = resync()
                },
            )
    }

    @Synchronized
    private fun resync() {
        val current = ModuleRootEnumerator.enumerate(project)
        val delta = WorkspaceFolderMapper.diff(lastRoots, current)
        lastRoots = current
        if (delta.added.isEmpty() && delta.removed.isEmpty()) return
        sendAsync("workspaceFoldersChanged", WorkspaceFolderMapper.changePayload(delta))
    }

    private fun sendAsync(
        messageType: String,
        payload: JsonObject,
    ) {
        val client = sidecar ?: return
        Thread {
            runCatching { client.request(messageType, payload) }
        }.apply {
            isDaemon = true
            start()
        }
    }

    override fun dispose() {
        sidecar?.dispose()
        sidecar = null
    }

    private fun resolveSidecarPath(): String = SidecarLocator.locate(project.basePath)

    companion object {
        fun getInstance(project: Project) = project.getService(WorkspaceFolderService::class.java)
    }
}
