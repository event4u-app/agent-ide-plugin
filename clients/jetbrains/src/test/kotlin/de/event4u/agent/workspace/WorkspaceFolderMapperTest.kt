package de.event4u.agent.workspace

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WorkspaceFolderMapperTest {
    private fun root(
        url: String,
        name: String,
    ): RootInfo = WorkspaceFolderMapper.rootInfo(url, name)

    @Test
    fun `rootInfo uses the content-root url as uri and stableId, kind module`() {
        val info = WorkspaceFolderMapper.rootInfo("file:///repo/api", "api")
        assertEquals("file:///repo/api", info.uri)
        assertEquals("file:///repo/api", info.stableId)
        assertEquals("api", info.displayName)
        assertEquals("module", info.kind)
    }

    @Test
    fun `connect payload carries one folder per root`() {
        val payload =
            WorkspaceFolderMapper.connectPayload(
                listOf(root("file:///repo/web", "web"), root("file:///repo/api", "api")),
            )
        val folders = payload["workspaceFolders"] as JsonArray
        assertEquals(2, folders.size)
        val first = folders[0] as JsonObject
        assertEquals("web", (first["displayName"] as JsonPrimitive).content)
        assertEquals("module", (first["kind"] as JsonPrimitive).content)
    }

    @Test
    fun `change payload carries added folders and removed ids`() {
        val payload =
            WorkspaceFolderMapper.changePayload(
                RootDelta(added = listOf(root("file:///repo/new", "new")), removed = listOf("file:///repo/old")),
            )
        assertEquals(1, (payload["added"] as JsonArray).size)
        val removed = payload["removed"] as JsonArray
        assertEquals("file:///repo/old", (removed[0] as JsonPrimitive).content)
    }

    @Test
    fun `diff reports added and removed by stableId`() {
        val previous = listOf(root("file:///a", "a"), root("file:///b", "b"))
        val current = listOf(root("file:///b", "b"), root("file:///c", "c"))
        val delta = WorkspaceFolderMapper.diff(previous, current)
        assertEquals(listOf("file:///c"), delta.added.map { it.stableId })
        assertEquals(listOf("file:///a"), delta.removed)
    }

    @Test
    fun `diff is empty when the enumeration is unchanged`() {
        val roots = listOf(root("file:///a", "a"))
        val delta = WorkspaceFolderMapper.diff(roots, roots)
        assertTrue(delta.added.isEmpty())
        assertTrue(delta.removed.isEmpty())
    }
}
