package de.event4u.agent.chat

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.JBUI
import de.event4u.agent.ui.ThemeCssExporter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.awt.BorderLayout
import javax.swing.SwingConstants

/**
 * JCEF chat surface (road-to-jcef-chat-parity Phase 2). Hosts the SAME
 * webview bundle the VS Code extension renders — `webview/chat.html`, built
 * by clients/vscode/scripts/build-jcef-html.mjs — inside a [JBCefBrowser],
 * so both IDEs are pixel-identical.
 *
 * Wiring (council forks 2A + 3A):
 *  - The HTML ships with two placeholders. `<!--%E4U_BRIDGE%-->` becomes the
 *    [JBCefJSQuery] hook (`window.__e4uJcefPost`) injected BEFORE the bundle
 *    script, and the `%E4U_THEME%` CSS comment becomes the IDE-theme variable
 *    block from [ThemeCssExporter].
 *  - Outbound (webview → host): the bundle's `HostBridge` posts JSON through
 *    `__e4uJcefPost`; [handleOutbound] maps the kinds onto [ChatController].
 *  - Inbound (host → webview): controller snapshots serialize via
 *    [SnapshotJson] and run `window.__e4uHostMessage(json)` through
 *    `executeJavaScript`. Pushes queue until the webview reports `ready`.
 *  - IDE theme switches re-inject the variable block live (no reload).
 *
 * Degrades to a notice panel when JCEF is unavailable (remote dev, custom
 * JBR) or when the resource is missing (Gradle `check` runs without the Node
 * build — council fork 4A retired the Swing renderer).
 */
class JcefChatPanel(
    private val controller: ChatController,
) : JBPanel<JcefChatPanel>(BorderLayout()), Disposable {
    private val json = Json { ignoreUnknownKeys = true }
    private var browser: JBCefBrowser? = null

    @Volatile private var webviewReady = false

    @Volatile private var pendingSnapshot: ChatModelSnapshot? = null

    init {
        border = JBUI.Borders.empty()
        val html = loadChatHtml()
        when {
            !JBCefApp.isSupported() ->
                add(notice("The event4u Agent chat requires JCEF, which this IDE runtime does not provide."))

            html == null ->
                add(notice("Chat UI bundle missing — run `task build` to generate webview/chat.html."))

            else -> mountBrowser(html)
        }
    }

    private fun mountBrowser(html: String) {
        val cefBrowser = JBCefBrowser()
        browser = cefBrowser
        Disposer.register(this, cefBrowser)
        val query = JBCefJSQuery.create(cefBrowser as JBCefBrowserBase)
        Disposer.register(this, query)
        query.addHandler { payload ->
            handleOutbound(payload)
            null
        }
        val bridgeScript =
            "<script>window.__e4uJcefPost = function(json) { ${query.inject("json")} };</script>"
        cefBrowser.loadHTML(
            html
                .replace("<!--%E4U_BRIDGE%-->", bridgeScript)
                .replace("/*%E4U_THEME%*/", ThemeCssExporter.current()),
        )
        add(cefBrowser.component, BorderLayout.CENTER)
        controller.onModelChange = ::pushSnapshot
        subscribeToThemeChanges()
    }

    /** Map one webview Outbound message onto the controller. */
    private fun handleOutbound(payload: String) {
        val message = runCatching { json.parseToJsonElement(payload).jsonObject }.getOrNull() ?: return
        when (message.string("kind")) {
            "ready" -> {
                webviewReady = true
                pushSnapshot(pendingSnapshot ?: controller.snapshot())
            }

            "send" -> message.string("text")?.let { controller.send(it) }
            "stop" -> controller.requestStop()
            "toggle-mode" -> {
                val next =
                    if (controller.currentMode() == ConversationMode.API) {
                        ConversationMode.CLI
                    } else {
                        ConversationMode.API
                    }
                controller.setMode(next)
            }

            // pick-model / attach / attach-files / open-command / open-mention /
            // halt-answer: not handled by the host yet — parity with the VS Code
            // ChatController, which routes the same subset (see chat-controller.ts).
            else -> Unit
        }
    }

    /** Serialize + push a snapshot; queue while the webview is still booting. */
    private fun pushSnapshot(snapshot: ChatModelSnapshot) {
        pendingSnapshot = snapshot
        if (!webviewReady) return
        val cefBrowser = browser ?: return
        val literal = SnapshotJson.asJsStringLiteral(SnapshotJson.snapshotPayload(snapshot))
        cefBrowser.cefBrowser.executeJavaScript(
            "window.__e4uHostMessage($literal);",
            cefBrowser.cefBrowser.url,
            0,
        )
    }

    /** Live IDE theme switch → re-inject the variable block, no reload. */
    private fun subscribeToThemeChanges() {
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(
            LafManagerListener.TOPIC,
            LafManagerListener {
                val cefBrowser = browser ?: return@LafManagerListener
                val cssLiteral = SnapshotJson.asJsStringLiteral(ThemeCssExporter.current())
                cefBrowser.cefBrowser.executeJavaScript(
                    "var s = document.getElementById('e4u-jb-theme'); if (s) { s.textContent = $cssLiteral; }",
                    cefBrowser.cefBrowser.url,
                    0,
                )
            },
        )
    }

    private fun notice(text: String): JBLabel {
        return JBLabel(text, SwingConstants.CENTER).apply { border = JBUI.Borders.empty(NOTICE_PADDING) }
    }

    override fun dispose() {
        controller.onModelChange = {}
        browser = null
    }

    private fun loadChatHtml(): String? {
        return javaClass.getResourceAsStream(CHAT_HTML_RESOURCE)?.use { it.readBytes().decodeToString() }
    }

    private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.content

    private companion object {
        const val CHAT_HTML_RESOURCE = "/webview/chat.html"
        const val NOTICE_PADDING = 24
    }
}
