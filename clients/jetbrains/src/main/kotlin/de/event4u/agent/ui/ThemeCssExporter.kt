package de.event4u.agent.ui

import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import java.awt.Color

/**
 * Maps the active IDE Look-and-Feel onto the `--vscode-*` CSS custom
 * properties the shared chat webview consumes (road-to-jcef-chat-parity
 * Phase 3). The variable set is exactly what
 * clients/vscode/src/webview/theme.ts reads — keep the two in lockstep.
 *
 * Split into a pure builder ([css]) that unit tests can drive with fixed
 * colors, and a LaF-reading entry point ([current]) that resolves everything
 * through [Theme] so the mapping stays consistent with the rest of the
 * plugin's chrome.
 */
object ThemeCssExporter {
    /** Snapshot of every color/font the webview's variable set needs. */
    data class Palette(
        val surface: Color,
        val surfaceInset: Color,
        val text: Color,
        val mutedText: Color,
        val border: Color,
        val accent: Color,
        val accentForeground: Color,
        val inputBackground: Color,
        val inputForeground: Color,
        val inactiveSelection: Color,
        val warningBorder: Color,
        val codeBlockBackground: Color,
        val dark: Boolean,
        val fontFamily: String,
        val fontSizePx: Int,
    )

    /** Read the palette from the active LaF (via [Theme]) and build the CSS. */
    fun current(): String = css(currentPalette())

    fun currentPalette(): Palette {
        val surface = Theme.Colors.surface()
        val inset = Theme.Colors.surfaceInset()
        val text = Theme.Colors.primaryText()
        val dark = ColorUtil.isDark(surface)
        val font = Theme.Fonts.body()
        return Palette(
            surface = surface,
            surfaceInset = inset,
            text = text,
            mutedText = Theme.Colors.mutedText(),
            border = Theme.Colors.border(),
            accent = Theme.Colors.accent(),
            accentForeground = if (ColorUtil.isDark(Theme.Colors.accent())) Color.WHITE else surface,
            inputBackground = inset,
            inputForeground = text,
            inactiveSelection = JBColor.namedColor("List.selectionInactiveBackground", inset),
            warningBorder = JBColor.namedColor("Component.warningFocusColor", WARNING_FALLBACK),
            codeBlockBackground = if (dark) ColorUtil.brighter(surface, 1) else ColorUtil.darker(surface, 1),
            dark = dark,
            fontFamily = font.family,
            fontSizePx = font.size,
        )
    }

    /**
     * Build the CSS injected into `<style id="e4u-jb-theme">`. `:root`
     * variable overrides plus a body font rule — everything else in the
     * document derives from these vars, exactly like under VS Code.
     */
    fun css(palette: Palette): String {
        val vars =
            listOf(
                "--vscode-color-scheme" to if (palette.dark) "dark" else "light",
                "--vscode-font-family" to "'${palette.fontFamily}', sans-serif",
                "--vscode-sideBar-background" to hex(palette.surface),
                "--vscode-editor-background" to hex(palette.surface),
                "--vscode-editorWidget-background" to hex(palette.surfaceInset),
                "--vscode-input-background" to hex(palette.inputBackground),
                "--vscode-input-foreground" to hex(palette.inputForeground),
                "--vscode-input-border" to hex(palette.border),
                "--vscode-foreground" to hex(palette.text),
                "--vscode-descriptionForeground" to hex(palette.mutedText),
                "--vscode-panel-border" to hex(palette.border),
                "--vscode-button-background" to hex(palette.accent),
                "--vscode-button-foreground" to hex(palette.accentForeground),
                "--vscode-editor-inactiveSelectionBackground" to hex(palette.inactiveSelection),
                "--vscode-inputValidation-warningBorder" to hex(palette.warningBorder),
                "--vscode-textCodeBlock-background" to hex(palette.codeBlockBackground),
                // Status palette — the Theme constants carry the same value
                // for the light and dark variant, so a direct read is exact.
                "--vscode-charts-green" to hex(Theme.Colors.STATUS_STREAMING),
                "--vscode-charts-blue" to hex(Theme.Colors.STATUS_READY),
                "--vscode-charts-red" to hex(Theme.Colors.STATUS_ERROR),
            )
        val rootBlock = vars.joinToString(separator = " ") { (name, value) -> "$name: $value;" }
        return ":root { $rootBlock } body { font-size: ${palette.fontSizePx}px; }"
    }

    private fun hex(color: Color): String = "#${ColorUtil.toHex(color, false)}"

    private val WARNING_FALLBACK = Color(WARNING_R, WARNING_G, WARNING_B)
    private const val WARNING_R = 224
    private const val WARNING_G = 164
    private const val WARNING_B = 79
}
