package de.event4u.agent.workspace

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootEvent
import com.intellij.openapi.roots.ModuleRootListener
import de.event4u.agent.SidecarClient
import de.event4u.agent.SidecarLocator
import de.event4u.agent.protocol.Envelope
import de.event4u.agent.protocol.RootIndexStatus
import de.event4u.agent.statusbar.IndexStatusService
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import java.util.concurrent.atomic.AtomicBoolean

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
 *
 * T-1304 / T-PRD07 — index-status feed. The `connect` / `workspaceFoldersChanged`
 * replies already carry `RootIndexStatus[]` (previously discarded); this service
 * now captures them into [IndexStatusService] and, while any root is `indexing`,
 * polls `rootStatus` on its OWN already-open sidecar (no new connection, no extra
 * lock) until every root settles — the documented "the UI polls" model (T-MR11).
 */
class WorkspaceFolderService(private val project: Project) : Disposable {
    private val json = Json { ignoreUnknownKeys = true }
    private var sidecar: SidecarClient? = null
    private var lastRoots: List<RootInfo> = emptyList()
    private var started = false
    private val polling = AtomicBoolean(false)

    @Synchronized
    fun start() {
        if (started) return
        started = true

        val client = SidecarClient(resolveSidecarPath(), workingDir = project.basePath)
        sidecar = client
        runCatching { client.start() }

        lastRoots = ModuleRootEnumerator.enumerate(project)
        sendAndCapture("connect", WorkspaceFolderMapper.connectPayload(lastRoots))

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
        sendAndCapture("workspaceFoldersChanged", WorkspaceFolderMapper.changePayload(delta))
    }

    /** Fire a request off the EDT and feed its `RootIndexStatus[]` reply to the widget. */
    private fun sendAndCapture(
        messageType: String,
        payload: JsonObject,
    ) {
        val client = sidecar ?: return
        Thread {
            applyStatus(runCatching { client.request(messageType, payload) }.getOrNull())
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun applyStatus(env: Envelope?) {
        val status = parseStatus(env) ?: return
        IndexStatusService.getInstance(project).update(status)
        if (status.any { it.state == "indexing" }) startPollingIfNeeded()
    }

    /** One background poll loop while any root is `indexing`; stops when settled or disposed. */
    private fun startPollingIfNeeded() {
        if (!polling.compareAndSet(false, true)) return
        Thread {
            try {
                var active = true
                while (active && polling.get()) {
                    Thread.sleep(POLL_INTERVAL_MS)
                    val client = sidecar
                    if (client == null) {
                        active = false
                    } else {
                        val status =
                            parseStatus(runCatching { client.request("rootStatus", EMPTY_PAYLOAD) }.getOrNull())
                        if (status != null) {
                            IndexStatusService.getInstance(project).update(status)
                            active = status.any { it.state == "indexing" }
                        }
                    }
                }
            } catch (_: InterruptedException) {
                // disposed mid-sleep — fall through to clear the flag.
            } finally {
                polling.set(false)
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun parseStatus(env: Envelope?): List<RootIndexStatus>? {
        val statusEl = (env?.data as? JsonObject)?.get("status") ?: return null
        return runCatching { json.decodeFromJsonElement<List<RootIndexStatus>>(statusEl) }.getOrNull()
    }

    override fun dispose() {
        polling.set(false)
        sidecar?.dispose()
        sidecar = null
    }

    private fun resolveSidecarPath(): String = SidecarLocator.locate(project.basePath)

    companion object {
        private const val POLL_INTERVAL_MS = 1500L
        private val EMPTY_PAYLOAD: JsonObject = buildJsonObject {}

        fun getInstance(project: Project) = project.getService(WorkspaceFolderService::class.java)
    }
}
