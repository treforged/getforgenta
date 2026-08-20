import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { ConsolidationPlanRow } from '@/lib/consolidation-adapter';
import { consolidationCards, scheduledCardCharges } from '@/lib/consolidation-adapter';
import {
  simulateSelfFundedPaydown,
  creditApplicationCollisions,
  type PlannedCreditEvent,
} from '@/lib/self-funded-paydown';

type Props = {
  accounts: AccountRow[];
  /**
   * The same `payment_plans` rows the engine already reads, passed down rather than re-queried —
   * a panel that opens its own query can disagree with the projection sitting above it.
   */
  paymentPlans: ConsolidationPlanRow[];
  /**
   * Cash going to cards each month, indexed from this month. Comes from the engine's own
   * per-card payment ledger — NOT a number this panel invents. When it is empty the panel says so
   * and shows nothing else, because a milestone date computed from a guessed budget is worse than
   * no milestone date.
   */
  capacityByMonth: number[];
};

/** The utilization lines that actually change a lending decision. */
const MILESTONES = [50, 30] as const;

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The no-loan plan: what paying the cards down out of cash flow actually buys, and when.
 *
 * WHY THIS IS SEPARATE FROM `UtilizationPanel`. That panel answers "where does a dollar do the most
 * good right now" — a ranking, in the present tense. This one answers the question a declined
 * applicant has: **when am I under the line**, given the money that actually shows up each month.
 * Those are different questions and the second one needs a simulation, not a sort.
 *
 * ⚠️ TWO ANSWERS, NEVER BLENDED. Attacking the most-utilized card and attacking the most expensive
 * card are different plans and they disagree. The panel shows both, with the interest each costs,
 * and does not pick. Averaging them would produce a plan that is neither.
 */
export default function PaydownPlanPanel({ accounts, paymentPlans, capacityByMonth }: Props) {
  const asOf = useMemo(() => todayISO(), []);

  /**
   * The month a new credit application is planned for. There is no column for this — it is an
   * intention, not a fact about an account — so it is a local preference. Blank means "none
   * planned", and with none planned there is nothing for a card opening to collide with.
   */
  const [applicationMonth, setApplicationMonth] = usePersistedState<string>(
    'tre:paydown:plannedApplicationMonth',
    '',
  );

  const cards = useMemo(() => consolidationCards(accounts ?? []), [accounts]);

  const charges = useMemo(
    () => scheduledCardCharges(paymentPlans, cards, { asOf }),
    [paymentPlans, cards, asOf],
  );

  const openCards = useMemo(
    () => cards.filter(c => !c.startDate || c.startDate <= asOf),
    [cards, asOf],
  );

  /** The card carrying the highest utilization — the one a lender reads first. */
  const worstCard = useMemo(() => {
    const withPct = openCards
      .filter(c => c.creditLimit > 0 && c.balance > 0)
      .map(c => ({ card: c, pct: (c.balance / c.creditLimit) * 100 }))
      .sort((a, b) => b.pct - a.pct);
    return withPct[0] ?? null;
  }, [openCards]);

  const hasCapacity = capacityByMonth.length > 0 && capacityByMonth.some(v => v > 0);

  const avalanche = useMemo(
    () =>
      hasCapacity
        ? simulateSelfFundedPaydown({
            cards,
            charges,
            asOf,
            capacity: capacityByMonth,
            milestonesPct: MILESTONES,
          })
        : null,
    [hasCapacity, cards, charges, asOf, capacityByMonth],
  );

  const worstFirst = useMemo(
    () =>
      hasCapacity && worstCard
        ? simulateSelfFundedPaydown({
            cards,
            charges,
            asOf,
            capacity: capacityByMonth,
            priorityCardIds: [worstCard.card.id],
            milestonesPct: MILESTONES,
          })
        : null,
    [hasCapacity, worstCard, cards, charges, asOf, capacityByMonth],
  );

  const collisions = useMemo(() => {
    if (!applicationMonth) return [];
    const events: PlannedCreditEvent[] = cards
      .filter(c => c.startDate && c.startDate > asOf)
      .map(c => ({ id: c.id, label: c.name, date: c.startDate!, kind: 'card-opening' as const }));
    if (events.length === 0) return [];
    events.push({
      id: 'planned-application',
      label: 'your planned credit application',
      date: `${applicationMonth}-01`,
      kind: 'loan-application',
    });
    return creditApplicationCollisions(events);
  }, [applicationMonth, cards, asOf]);

  if (cards.length === 0) return null;

  const scheduledTotal = charges.reduce(
    (s, c) => s + (c.landsOnCard === false ? 0 : c.amountPerMonth * c.monthsRemaining),
    0,
  );

  return (
    <div className="card-forged p-3 sm:p-4 space-y-3 sm:space-y-4">
      <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
        Paydown plan — when the cards get under the line
      </span>

      {!hasCapacity ? (
        // An honest empty state. A milestone date invented from a guessed budget looks exactly like
        // a real one, which is the worst thing this panel could show.
        <p className="text-[11px] text-muted-foreground">
          No projected card payments to read yet, so there is nothing to date. Once the forecast has
          a monthly payment for these cards, this panel will show when each one crosses 50% and 30%.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {MILESTONES.map(pct => (
              <div key={pct} className="space-y-1">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
                  Under {pct}%
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  {avalanche!.milestones
                    .filter(m => m.pct === pct)
                    .filter(m => m.target === 'aggregate' || openCards.some(c => c.id === m.target))
                    .map(m => {
                      const alt = worstFirst?.milestones.find(x => x.pct === pct && x.target === m.target);
                      const sooner = alt?.month != null && (m.month == null || alt.month < m.month);
                      return (
                        <div key={`${pct}-${m.target}`} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="truncate text-muted-foreground">{m.label}</span>
                          <span className="font-medium shrink-0">
                            {m.date ? monthLabel(m.date) : 'not within 20 years'}
                            {sooner && (
                              <span className="text-primary font-normal">
                                {' '}
                                / {monthLabel(alt!.date!)} if {worstCard!.card.name} goes first
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>

          {/* The two plans, side by side, with the price of each. Never averaged. */}
          {worstFirst && worstCard && (
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border">
              <div>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                  <TrendingDown size={11} /> Cheapest (avalanche)
                </p>
                <p className="text-sm font-display font-bold mt-0.5">
                  {avalanche!.payoffDate ? monthLabel(avalanche!.payoffDate) : 'never'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatCurrency(avalanche!.totalInterest, false)} interest
                </p>
              </div>
              <div>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                  <CalendarClock size={11} /> {worstCard.card.name} first
                </p>
                <p className="text-sm font-display font-bold mt-0.5">
                  {worstFirst.payoffDate ? monthLabel(worstFirst.payoffDate) : 'never'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatCurrency(worstFirst.totalInterest, false)} interest
                  {worstFirst.totalInterest > avalanche!.totalInterest && (
                    <> · {formatCurrency(worstFirst.totalInterest - avalanche!.totalInterest, false)} more</>
                  )}
                </p>
              </div>
            </div>
          )}

          {worstCard && worstFirst && (
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">
              Avalanche costs the least interest. Paying {worstCard.card.name} first costs more but
              drops the card a lender reads first — it is at {worstCard.pct.toFixed(1)}% now. Neither
              is automatically right; the cheaper plan wins if you are not applying for anything.
            </p>
          )}

          {scheduledTotal > 0 && (
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">
              Included above: {formatCurrency(scheduledTotal, false)} of payment-plan instalments
              still to land on these cards. Repointing those at checking would pull every date
              forward.
            </p>
          )}

          {avalanche!.shortfallMonths.length > 0 && (
            <div className="flex items-start gap-1.5 text-[10px] sm:text-[11px] text-destructive">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                {avalanche!.shortfallMonths.length} month
                {avalanche!.shortfallMonths.length === 1 ? '' : 's'} where the projected payment does
                not cover every card&apos;s minimum, starting{' '}
                {monthLabel(avalanche!.shortfallMonths[0].date)}.
              </span>
            </div>
          )}
        </>
      )}

      {/* Collision check. Separate from the simulation on purpose: it is true whether or not there
          is capacity to run a paydown, and it is the cheapest mistake on this page to avoid. */}
      <div className="pt-2 border-t border-border space-y-2">
        <label className="flex items-center justify-between gap-3 text-[11px]">
          <span className="text-muted-foreground">Planning a loan or card application?</span>
          <input
            type="month"
            value={applicationMonth}
            onChange={e => setApplicationMonth(e.target.value)}
            className="bg-secondary border border-border px-2 py-1 text-xs"
            style={{ borderRadius: 'var(--radius)' }}
            aria-label="Planned credit application month"
          />
        </label>

        {collisions.map(c => (
          <div key={`${c.applicationId}-${c.openingId}`} className="flex items-start gap-1.5 text-[10px] sm:text-[11px] text-destructive">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>
              {c.reason} Move it to {monthLabel(c.suggestedOpeningDate)} or later, or apply earlier.
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
