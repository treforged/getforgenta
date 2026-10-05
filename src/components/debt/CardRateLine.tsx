import { CalendarDays } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { CardData } from '@/lib/credit-card-engine';
import { cardMarginalApr, payoffOrderAsOf } from '@/lib/debt-payoff-order';
import { parseTranches, promoExpiryWarnings, type PromoExpiryWarning } from '@/lib/balance-tranches';
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

/** The promo warnings for one card, read straight off its account row. */
function cardPromoWarnings(card: CardData, account: AccountRow | undefined): PromoExpiryWarning[] {
  // A promo balance with an expiry is a dated event, not a smooth line — say the date, the money,
  // and the paydown that beats it. Read straight off the account row; the projection engine also
  // accrues per-tranche and reprices at this cliff (credit-card-engine.ts), so the warning and the
  // sim agree.
  // Deliberately still the UTC-sliced date this line used before the extraction — changing which
  // day the warning resolves against is not this slice's business.
  return promoExpiryWarnings(
    parseTranches(account?.balance_tranches),
    Number(account?.apr ?? card.apr),
    toLocalDateStr(new Date()),
  );
}

export default function CardRateLine({ card, utilizationNow, account }: Props) {
  const marginal = cardMarginalApr(card, payoffOrderAsOf());
  const warnings = cardPromoWarnings(card, account);

  return (
    <>
      {/* Each fact is one unbreakable unit, so a phone wraps BETWEEN facts and never inside one
          ("Utilization" on one line, "56.0%" on the next). Sam, 2026-10-02 (259f01ba). */}
      <p className="text-[11px] sm:text-xs text-muted-foreground">
        <span className="whitespace-nowrap">{card.apr}% APR</span>
        {' · '}<span className="whitespace-nowrap">Limit {formatCurrency(card.creditLimit, false)}</span>
        {' · '}<span className="whitespace-nowrap">Utilization {utilizationNow.toFixed(1)}%</span>
        {card.dueDay && <>{' · '}<span className="whitespace-nowrap"><CalendarDays size={10} className="inline" /> Due {ordinal(card.dueDay)}</span></>}
      </p>
      {marginal !== card.apr && (
        <span
          className="inline-block mt-0.5 text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-secondary text-muted-foreground border border-border font-medium"
          style={{ borderRadius: 'var(--radius)' }}
        >
          attacking {marginal}% tranche
        </span>
      )}
      {/* One promo: its full line. Several: ONE summary line here, and each plan in the opened card
          (Tre, 2026-10-05, ask c3031372: "this is too much information just on the card" - eight
          lines on Prime Visa). The lines move, they are not deleted. This line sits INSIDE the
          card's header button, so it must not hold a control of its own. */}
      {warnings.length === 1 && <PromoLine w={warnings[0]} />}
      {warnings.length > 1 && (
        <p data-testid="promo-summary" className="text-[11px] sm:text-xs text-gold mt-0.5">
          ⚠ {warnings.length} promo balances ({formatCurrency(sum(warnings, 'balance'), false)}) reprice
          to {warnings[0].standardApr}% from {fmtDate(earliest(warnings))}
          {' '}(+{formatCurrency(sum(warnings, 'extraMonthlyInterest'), false)}/mo) · open card for each
        </p>
      )}
    </>
  );
}

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });

const sum = (ws: PromoExpiryWarning[], k: 'balance' | 'extraMonthlyInterest') =>
  ws.reduce((t, w) => t + w[k], 0);

const earliest = (ws: PromoExpiryWarning[]) =>
  ws.reduce((min, w) => (w.promoEndDate < min ? w.promoEndDate : min), ws[0].promoEndDate);

function PromoLine({ w }: { w: PromoExpiryWarning }) {
  return (
    <p className="text-[11px] sm:text-xs text-gold mt-0.5">
      ⚠ {formatCurrency(w.balance, false)} at {w.promoApr}% reprices to {w.standardApr}% on{' '}
      {fmtDate(w.promoEndDate)}
      {' '}(+{formatCurrency(w.extraMonthlyInterest, false)}/mo) — clearing it first needs{' '}
      {formatCurrency(w.requiredMonthlyPaydown, false)}/mo for {w.monthsRemaining} months
    </p>
  );
}

/** Each promo on its own line, for the OPENED card. Renders nothing for 0 or 1 promo: a single
 *  promo already shows in full in the header. */
export function CardPromoList({ card, account }: { card: CardData; account: AccountRow | undefined }) {
  const warnings = cardPromoWarnings(card, account);
  if (warnings.length < 2) return null;
  return (
    <div data-testid="promo-each" className="mb-3">
      <p className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Promo balances</p>
      {warnings.map(w => <PromoLine key={w.promoEndDate + w.label} w={w} />)}
    </div>
  );
}
