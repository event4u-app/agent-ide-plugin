---
spike: 0.3a — JBCef Theme-Sync
phase: 0 (Validation)
status: research-based-pre-verdict
date: 2026-05-28
runtime_validated: false
provisional_verdict: viable-with-caveats — use JBCef for Cost Dashboard + Settings BUT enforce out-of-process JCEF + Disposer discipline; have a Compose-Multiplatform fallback documented before v1.0
---

# Spike 0.3a — JBCef Theme-Sync

## Pass / fail criteria (from roadmap)

- **Happy-path:** 50 theme switches in PhpStorm 2024.2, webview update <200ms, no FOUC (flash of unstyled content).
- **Failure-mode:** render a 1000-line code block + 50-message chat history, measure memory growth across 20 switches. Fail if memory does not stabilise (linear growth = leak).
- **Pass →** JBCef-webview viable for Cost Dashboard + Settings.
- **Fail →** Cost Dashboard becomes Compose-native (no JBCef in v1.0).

## Research-based pre-verdict

**Viable with caveats — proceed with mitigations.** Three concrete signals from JetBrains' own issue tracker say in-process JCEF has documented memory-stability problems, but JetBrains is actively migrating to out-of-process JCEF as the default. The architecture pattern for sub-200ms theme sync (LafManagerListener → executeJavaScript with CSS variables) is documented and proven in adjacent plugins, even if no public benchmark validates the latency target.

**The pre-verdict locks in three pre-build decisions that the runtime spike must confirm but not invent.**

### Decision 1: Enable out-of-process JCEF

VM flag (default ON since IJPL-162747 work landed, but verify on PhpStorm 2024.2): leave `ide.browser.jcef.out-of-process.enabled` unset (default) or explicitly `true`. The flag *disables* out-of-process when `false`, per the [Refact JetBrains troubleshooting guide](https://docs.refact.ai/guides/plugins/jetbrains/troubleshooting/) and [Snyk troubleshooting docs](https://docs.snyk.io/developer-tools/snyk-ide-plugins-and-extensions/jetbrains-plugin/troubleshooting-for-the-jetbrains-plugin). The migration is tracked in [IJPL-162747](https://youtrack.jetbrains.com/issue/IJPL-162747/Enable-out-of-process-JCEF-by-default) (general) and [IJPL-172674](https://youtrack.jetbrains.com/issue/IJPL-172674/Enable-out-of-process-JCEF-by-default-in-Windows) (Windows). **Caveat:** [IJPL-184288](https://youtrack.jetbrains.com/issue/IJPL-184288) — out-of-process JCEF fails with `Windowed_rendering` mode → we MUST use `setOffScreenRendering(true)` (Continue.dev already does this).

### Decision 2: Disposer-pattern discipline

Every `JBCefBrowser`, `JBCefClient`, `JBCefJSQuery` MUST be registered with the IDE Disposer **and** disposed explicitly on tool-window close. The [IJPL-120558 "Memory leak detected: JCEFHtmlPanel" ticket](https://youtrack.jetbrains.com/issue/IJPL-120558/Memory-leak-detected-com.intellij.ui.jcef.JCEFHtmlPanel) and Continue.dev's `ContinueBrowser.kt:145-148` (`Disposer.dispose(myJSQueryOpenInBrowser); Disposer.dispose(browser)`) confirm the pattern. The VirtusLab "Creating IntelliJ plugin with WebView" article frames it as "a must to avoid 'Memory leak detected' in IntelliJ logs."

### Decision 3: Theme-sync via LafManager + CSS variables (not full re-render)

Pattern (no public benchmark, but architecturally clear): subscribe to `LafManager.TOPIC` on the IDE message bus. In the listener, compute the new theme's color set from `JBColor` / `EditorColorsManager`, marshal as a JSON blob of CSS custom-properties, push to the webview via `browser.getCefBrowser().executeJavaScript("document.documentElement.style.cssText = '...'", "", 0)`. The webview's CSS is authored entirely in `var(--ide-foreground)` etc. — re-rendering 50-message chats is then a browser layout pass, not a webview reload. **No FOUC because no reload.** This pattern fails only if the webview is too slow to apply CSS changes — which is what the runtime spike measures.

## Reproduction script — runtime spike (≤2 days)

Cannot be executed in this autonomous session (requires PhpStorm 2024.2 + plugin sandbox + manual theme switches). The script below is reproducible and ships with the spike.

```kotlin
// agents/analysis/spike-code/0-3a/ThemeSyncSpike.kt
// Drop into a sandbox IntelliJ plugin project, register a tool window
// that calls ThemeSyncSpike.attach(toolWindow.contentManager).

package event4u.spike.themesync

import com.intellij.ide.ui.LafManager
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.JBColor
import com.intellij.ui.content.ContentManager
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefClient
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.browser.CefBrowser
import javax.swing.SwingUtilities

object ThemeSyncSpike {
  fun attach(contentManager: ContentManager) {
    val browser = JBCefBrowser.createBuilder()
      .setOffScreenRendering(true)
      .build()

    // Pool MUST be set before creation in Continue.dev pattern (verify on 2024.2)
    browser.jbCefClient.setProperty(
      JBCefClient.Properties.JS_QUERY_POOL_SIZE,
      200
    )

    // Page: 1000-line "code block" (LOREM-like) + 50 chat messages
    val html = buildHeavyPage()
    browser.loadHTML(html)

    // Telemetry hooks (JS → Kotlin)
    val perfHook = JBCefJSQuery.create(browser as JBCefBrowserBase)
    perfHook.addHandler { payload ->
      // payload is a JSON line: { event: "theme-applied", switchId: N, ms: X }
      System.err.println("[spike 0-3a] $payload")
      null
    }

    // Inject JS that posts switch latency back through perfHook on each transition
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
      "", 0
    )

    // LAF listener — push CSS vars on every IDE theme change
    val conn = ApplicationManager.getApplication().messageBus.connect(browser as Disposable)
    var switchCounter = 0
    conn.subscribe(LafManager.TOPIC, LafManagerListener {
      switchCounter += 1
      val css = computeCssVars()           // reads JBColor / EditorColorsManager
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
    // produce `--ide-fg: #...; --ide-bg: #...;` from current JBColor / EditorColorsManager.
    // expanded in real implementation; placeholder for the spike.
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
```

### Execution protocol

1. **Setup.** Open the spike plugin in IntelliJ Community 2024.2 sandbox. Open the tool window. JCEF webview renders the heavy fixture.
2. **Happy-path.** Switch IDE theme between "Darcula" ↔ "Light" 50 times via `Settings → Appearance & Behavior → Appearance → Theme`. The injected JS logs `{ event, switchId, ms }` to stderr.
   - **Pass:** p95 of `ms` ≤ 200ms across the 50 switches. No visible FOUC (judgment call — flash <50ms is acceptable).
   - **Fail:** any switch >500ms, or visible 200ms+ background flash.
3. **Failure-mode.** Open `Help → Diagnostic Tools → Memory Usage` (or use `jcmd <pid> GC.heap_info`). Record heap-used at switch #0, switch #5, #10, #15, #20.
   - **Pass:** heap-used at switch #20 is within ±10% of switch #5 (allow first-switch warm-up).
   - **Fail:** monotonic growth across switches #5 → #20 with ≥30% delta (linear leak signature).

### Out-of-process verification

Before the spike, confirm out-of-process JCEF is active on PhpStorm 2024.2:

```bash
# In the sandbox IDE: Help → Find Action → "Registry…"
# Search: ide.browser.jcef.out-of-process.enabled
# Expected: true (default since IJPL-162747)
```

If the registry key is `false`, set to `true` and restart. Re-run the spike. **Failure modes diverge sharply between in-process and out-of-process modes** — the spike must run under the mode we will ship in.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| In-process JCEF leaks under heavy chat content | **medium** — IJPL-120558, IJPL-120419, JUNIE-508 are existing tickets | Out-of-process JCEF (Decision 1) |
| Theme switch >200ms with 1000-line code block | medium — no public benchmark, CSS layout pass on 1000 nodes is plausible-fast but unmeasured | If fail: pre-compute CSS variables per theme, swap with a class toggle instead of full `cssText` replace |
| FOUC during full-page reload | low if we never reload (CSS-variable pattern) | Never call `browser.loadURL(...)` on theme switch; only push CSS |
| `JS_QUERY_POOL_SIZE = 200` insufficient for chat throughput | low | Continue.dev runs with 200 and ships; raise to 400 if needed |
| Disposer-discipline drift over time | high without process | CI lint: every `JBCefBrowser` creation must have a paired `Disposer.register` in the same file. Add `scripts/lint_disposer_discipline.sh` once we have source code |

## Compose-Multiplatform fallback (if Spike fails)

Per [JetBrains/jewel](https://github.com/JetBrains/jewel) (archived 2025-04-22, moved to `intellij-community`): **"Writing 3rd party IntelliJ Plugins in Compose for Desktop is currently not officially supported."** This is a hard cost to swallow.

If the runtime spike fails the leak check (failure-mode), the fallback is **Compose-native Cost Dashboard via Jewel + `ToolWindow.addComposeTab()`**, accepting:
- Per-platform-version Jewel artifacts (`jewel-ide-laf-bridge-242` for 2024.2 etc.).
- Conflict with Android Studio's bundled Jewel.
- Exclude Coroutines (IDE ships its own).
- "APIs are still in flux."

ADR-003 (Phase 9 Step 3) captures the default (JBCef) and the fallback.

## Verdict

**Pre-verdict (research-grade):** JBCef is viable for Cost Dashboard + Settings, conditional on Decisions 1-3 above. Runtime spike validates. Without the runtime spike, MVP Sprint 4 starts under "expected to work" rather than "validated" — flag this to the user before Sprint 1.

## Sources

- [Embedded Browser (JCEF) — IntelliJ Platform Plugin SDK](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html)
- [IJPL-120558 — JCEFHtmlPanel memory leak](https://youtrack.jetbrains.com/issue/IJPL-120558/Memory-leak-detected-com.intellij.ui.jcef.JCEFHtmlPanel)
- [IDEA-276435 / IJPL-120419 — jcef_helper.exe leak](https://youtrack.jetbrains.com/issue/IDEA-276435/IntelliJ-is-leaking-jcefhelper.exe-when-editing-markdown-files)
- [IJPL-162747 / IJPL-172674 — out-of-process JCEF default](https://youtrack.jetbrains.com/issue/IJPL-162747/Enable-out-of-process-JCEF-by-default)
- [IJPL-184288 — out-of-process JCEF fails with Windowed rendering](https://youtrack.jetbrains.com/issue/IJPL-184288)
- [JetBrains/jewel — Compose UI for IntelliJ plugins (archived, moved upstream)](https://github.com/JetBrains/jewel)
- Continue.dev `ContinueBrowser.kt` (analysed in Spike 0-1).
