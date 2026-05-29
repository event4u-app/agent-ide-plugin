package de.event4u.agent.ui

import java.awt.Container
import java.awt.Dimension
import java.awt.FlowLayout

/**
 * Wrapping flow layout — `FlowLayout` extension that reports its preferred
 * size correctly when children wrap to a second row. The stock
 * `FlowLayout.preferredLayoutSize` returns a single-row dimension, which
 * makes the chip rail collapse instead of growing.
 *
 * Variant of the well-known WrapLayout pattern from Rob Camick (public domain).
 */
class WrapLayout(
    align: Int = LEFT,
    hgap: Int = Theme.Space.SM,
    vgap: Int = Theme.Space.XS,
) : FlowLayout(align, hgap, vgap) {
    override fun preferredLayoutSize(target: Container): Dimension = layoutSize(target, true)

    override fun minimumLayoutSize(target: Container): Dimension = layoutSize(target, false).apply { width -= hgap + 1 }

    private fun layoutSize(
        target: Container,
        preferred: Boolean,
    ): Dimension {
        synchronized(target.treeLock) {
            val targetWidth = target.size.width.takeIf { it > 0 } ?: Int.MAX_VALUE
            val insets = target.insets
            val horizontalInsets = insets.left + insets.right + hgap * 2
            val maxWidth = targetWidth - horizontalInsets

            val dim = Dimension(0, 0)
            var rowWidth = 0
            var rowHeight = 0

            for (i in 0 until target.componentCount) {
                val m = target.getComponent(i)
                if (!m.isVisible) continue
                val d = if (preferred) m.preferredSize else m.minimumSize
                if (rowWidth + d.width > maxWidth) {
                    addRow(dim, rowWidth, rowHeight)
                    rowWidth = 0
                    rowHeight = 0
                }
                if (rowWidth != 0) rowWidth += hgap
                rowWidth += d.width
                rowHeight = maxOf(rowHeight, d.height)
            }
            addRow(dim, rowWidth, rowHeight)
            dim.width += horizontalInsets
            dim.height += insets.top + insets.bottom + vgap * 2
            return dim
        }
    }

    private fun addRow(
        dim: Dimension,
        rowWidth: Int,
        rowHeight: Int,
    ) {
        dim.width = maxOf(dim.width, rowWidth)
        if (dim.height > 0) dim.height += vgap
        dim.height += rowHeight
    }
}
