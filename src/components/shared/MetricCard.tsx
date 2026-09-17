import { cn } from '@/lib/utils';
import { LucideIcon, BarChart2 } from 'lucide-react';

type MetricCardProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'silver' | 'crimson' | 'success' | 'orange';
  className?: string;
  icon?: LucideIcon;
  clickHint?: boolean;
};

/**
 * Type size for a metric value, stepped by how long the string is, so a figure never has to
 * wrap or clip to fit its tile. See the long note at the call site for why wrapping and
 * truncating are both rejected.
 *
 * The narrowest real case is the four-across ADVANCED ANALYTICS grid on Dashboard, where the
 * icon takes ~40px of the tile: that is what "$1,422" was wrapping inside. Breakpoints are
 * measured in characters rather than pixels because the value is known at render time while a
 * width is not, and a character count needs no layout pass to be correct.
 *
 * Exported for the gate: a rendered check asserts the returned class actually keeps the value
 * on one line, and a unit test pins the boundaries so a later edit cannot quietly widen them.
 */
export function valueSizeClass(value: string): string {
  const n = value.length;
  if (n <= 6) return 'text-xl sm:text-2xl';   // "$560", "16.7%", "0.2 mo"
  if (n <= 9) return 'text-lg sm:text-xl';    // "$1,422", "-$14,400"
  if (n <= 12) return 'text-base sm:text-lg'; // "$150,000.00"
  return 'text-sm sm:text-base';              // anything longer still fits rather than wrapping
}

export default function MetricCard({
  label,
  value,
  sub,
  accent = 'silver',
  className,
  icon: Icon,
  clickHint,
}: MetricCardProps) {
  const colorMap = {
    gold: 'text-primary',
    silver: 'text-foreground',
    crimson: 'text-destructive',
    success: 'text-success',
    orange: 'text-primary',
  };

  const glowMap = {
    gold: 'shadow-[0_0_20px_-8px_hsl(var(--gold)/0.3)]',
    silver: '',
    crimson: 'shadow-[0_0_20px_-8px_hsl(var(--crimson)/0.2)]',
    success: 'shadow-[0_0_20px_-8px_hsl(var(--success)/0.2)]',
    orange: 'shadow-[0_0_20px_-8px_hsl(30_90%_50%/0.2)]',
  };

  const iconBgMap = {
    gold: 'bg-primary/10 text-primary',
    silver: 'bg-muted text-foreground',
    crimson: 'bg-destructive/10 text-destructive',
    success: 'bg-success/10 text-success',
    orange: 'bg-primary/10 text-primary',
  };

  return (
    <div
      className={cn(
        // overflow-hidden scoped to THIS card rather than added to the card-forged utility:
        // that utility wraps panels containing dropdowns and popovers that are meant to escape
        // their box, and clipping those would trade one visual bug for a worse one.
        'relative card-forged overflow-hidden p-4 sm:p-5 hover:border-primary/20 transition-all duration-300 h-full',
        glowMap[accent],
        className
      )}
    >
      {/*
        ⚠️ THE ICON USED TO SHARE A ROW WITH THE VALUE, AND THAT - NOT THE TYPE SIZE - IS WHY
        FIGURES WRAPPED. Measured at 390px on /demo: the value's box was 57px, because a 36px
        icon plus its 12px gap came out of the same flex row. No readable size fits a money
        figure in 57px, so a pure type-ladder fix would only have traded a wrap for a clip.

        The icon now shares a row with the LABEL, which is short, reflows harmlessly and is not a
        number. The value and sub-label sit below it at the card's FULL width. Absolute
        positioning was tried first and rejected: the icon's vertical band overlaps where the
        value sits, so it needed right padding on the value anyway and gave most of the width
        straight back.
      */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider leading-snug min-w-0">
          {label}
        </p>
        {Icon && (
          <div
            className={cn(
              'w-9 h-9 sm:w-10 sm:h-10 rounded-md flex items-center justify-center shrink-0 -mt-1',
              iconBgMap[accent]
            )}
          >
            <Icon size={18} />
          </div>
        )}
      </div>

      {/*
        ⚠️ A FIGURE MUST NEVER WRAP, NEVER TRUNCATE, AND NEVER SPILL. All three are wrong, and
        this element has been each of them in turn, so the history is worth keeping.

        1. It began as `whitespace-nowrap` with no clipping, so a wide value SPILLED over the
           card border onto the neighbouring tile and the icon.
        2. That was fixed with `break-words`, deliberately choosing a wrap over a truncate -- a
           clipped or ellipsised number reads as a SMALLER NUMBER, which on a finance screen is
           not a cosmetic problem. That reasoning is still right.
        3. Tre, 2026-09-17, with a screenshot of Home > Overview: "numbers should never wrap. fix
           that." AVG MONTHLY SPEND rendered "$1,42" with the "2" on the next line, and EMERGENCY
           RUNWAY split "0.2" from "mo". A figure broken mid-number is briefly a DIFFERENT
           NUMBER, which is the same class of harm as truncating one.

        So none of the first two answers is acceptable alone. The width came from moving the icon
        (above); `valueSizeClass` then steps the type down for genuinely long strings so the last
        resort is never reached. The card's `overflow-hidden` remains the backstop, and if it is
        ever hit the fix is another step, never a truncate.

        `tabular-nums` keeps digits on a fixed advance, so tiles align with each other and a
        value does not re-fit as it changes.
      */}
      <p
        className={cn(
          'font-display font-bold mt-2 tracking-tight whitespace-nowrap tabular-nums',
          valueSizeClass(value),
          colorMap[accent]
        )}
      >
        {value}
      </p>

      {sub && (
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-snug">
          {sub}
        </p>
      )}

      {clickHint && (
        <BarChart2 size={11} className="absolute bottom-2 right-2 text-muted-foreground/60" />
      )}
    </div>
  );
}