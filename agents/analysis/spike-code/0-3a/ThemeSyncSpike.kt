// Spike 0-3a — JBCef theme-sync reproduction. Drop into a sandbox IntelliJ plugin
// project, register a tool window that calls ThemeSyncSpike.attach(contentManager).
//
// Execution protocol lives in agents/analysis/spike-reports/spike-0-3a-jbcef.md.

package event4u.spike.themesync

import com.intellij.ide.ui.LafManager
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.JBColor
import com.intellij.ui.content.ContentManager
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefClient
import com.intellij.ui.jcef.JBCefJSQuery

object ThemeSyncSpike {
    fun attach(contentManager: ContentManager) {
        val browser = JBCefBrowser.createBuilder()
            .setOffScreenRendering(true)
            .build()

        browser.jbCefClient.setProperty(
            JBCefClient.Properties.JS_QUERY_POOL_SIZE,
            200,
        )

        browser.loadHTML(buildHeavyPage())

        val perfHook = JBCefJSQuery.create(browser as JBCefBrowserBase)
        perfHook.addHandler { payload ->
            System.err.println("[spike 0-3a] $payload")
            null
        }

        browser.cefBrowser.executeJavaScript(
            """
            window.__spike = {
                markStart: (id) => { window.__spike.t0 = performance.now(); window.__spike.id = id; },
                markEnd:   () => {
                    const ms = performance.now() - window.__spike.t0;
                    ${perfHook.inject("JSON.stringify({event:'theme-applied', switchId: window.__spike.id, ms})")}
                }
            };
            """.trimIndent(),
            "",
            0,
        )

        val conn = ApplicationManager.getApplication().messageBus.connect(browser as Disposable)
        var switchCounter = 0
        conn.subscribe(LafManager.TOPIC, LafManagerListener {
            switchCounter += 1
            val css = computeCssVars()
            val js = """
                window.__spike.markStart($switchCounter);
                document.documentElement.style.cssText = ${escape(css)};
                requestAnimationFrame(() => window.__spike.markEnd());
            """.trimIndent()
            browser.cefBrowser.executeJavaScript(js, "", 0)
        })

        Disposer.register(contentManager) {
            Disposer.dispose(perfHook)
            Disposer.dispose(browser)
        }
    }

    private fun computeCssVars(): String =
        "'--ide-fg:${rgb(JBColor.foreground())};--ide-bg:${rgb(JBColor.background())};'"

    private fun rgb(c: java.awt.Color) = "rgb(${c.red},${c.green},${c.blue})"
    private fun escape(s: String) = s.replace("'", "\\'")

    private fun buildHeavyPage(): String {
        val chat = (1..50).joinToString("\n") {
            "<div class='msg'>Message $it — lorem ipsum dolor sit amet…</div>"
        }
        val code = (1..1000).joinToString("\n") {
            "<div class='line'>line_$it: const value = compute($it);</div>"
        }
        return """
        <!doctype html>
        <html><head><style>
          body { color: var(--ide-fg); background: var(--ide-bg); font-family: monospace; }
          .msg, .line { padding: 2px 6px; }
        </style></head>
        <body><h1>Spike 0-3a fixture</h1>$chat<pre>$code</pre></body></html>
        """.trimIndent()
    }
}
