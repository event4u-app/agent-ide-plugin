package de.event4u.agent.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Font

/**
 * Single-import theme surface for the chat UI. Wraps every
 * `JBUI.CurrentTheme.*` lookup the C-rule design contract names, so:
 *
 *   1. Components reference tokens, not raw hex.
 *   2. A future Compose migration (when jewel hits 1.0) touches one file.
 *   3. Unit tests can stub the surface if needed.
 *
 * Spec: see `agents/roadmaps/road-to-mvp-ui-design.md` § Visual language.
 */
object Theme {
    // Spacing scale — px units consumed by JBUI.Borders.empty(...) and gaps.
    object Space {
        const val XXS = 2
        const val XS = 4
        const val SM = 8
        const val MD = 12
        const val LG = 16
        const val XL = 24
    }

    // Border-radius scale — px units consumed by RoundedPanel + Chip painters.
    object Radius {
        const val CHIP = 12
        const val CARD = 8
        const val BUTTON = 6
    }

    // Sizes the design contract pins.
    object Size {
        const val HEADER_HEIGHT = 36
        const val ICON_BUTTON = 28
        const val PILL_HEIGHT = 24
        const val STATUS_DOT = 6
        const val CHIP_HEIGHT = 22
        const val INPUT_MIN_HEIGHT = 60
        const val WELCOME_CARD_MAX_WIDTH = 320
    }

    object Colors {
        fun surface(): Color = JBUI.CurrentTheme.ToolWindow.background()

        fun surfaceInset(): Color = JBUI.CurrentTheme.NewClassDialog.searchFieldBackground()

        fun primaryText(): Color = JBUI.CurrentTheme.Label.foreground()

        fun mutedText(): Color = JBUI.CurrentTheme.Label.disabledForeground()

        fun border(): Color = JBUI.CurrentTheme.CustomFrameDecorations.separatorForeground()

        fun accent(): Color =
            EditorColorsManager.getInstance().globalScheme.let {
                JBUI.CurrentTheme.Link.Foreground.ENABLED
            }

        // Status palette — soft fixed values that work against both the
        // light and dark default IntelliJ themes. JBColor handles the
        // light/dark switch automatically.
        val STATUS_READY: JBColor = JBColor(Color(READY_R, READY_G, READY_B), Color(READY_R, READY_G, READY_B))
        val STATUS_STREAMING: JBColor =
            JBColor(Color(STREAMING_R, STREAMING_G, STREAMING_B), Color(STREAMING_R, STREAMING_G, STREAMING_B))
        val STATUS_ERROR: JBColor = JBColor(Color(ERROR_R, ERROR_G, ERROR_B), Color(ERROR_R, ERROR_G, ERROR_B))

        private const val READY_R = 74
        private const val READY_G = 144
        private const val READY_B = 226
        private const val STREAMING_R = 76
        private const val STREAMING_G = 175
        private const val STREAMING_B = 80
        private const val ERROR_R = 200
        private const val ERROR_G = 70
        private const val ERROR_B = 70
    }

    object Fonts {
        fun body(): Font = JBFont.label()

        fun small(): Font = JBFont.small()

        fun tiny(): Font = JBFont.medium().deriveFont(MINI_FONT_SIZE)

        fun monospace(size: Float = body().size2D.toFloat()): Font =
            Font(Font.MONOSPACED, Font.PLAIN, size.toInt())

        private const val MINI_FONT_SIZE = 10f
    }
}
