import { useNavigate } from 'react-router';
import type { StatChip } from '@/lib/dashboard-chips';

/**
 * The demoted supporting numbers (DIRECTION.md rule 2: "supporting numbers demote to a
 * single row of stat chips").
 *
 * Replaces the three 4-cell `MetricCard` grids the Dashboard used to stack. Every number
 * those grids showed is still here and still taps through to the same drawer or page —
 * demoted, never deleted. No icons, no accent colours, no per-chip decoration: a chip is a
 * label, a number and its sub-line. The chips themselves are built by
 * `buildDashboardChips`; this component only renders them.
 */
type Props = {
  chips: StatChip[];
};

export default function StatChipRow({ chips }: Props) {
  const navigate = useNavigate();
  if (chips.length === 0) return null;

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory"
      // Horizontal scroll is the point at 390px: the chips run off the edge rather than
      // wrapping into another grid of tiles competing with the hero.
      style={{ scrollbarWidth: 'thin' }}
    >
      {chips.map(chip => (
        <button
          key={chip.id}
          type="button"
          onClick={() => {
            if (chip.onClick) chip.onClick();
            else if (chip.to) navigate(chip.to);
          }}
          disabled={!chip.onClick && !chip.to}
          className="card-forged shrink-0 snap-start min-w-[8.5rem] px-3 py-2.5 text-left transition-colors hover:border-primary/40 disabled:cursor-default"
        >
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{chip.label}</p>
          <p className="text-base font-display font-bold text-foreground mt-0.5 truncate">{chip.value}</p>
          {chip.sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{chip.sub}</p>}
        </button>
      ))}
    </div>
  );
}
