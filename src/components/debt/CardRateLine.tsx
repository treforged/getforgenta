import { CalendarDays } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { CardData } from '@/lib/credit-card-engine';
import { cardMarginalApr, payoffOrderAsOf } from '@/lib/debt-payoff-order';
import { parseTranches, promoExpiryWarnings } from '@/lib/balance-tranches';
import { ordinal } from '@/lib/ordinal';
import type { AccountRow } from '@/hooks/useSupabaseData';
import { toLocalDateStr } from '@/lib/scheduling';

/**
 * The rate/limit/utilization line under a card's name in the payoff accordion, plus its promo
 * warnings. Lifted out of CreditCardEngine.tsx unchanged except for one addition: the MARGINAL
 * rate badge.
 *
 * `marginalApr` is what ranks the card in the avalanche order — the rate the next dollar paid to
 * it actually saves — and it can sit far from the headline APR on a card carrying a promo tranche.
 * It is shown BESIDE the flat APR, never instead of it (REDESIGN-PLAN decision 4: never take
 * information away to be tidier), and only when the two differ. Informational, so it uses muted
 * secondary styling — gold is for actions.
 */

type Props = {
  card: CardData;
  utilizationNow: number;
  /** The account row behind this card, for its raw balance_tranches / apr. */
  account: AccountRow | undefined;
};

export default function CardRateLine({ card, utilizationNow, account }: Props) {
  const asOf = payoffOrderAsOf();
  const marginal = cardMarginalApr(card, asOf);
  // A promo balance with an expiry is a dated event, not a smooth line — say the date, the money,
  // and the paydown that beats it. Read straight off the account row; the projection engine also
  // accrues per-tranche and reprices at this cliff (credit-card-engine.ts), so the warning and the
  // sim agree.
  // Deliberately still the UTC-sliced date this line used before the extraction — changing which
  // day the warning resolves against is not this slice's business.
  const warnings = promoExpiryWarnings(
    parseTranches(account?.balance_tranches),
    Number(account?.apr ?? card.apr),
    toLocalDateStr(new Date()),
  );

  return (
    <>
      <p className="text-[11px] sm:text-xs text-muted-foreground">
        {card.apr}% APR · Limit {formatCurrency(card.creditLimit, false)} · Utilization {utilizationNow.toFixed(1)}%
        {card.dueDay && <span> · <CalendarDays size={10} className="inline" /> Due {ordinal(card.dueDay)}</span>}
      </p>
      {marginal !== card.apr && (
        <span
          className="inline-block mt-0.5 text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-secondary text-muted-foreground border border-border font-medium"
          style={{ borderRadius: 'var(--radius)' }}
        >
          attacking {marginal}% tranche
        </span>
      )}
      {warnings.map(w => (
        <p key={w.promoEndDate + w.label} className="text-[11px] sm:text-xs text-gold mt-0.5">
          ⚠ {formatCurrency(w.balance, false)} at {w.promoApr}% reprices to {w.standardApr}% on{' '}
          {new Date(`${w.promoEndDate}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' '}(+{formatCurrency(w.extraMonthlyInterest, false)}/mo) — clearing it first needs{' '}
          {formatCurrency(w.requiredMonthlyPaydown, false)}/mo for {w.monthsRemaining} months
        </p>
      ))}
    </>
  );
}
