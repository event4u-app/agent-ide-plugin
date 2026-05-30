package de.event4u.agent.workspace

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

/**
 * T-MR10 — kick the [WorkspaceFolderService] on project open so the IDE's open
 * roots reach the Core with no user action (registered as a post-startup
 * activity in `plugin.xml`).
 */
class WorkspaceFolderStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        WorkspaceFolderService.getInstance(project).start()
    }
}
