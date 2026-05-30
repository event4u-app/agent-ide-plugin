package de.event4u.agent.workspace

import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootManager

/**
 * T-MR10 — enumerate the active project's module content roots.
 *
 * Reads the active [Project]'s modules (never `ProjectManager.getOpenProjects()`,
 * which would leak roots across separate IDE windows). Content roots only: SDK
 * and library roots are not content roots, so they are excluded by construction.
 * Duplicate URLs across modules collapse to one entry (insertion-ordered).
 */
object ModuleRootEnumerator {
    fun enumerate(project: Project): List<RootInfo> {
        val byUrl = LinkedHashMap<String, RootInfo>()
        for (module in ModuleManager.getInstance(project).modules) {
            for (contentRoot in ModuleRootManager.getInstance(module).contentRoots) {
                val url = contentRoot.url
                byUrl.putIfAbsent(url, WorkspaceFolderMapper.rootInfo(url, module.name))
            }
        }
        return byUrl.values.toList()
    }
}
