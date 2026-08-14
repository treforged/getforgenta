import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { DashboardHeroState, HeroEmptyReason } from '@/lib/payoff-summary';

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
};

/** Copy for each honest empty state: what is missing, and the one action that fills it. */
const EMPTY_COPY: Record<HeroEmptyReason, { label: string; title: string; body: string; action?: { to: string; label: string } }> = {
  'no-accounts': {
    label: 'Your debt-free date',
    title: 'Nothing to read yet',
    body: 'Connect a bank or add an account and your debt-free date lands here.',
    action: { to: '/accounts', label: 'Add an account' },
  },
  projecting: {
    label: 'Your debt-free date',
    title: 'Working it out',
    body: 'Your payoff plan is still being calculated. This lands as soon as it converges.',
  },
  'no-payoff-in-range': {
    label: 'Your debt-free date',
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

export default function DashboardHero({ state, onFloorClick }: Props) {
  if (state.kind === 'payoff') {
    const { payoff, cashAboveFloor } = state;
    return (
      <HeroShell label="Debt free">
        <p className="text-5xl font-display font-bold text-foreground tracking-tight mt-1">
          {payoff.date.toLocaleString('en', { month: 'short', year: 'numeric' })}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          {payoff.monthsAway === 0
            ? 'This month'
            : `${payoff.monthsAway} month${payoff.monthsAway === 1 ? '' : 's'} away`}
          {' · credit cards'}
        </p>
        <CashAboveFloorLine value={cashAboveFloor} onFloorClick={onFloorClick} />
      </HeroShell>
    );
  }

  if (state.kind === 'cash') {
    const { cashAboveFloor, carriesCardBalance } = state;
    const below = cashAboveFloor < 0;
    return (
      // A card paid in full every cycle is not the same claim as owing nothing, so the
      // label says which one is true rather than flattening both into "debt free".
      <HeroShell label={carriesCardBalance ? 'No interest to pay' : "You're debt free"}>
        <p className={`text-5xl font-display font-bold tracking-tight mt-1 ${below ? 'text-destructive' : 'text-foreground'}`}>
          {formatCurrency(Math.abs(cashAboveFloor), false)}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          {below ? 'below your cash floor' : 'above your cash floor'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {carriesCardBalance ? 'Your cards clear each month — nothing revolving' : 'No credit card balances'}
        </p>
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
