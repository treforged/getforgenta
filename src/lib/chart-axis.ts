/**
 * Chart axis text colour, in ONE place.
 *
 * Every recharts axis used to hard-code `hsl(240, 4%, 46-50%)`: one grey for both themes. In dark
 * mode that read 3.41:1 on the debt chart (below the 4.5:1 AA floor), and it never followed the
 * theme at all (ask 1af54e4a, measured by docs/wip/glow-pixel-probe.mjs 2026-09-24).
 *
 * An SVG `fill` attribute does not reliably resolve `var(--token)`, but it does resolve
 * `currentColor`. So the ticks use `currentColor`, and the chart container carries
 * `AXIS_TEXT_CLASS`, which sets `color` to the theme's `--muted-foreground` (7.80:1 dark,
 * 6.05:1 light). Change the axis colour here, never at a call site.
 */
export const AXIS_TICK_FILL = 'currentColor';
export const AXIS_TEXT_CLASS = 'text-muted-foreground';
