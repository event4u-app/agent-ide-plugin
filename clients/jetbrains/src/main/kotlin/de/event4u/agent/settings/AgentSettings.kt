package de.event4u.agent.settings

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * T-204 — Settings UI v0 (JetBrains). Three fields: provider (Anthropic
 * only in MVP), API-key deep-link, default model. Persisted to the
 * application-level config (so it survives project switches).
 *
 * The API key itself lives in [com.intellij.credentialStore.CredentialAttributes]
 * (OS keychain), accessed via [ApiKeyCredentialAttributes] — this state
 * just records whether the key is set.
 */
@State(name = "event4u-agent.settings", storages = [Storage("event4u-agent.xml")])
@Service(Service.Level.APP)
class AgentSettings : PersistentStateComponent<AgentSettings.State> {
    data class State(
        var provider: String = "anthropic",
        var defaultModel: String = "claude-sonnet-4-6",
        var defaultMode: String = "auto",
    )

    private var stateInternal: State = State()

    override fun getState(): State = stateInternal

    override fun loadState(state: State) {
        XmlSerializerUtil.copyBean(state, stateInternal)
    }

    fun providerNormalized(): String = stateInternal.provider.lowercase().trim()

    fun setDefaultModel(model: String) {
        require(model in KNOWN_MODELS) { "unknown model: $model" }
        stateInternal.defaultModel = model
    }

    fun setDefaultMode(mode: String) {
        require(mode in KNOWN_MODES) { "unknown mode: $mode (must be api/cli/auto)" }
        stateInternal.defaultMode = mode
    }

    companion object {
        val KNOWN_MODELS = setOf("claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5")
        val KNOWN_MODES = setOf("api", "cli", "auto")

        fun instance(): AgentSettings = service()
    }
}
