import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { DashboardHeroState, HeroEmptyReason } from '@/lib/payoff-summary';
import type { PayoffTrajectory } from '@/lib/payoff-trajectory';
import { formatMonthsAway } from '@/lib/payoff-trajectory';
import PayoffTrack from './PayoffTrack';

/**
 * The one number the Dashboard leads with (DIRECTION.md rule 2).
 *
 * A pure renderer: every branch it can take is decided by `selectDashboardHero`, so the
 * "never a confident zero" rule is enforced by a tested selector rather than by JSX.
 * Gold is deliberately absent from the hero number — it is `text-foreground`, because gold
 * is reserved for money-in-motion and primary actions.
 *
 * The hero is NOT a dashboard widget: it is fixed at the top of the page, and is neither
 * reorderable nor hideable through `useDashboardLayout`.
 */
type Props = {
  state: DashboardHeroState;
  /** Opens the cash-floor calculator drawer, so the second read is auditable. */
  onFloorClick?: () => void;
  /**
   * The payoff run drawn under the date. Optional and absent-not-empty: a hero with no
   * published trajectory renders exactly as it did before, never a flat line on the axis.
   * It is a prop rather than part of `DashboardHeroState` because it changes nothing about
   * WHICH hero is shown — `selectDashboardHero` stays a decision about readings.
   */
  trajectory?: PayoffTrajectory | null;
};

/** Copy for each honest empty state: what is missing, and the one action that fills it. */
const EMPTY_COPY: Record<HeroEmptyReason, { label: string; title: string; body: string; action?: { to: string; label: string } }> = {
  'no-accounts': {
    label: 'Your card payoff date',
    title: 'Nothing to read yet',
    body: 'Connect a bank or add an account and your credit-card payoff date lands here.',
    action: { to: '/dashboard?tab=accounts', label: 'Add an account' },
  },
  projecting: {
    label: 'Your card payoff date',
    title: 'Working it out',
    body: 'Your payoff plan is still being calculated. This lands as soon as it converges.',
  },
  'no-payoff-in-range': {
    label: 'Your card payoff date',
    title: 'Not within 5 years',
    body: 'At the current plan your cards do not clear inside the projection. Raising the payment moves this date.',
    action: { to: '/debt', label: 'Review the plan' },
  },
  'no-reading': {
    label: 'Cash above your floor',
    title: 'No reading yet',
    body: 'Add your income and bills so the safe-cash floor can be worked out.',
    action: { to: '/budget', label: 'Set up your budget' },
  },
};

function HeroShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="card-forged p-5 sm:p-6" aria-label={label}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </section>
  );
}

/** The second read, one line under the hero. Absent — not $0 — when there is no reading. */
function CashAboveFloorLine({ value, onFloorClick }: { value: number | null; onFloorClick?: () => void }) {
  if (value == null) return null;
  const text = value >= 0
    ? `${formatCurrency(value, false)} above your floor`
    : `${formatCurrency(Math.abs(value), false)} below your floor`;
  const tone = value >= 0 ? 'text-muted-foreground' : 'text-destructive';
  if (!onFloorClick) return <p className={`text-sm mt-3 ${tone}`}>{text}</p>;
  return (
    <button
      onClick={onFloorClick}
      className={`text-sm mt-3 underline underline-offset-2 hover:text-foreground transition-colors ${tone}`}
    >
      {text}
    </button>
  );
}

export default function DashboardHero({ state, onFloorClick, trajectory }: Props) {
  if (state.kind === 'payoff') {
    const { payoff, cashAboveFloor, hasOtherDebt } = state;
    const monthLabel = payoff.date.toLocaleString('en', { month: 'short', year: 'numeric' });
    return (
      // The label names the debt, because the date only ever covered credit cards: it comes
      // from the revolving engine, which never sees a car loan. "Debt free" over it was a
      // true number making a claim the data does not support.
      <HeroShell label="Credit cards paid off">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1">
          <p className="text-5xl font-display font-bold text-foreground tracking-tight">
            {monthLabel}
          </p>
          {/* The countdown is the part that moves, so it reads as a run, not a fact. */}
          <p className="text-sm text-muted-foreground">{formatMonthsAway(payoff.monthsAway)}</p>
        </div>
        {trajectory && <PayoffTrack trajectory={trajectory} endLabel={monthLabel} />}
        {hasOtherDebt && (
          <p className="text-xs text-muted-foreground mt-2">
            Loans run on their own schedule and are not in this date.
          </p>
        )}
        <CashAboveFloorLine value={cashAboveFloor} onFloorClick={onFloorClick} />
      </HeroShell>
    );
  }

  if (state.kind === 'cash') {
    const { cashAboveFloor, carriesCardBalance, hasOtherDebt } = state;
    const below = cashAboveFloor < 0;
    return (
      // A card paid in full every cycle is not the same claim as owing nothing, so the
      // label says which one is true rather than flattening both into "debt free" — and
      // "debt free" is reserved for the one user who owes nothing on a loan either.
      <HeroShell
        label={
          carriesCardBalance
            ? 'No interest to pay'
            : hasOtherDebt
              ? 'No credit card debt'
              : "You're debt free"
        }
      >
        <p className={`text-5xl font-display font-bold tracking-tight mt-1 ${below ? 'text-destructive' : 'text-foreground'}`}>
          {formatCurrency(Math.abs(cashAboveFloor), false)}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          {below ? 'below your cash floor' : 'above your cash floor'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {carriesCardBalance ? 'Your cards clear each month — nothing revolving' : 'No credit card balances'}
        </p>
        {hasOtherDebt && (
          <p className="text-xs text-muted-foreground mt-1">
            You still owe on a loan — see the Debt page.
          </p>
        )}
        {onFloorClick && (
          <button
            onClick={onFloorClick}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors mt-3"
          >
            How the floor is worked out
          </button>
        )}
      </HeroShell>
    );
  }

  const copy = EMPTY_COPY[state.reason];
  return (
    <HeroShell label={copy.label}>
      <p className="text-2xl font-display font-bold text-muted-foreground tracking-tight mt-1">
        {copy.title}
      </p>
      <p className="text-sm text-muted-foreground mt-2 max-w-prose">{copy.body}</p>
      {copy.action && (
        <Link
          to={copy.action.to}
          className="inline-flex items-center gap-1.5 mt-4 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {copy.action.label} <ArrowUpRight size={13} />
        </Link>
      )}
    </HeroShell>
  );
}
