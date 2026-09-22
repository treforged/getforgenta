/**
 * LEGEND LABELS ARE TEXT, AND THE SERIES COLOUR IS NOT A TEXT COLOUR.
 *
 * Recharts colours a legend's LABEL with the series colour by default. That same value is doing
 * two jobs with two different WCAG floors: as a line or a bar it is a GRAPHICAL object at the
 * 3:1 non-text floor, and as a legend label it is TEXT at 4.5:1. A palette tuned to look right
 * on a chart is therefore routinely illegible as a caption.
 *
 * MEASURED 2026-09-22 by the first light-mode rendered contrast run this app ever had: `/debt`,
 * the legend label "Discover It", `rgb(60, 167, 221)` - **2.48:1** against the light page, and
 * the only string in the whole 490-element sweep still failing AA. Ada found the same shape in
 * DARK on 2026-09-18 at 3.6:1, which is the tell that it is the mechanism rather than one colour.
 *
 * ── THE FIX IS TO SEPARATE THE TWO JOBS, NOT TO DARKEN THE PALETTE ───────────────────────────
 * Darkening `CARD_COLORS` to satisfy the caption would change every debt chart in DARK mode too,
 * where nothing is wrong. Instead the label is drawn in `--foreground` and recharts keeps drawing
 * its coloured SWATCH beside it - so the chart-to-legend mapping a colour carries is preserved
 * exactly, and the words become readable. This is also what most chart libraries do by default,
 * and it is already the pattern `Forecast.tsx` uses; this is that pattern made shared rather than
 * copied a fourth time.
 *
 * ⚠️ IT DOES NOT TOUCH THE SERIES COLOURS, deliberately. Whether `CARD_COLORS` clears 3:1 as
 * GRAPHICS in light mode is a separate question that this does not answer and does not claim to.
 */
import type { ReactNode } from 'react';

/**
 * Draw a legend label in the page's own text colour.
 *
 * Pass as `<Legend formatter={legendLabel} />`. The swatch is recharts' own and is untouched.
 */
export function legendLabel(value: ReactNode): ReactNode {
  return <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>;
}
