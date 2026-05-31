package de.event4u.agent

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import java.io.File

/*
 * T-PRD11 — IDE-facing glue for [SidecarPathResolver].
 *
 * Feeds the real installed-plugin directory (`PluginDescriptor.pluginPath`) and
 * the open project's base into the pure resolver, with a filesystem existence
 * probe. Isolated here so the IntelliJ Platform API stays out of the resolver
 * (which the JDK-17 CI gate unit-tests without a running IDE).
 */
object SidecarLocator {
    private const val PLUGIN_ID = "de.event4u.agent"
    private const val DEV_REL = "packages/core/dist/server.js"

    /**
     * Best sidecar path for this host: the plugin-bundled copy when installed,
     * else the monorepo dev path. Never null so callers keep a stable spawn
     * contract — a missing file surfaces as a sidecar start failure, as before.
     */
    fun locate(projectBasePath: String?): String {
        val pluginDir = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))?.pluginPath?.toString()
        return SidecarPathResolver.resolve(pluginDir, projectBasePath) { File(it).exists() }
            ?: "${projectBasePath ?: "."}/$DEV_REL"
    }
}
