package de.event4u.agent.ui

import de.event4u.agent.chat.ConversationMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The mode pill's pure-state contract is the click cycle + status colour.
 * Visual painting is exercised by the host smoke run (MANUAL_VERIFICATION).
 */
class ModePillTest {
    @Test
    fun `initial mode reflects constructor argument`() {
        val pill = ModePill(initialMode = ConversationMode.CLI)
        assertEquals(ConversationMode.CLI, pill.mode)
    }

    @Test
    fun `status defaults to READY`() {
        val pill = ModePill()
        assertEquals(ModePill.PillStatus.READY, pill.status)
    }

    @Test
    fun `status setter updates the field`() {
        val pill = ModePill()
        pill.status = ModePill.PillStatus.STREAMING
        assertEquals(ModePill.PillStatus.STREAMING, pill.status)
    }

    @Test
    fun `mode setter rebuilds label text`() {
        val pill = ModePill(initialMode = ConversationMode.API)
        pill.mode = ConversationMode.CLI
        assertTrue(pill.text.contains("CLI"))
    }
}
