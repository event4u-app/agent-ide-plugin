package de.event4u.agent.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.awt.Color

/**
 * Drives the pure CSS builder with a fixed palette — the variable set must
 * stay in lockstep with what clients/vscode/src/webview/theme.ts consumes.
 */
class ThemeCssExporterTest {
    private val palette =
        ThemeCssExporter.Palette(
            surface = Color(0x2B, 0x2D, 0x30),
            surfaceInset = Color(0x1E, 0x1F, 0x22),
            text = Color(0xDF, 0xE1, 0xE5),
            mutedText = Color(0x86, 0x8A, 0x91),
            border = Color(0x39, 0x3B, 0x40),
            accent = Color(0x35, 0x74, 0xF0),
            accentForeground = Color.WHITE,
            inputBackground = Color(0x1E, 0x1F, 0x22),
            inputForeground = Color(0xDF, 0xE1, 0xE5),
            inactiveSelection = Color(0x2E, 0x43, 0x6E),
            warningBorder = Color(0xE0, 0xA4, 0x4F),
            codeBlockBackground = Color(0x1A, 0x1B, 0x1E),
            dark = true,
            fontFamily = "Inter",
            fontSizePx = 13,
        )

    @Test
    fun `emits every variable the webview theme consumes`() {
        val css = ThemeCssExporter.css(palette)
        val required =
            listOf(
                "--vscode-color-scheme: dark;",
                "--vscode-font-family: 'Inter', sans-serif;",
                "--vscode-sideBar-background: #2b2d30;",
                "--vscode-editor-background: #2b2d30;",
                "--vscode-editorWidget-background: #1e1f22;",
                "--vscode-input-background: #1e1f22;",
                "--vscode-input-foreground: #dfe1e5;",
                "--vscode-input-border: #393b40;",
                "--vscode-foreground: #dfe1e5;",
                "--vscode-descriptionForeground: #868a91;",
                "--vscode-panel-border: #393b40;",
                "--vscode-button-background: #3574f0;",
                "--vscode-button-foreground: #ffffff;",
                "--vscode-editor-inactiveSelectionBackground: #2e436e;",
                "--vscode-inputValidation-warningBorder: #e0a44f;",
                "--vscode-textCodeBlock-background: #1a1b1e;",
                "--vscode-charts-green:",
                "--vscode-charts-blue:",
                "--vscode-charts-red:",
            )
        for (variable in required) {
            assertTrue(variable in css, "missing `$variable` in: $css")
        }
    }

    @Test
    fun `light palettes flip the color scheme`() {
        val css = ThemeCssExporter.css(palette.copy(dark = false))
        assertTrue("--vscode-color-scheme: light;" in css, css)
    }

    @Test
    fun `body font size rides along as a px rule`() {
        val css = ThemeCssExporter.css(palette)
        assertTrue("body { font-size: 13px; }" in css, css)
    }

    @Test
    fun `css is a single root block plus body rule`() {
        val css = ThemeCssExporter.css(palette)
        assertEquals(true, css.startsWith(":root {"), css)
        assertEquals(1, Regex(":root \\{").findAll(css).count())
    }
}
