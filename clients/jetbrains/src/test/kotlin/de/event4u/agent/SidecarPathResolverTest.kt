package de.event4u.agent

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SidecarPathResolverTest {
    private fun resolve(
        pluginDir: String?,
        projectBasePath: String?,
        present: Set<String>,
    ): String? = SidecarPathResolver.resolve(pluginDir, projectBasePath, present::contains)

    @Test
    fun `prefers the bundled sidecar inside the installed plugin`() {
        val result =
            resolve(
                pluginDir = "/plugins/event4u-agent",
                projectBasePath = "/repo",
                present = setOf("/plugins/event4u-agent/sidecar/server.js", "/repo/packages/core/dist/server.js"),
            )
        assertEquals("/plugins/event4u-agent/sidecar/server.js", result)
    }

    @Test
    fun `falls back to the dev path when no bundled copy exists`() {
        val result =
            resolve(
                pluginDir = "/plugins/event4u-agent",
                projectBasePath = "/repo",
                present = setOf("/repo/packages/core/dist/server.js"),
            )
        assertEquals("/repo/packages/core/dist/server.js", result)
    }

    @Test
    fun `returns null when neither location has the sidecar`() {
        assertNull(resolve("/plugins/event4u-agent", "/repo", emptySet()))
    }

    @Test
    fun `tolerates a null plugin dir (pure dev, no install)`() {
        val result = resolve(null, "/repo", setOf("/repo/packages/core/dist/server.js"))
        assertEquals("/repo/packages/core/dist/server.js", result)
    }

    @Test
    fun `tolerates a null project base (installed, no open project)`() {
        val result = resolve("/plugins/event4u-agent", null, setOf("/plugins/event4u-agent/sidecar/server.js"))
        assertEquals("/plugins/event4u-agent/sidecar/server.js", result)
    }

    @Test
    fun `returns null when both inputs are null`() {
        assertNull(resolve(null, null, setOf("/plugins/event4u-agent/sidecar/server.js")))
    }
}
