package de.event4u.agent.settings

import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.FormBuilder
import javax.swing.JComboBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

/**
 * Settings panel rendered under Preferences › Tools › event4u Agent.
 * The API-key field deep-links to the OS keychain page; the actual key
 * is read by the sidecar through the env var the host sets at spawn
 * time (see packages/core/src/secrets/keychain.ts).
 */
class AgentConfigurable : Configurable {
    private val modelCombo = JComboBox(AgentSettings.KNOWN_MODELS.toTypedArray())
    private val modeCombo = JComboBox(AgentSettings.KNOWN_MODES.toTypedArray())
    private val keyLink =
        JLabel(
            "<html><a href='#'>Open OS keychain settings</a> to set <code>ANTHROPIC_API_KEY</code></html>",
        )
    private var panel: JPanel? = null

    override fun getDisplayName(): String = "event4u Agent"

    override fun createComponent(): JComponent {
        val settings = AgentSettings.instance().state
        modelCombo.selectedItem = settings.defaultModel
        modeCombo.selectedItem = settings.defaultMode
        val form =
            FormBuilder.createFormBuilder()
                .addLabeledComponent(JBLabel("Provider:"), JBLabel("Anthropic (only in MVP)"))
                .addLabeledComponent(JBLabel("Default model:"), modelCombo)
                .addLabeledComponent(JBLabel("Default mode:"), modeCombo)
                .addLabeledComponent(JBLabel("API key:"), keyLink)
                .addComponentFillVertically(JBPanel<JBPanel<*>>(), 0)
                .panel
        panel = form
        return form
    }

    override fun isModified(): Boolean {
        val s = AgentSettings.instance().state
        return modelCombo.selectedItem != s.defaultModel || modeCombo.selectedItem != s.defaultMode
    }

    override fun apply() {
        val settings = AgentSettings.instance()
        settings.setDefaultModel(modelCombo.selectedItem as String)
        settings.setDefaultMode(modeCombo.selectedItem as String)
    }

    override fun reset() {
        val s = AgentSettings.instance().state
        modelCombo.selectedItem = s.defaultModel
        modeCombo.selectedItem = s.defaultMode
    }

    override fun disposeUIResources() {
        panel = null
    }
}
