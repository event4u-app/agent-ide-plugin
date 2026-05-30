package de.event4u.agent.workspace

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * T-MR10 — pure mapping + diff for the JetBrains workspace-folder sync.
 *
 * Kept free of any IntelliJ Platform API so it is unit-testable on the JDK-17
 * CI gate without a running IDE. The IDE-facing glue (module enumeration,
 * `ModuleRootListener`) lives in [ModuleRootEnumerator] / [WorkspaceFolderService]
 * and delegates the payload shaping here.
 *
 * A root's content-root URL is both its `uri` and its `stableId` — stable
 * across relocation and the same identity the Core dedups on.
 */

/** A module content root, mapped to the protocol's WorkspaceFolder shape. */
data class RootInfo(
    val uri: String,
    val stableId: String,
    val displayName: String,
    val kind: String,
)

/** Added roots + removed stableIds between two enumerations. */
data class RootDelta(
    val added: List<RootInfo>,
    val removed: List<String>,
)

object WorkspaceFolderMapper {
    /** Build a [RootInfo] from a content-root URL + module name. */
    fun rootInfo(
        url: String,
        moduleName: String,
    ): RootInfo = RootInfo(uri = url, stableId = url, displayName = moduleName, kind = "module")

    /** `connect` payload: `{ workspaceFolders: [...] }`. */
    fun connectPayload(roots: List<RootInfo>): JsonObject =
        buildJsonObject {
            put(
                "workspaceFolders",
                buildJsonArray { roots.forEach { add(folderJson(it)) } },
            )
        }

    /** `workspaceFoldersChanged` payload: `{ added: [...], removed: [ids] }`. */
    fun changePayload(delta: RootDelta): JsonObject =
        buildJsonObject {
            put(
                "added",
                buildJsonArray { delta.added.forEach { add(folderJson(it)) } },
            )
            put(
                "removed",
                buildJsonArray { delta.removed.forEach { add(JsonPrimitive(it)) } },
            )
        }

    /** Diff a previous enumeration against the current one (keyed by stableId). */
    fun diff(
        previous: List<RootInfo>,
        current: List<RootInfo>,
    ): RootDelta {
        val previousIds = previous.map { it.stableId }.toSet()
        val currentIds = current.map { it.stableId }.toSet()
        val added = current.filter { it.stableId !in previousIds }
        val removed = previous.map { it.stableId }.filter { it !in currentIds }
        return RootDelta(added = added, removed = removed)
    }

    private fun folderJson(root: RootInfo): JsonObject =
        buildJsonObject {
            put("uri", JsonPrimitive(root.uri))
            put("stableId", JsonPrimitive(root.stableId))
            put("displayName", JsonPrimitive(root.displayName))
            put("kind", JsonPrimitive(root.kind))
        }
}
