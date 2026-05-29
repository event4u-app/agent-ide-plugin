package de.event4u.agent.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.wm.ToolWindowManager

/**
 * T-306 — "Ask event4u about Selection" editor action. Sends the selected
 * text + workspace-relative path + 1-based line range to the chat surface.
 *
 * The actual chat-turn dispatch lives on the project service that owns the
 * sidecar client (TBD). This action collects the editor context and forwards
 * it via [SelectionDispatcher] — keeping the action itself testable with a
 * stub dispatcher.
 */
class AskAboutSelectionAction(
    private val dispatcher: SelectionDispatcher = SelectionDispatcher.openChat(),
) : AnAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled =
            e.getData(CommonDataKeys.EDITOR)?.selectionModel?.hasSelection() == true
    }

    @Suppress("ReturnCount")
    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val text = editor.selectionModel.selectedText ?: return
        val project = e.project ?: return
        val document = editor.document
        val file = FileDocumentManager.getInstance().getFile(document) ?: return
        val startOffset = editor.selectionModel.selectionStart
        val endOffset = editor.selectionModel.selectionEnd
        val context =
            SelectionContext(
                path = relativePath(project.basePath, file.path),
                text = text,
                startLine = document.getLineNumber(startOffset) + 1,
                endLine = document.getLineNumber(endOffset) + 1,
                language = file.fileType.defaultExtension.ifEmpty { null },
            )
        dispatcher.dispatch(context)
        ToolWindowManager.getInstance(project).getToolWindow("event4u-agent")?.activate(null)
    }

    @Suppress("ReturnCount")
    private fun relativePath(
        basePath: String?,
        absolute: String,
    ): String {
        if (basePath == null) return absolute
        val normalized = absolute.replace('\\', '/')
        val baseNormalized = basePath.replace('\\', '/').trimEnd('/')
        return if (normalized.startsWith("$baseNormalized/")) {
            normalized.removePrefix("$baseNormalized/")
        } else {
            normalized
        }
    }
}

/**
 * Selection payload mirroring the sidecar's `SelectionContext` schema.
 */
data class SelectionContext(
    val path: String,
    val text: String,
    val startLine: Int,
    val endLine: Int,
    val language: String?,
)

/**
 * Single dispatch seam — action collects context, dispatcher forwards it to
 * the chat surface. The real implementation lives in the project service;
 * `openChat()` is a placeholder that logs to stdout so unit tests can swap
 * it for a recording stub.
 */
fun interface SelectionDispatcher {
    fun dispatch(context: SelectionContext)

    companion object {
        fun openChat(): SelectionDispatcher =
            SelectionDispatcher { ctx ->
                // Real wiring lands when the project service exposes a hook —
                // this fallback keeps the action shippable without that service.
                @Suppress("ForbiddenComment")
                // TODO: route through ChatController.queueSelection(ctx) when the
                // project service lands.
                System.err.println(
                    "event4u-agent: ${ctx.path}:${ctx.startLine}-${ctx.endLine} (${ctx.text.length} chars)",
                )
            }
    }
}
