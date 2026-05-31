package de.event4u.agent

/*
 * T-PRD11 — resolve the Agent Core sidecar `server.js` for a packaged plugin.
 *
 * An installed plugin ships the sidecar inside its own directory
 * (`<pluginPath>/sidecar/server.js`, placed there by the `prepareSandbox`
 * Gradle copy) so it runs with NO repo checkout. When that bundled copy is
 * absent — running the Core straight from the monorepo during development — it
 * falls back to the dev path under the open project's base.
 *
 * Kept free of any IntelliJ Platform API so it is unit-testable on the JDK-17
 * CI gate without a running IDE: the caller injects the plugin dir, the project
 * base, and the existence probe. AI council 2026-05-31, UNANIMOUS Fork 3A
 * (bundle into the ZIP + a pure resolver, no classpath extraction); ADR-017.
 */
object SidecarPathResolver {
    private const val SIDECAR_REL = "sidecar/server.js"
    private const val DEV_REL = "packages/core/dist/server.js"

    /**
     * @param pluginDir installed-plugin root (`PluginDescriptor.pluginPath`), or null
     * @param projectBasePath open project's base path (dev fallback), or null
     * @param exists existence probe over an absolute path (injected for tests)
     * @return the first path that exists (bundled before dev), or null when neither does
     */
    fun resolve(
        pluginDir: String?,
        projectBasePath: String?,
        exists: (String) -> Boolean,
    ): String? {
        val bundled = pluginDir?.let { "$it/$SIDECAR_REL" }
        val dev = projectBasePath?.let { "$it/$DEV_REL" }
        return when {
            bundled != null && exists(bundled) -> bundled
            dev != null && exists(dev) -> dev
            else -> null
        }
    }
}
