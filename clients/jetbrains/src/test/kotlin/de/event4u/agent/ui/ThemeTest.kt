package de.event4u.agent.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The token surface is just constants — guard the documented design-contract
 * values so a future "tweak this to look like Augment" change can't silently
 * shift away from the spec.
 */
class ThemeTest {
    @Test
    fun `spacing scale uses the documented px values`() {
        assertEquals(2, Theme.Space.XXS)
        assertEquals(4, Theme.Space.XS)
        assertEquals(8, Theme.Space.SM)
        assertEquals(12, Theme.Space.MD)
        assertEquals(16, Theme.Space.LG)
        assertEquals(24, Theme.Space.XL)
    }

    @Test
    fun `radius scale matches the design contract`() {
        assertEquals(12, Theme.Radius.CHIP)
        assertEquals(8, Theme.Radius.CARD)
        assertEquals(6, Theme.Radius.BUTTON)
    }

    @Test
    fun `header height + pill height + icon button hit area pinned`() {
        assertEquals(36, Theme.Size.HEADER_HEIGHT)
        assertEquals(24, Theme.Size.PILL_HEIGHT)
        assertEquals(28, Theme.Size.ICON_BUTTON)
        assertEquals(6, Theme.Size.STATUS_DOT)
    }

    @Test
    fun `status colours are non-null`() {
        assertTrue(Theme.Colors.STATUS_READY.red >= 0)
        assertTrue(Theme.Colors.STATUS_STREAMING.green > Theme.Colors.STATUS_STREAMING.red)
        assertTrue(Theme.Colors.STATUS_ERROR.red > Theme.Colors.STATUS_ERROR.green)
    }
}
