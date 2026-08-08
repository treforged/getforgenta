// Stage 6 — the AI Advisor's debt picture, sourced from the converged debt engine.
//
// The advisor used to compute its own closed-form amortization per `debts` row
// (`-ln(1 - rB/P)/ln(1+r)`). That estimate could not see the payoff cascade, promotional
// APRs, or the engine's floors, so it could hand the model a timeline the rest of the app
// contradicted. On live data it told the model Discover would NEVER pay off (its $52
// target payment sits below the $60.65/mo interest accrual) while the app showed a real
// payoff date on screen.
//
// Rule: the advisor never derives a payoff figure. It quotes the engine, or it says nothing.

import { firstRevolvingPayoffMonth } from '@/lib/revolving-payoff';
import { PROJECTION_MONTHS } from '@/lib/scheduling';

/** Minimal shape needed off the converged projection — keeps this module test-friendly. */
export interface AdvisorCardProjection {
  perCardPayments: { name: string; id: string }[];
  monthlyRevolvingBalances: Map<string, number[]>;
}

export interface AdvisorAccountLike {
  name?: string | null;
  balance?: number | string | null;
  apr?: number | string | null;
  min_payment?: number | string | null;
}

export interface AdvisorDebtRowLike {
  name?: string | null;
  balance?: number | string | null;
  apr?: number | string | null;
  min_payment?: number | string | null;
  target_payment?: number | string | null;
}

export interface AdvisorDebtDetail {
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  targetPayment: number;
  /** Months from today per the engine; null means "engine does not model this debt". */
  payoffMonthsFromNow: number | null;
  source: 'engine' | 'user_entered';
}

export interface AdvisorDebtContext {
  debtDetails: AdvisorDebtDetail[];
  creditCardDebtFreeMonthsFromNow: number | null;
}

const num = (v: number | string | null | undefined, fallback = 0): number => {
  const n = Number(v ?? NaN);
  return Number.isFinite(n) ? n : fallback;
};

const key = (name: string | null | undefined): string => String(name ?? '').toLowerCase();

/**
 * Engine payoff months are 1-indexed, where index 0 is the current month — so a payoff
 * month of 1 means "this month", i.e. 0 months from now. Getting this wrong shifts every
 * date the advisor quotes by one month against the rest of the app.
 */
export function payoffMonthsFromNow(payoffMonth: number | null): number | null {
  return payoffMonth === null ? null : Math.max(0, payoffMonth - 1);
}

/**
 * Build the advisor's debt payload.
 *
 * Cards the engine models are authoritative and carry its payoff month. Rows that exist
 * only in the user-entered `debts` table are preserved (nothing the user typed is lost)
 * but carry a null payoff, so the prompt can tell the model to make no claim about them.
 * `debts` has no FK to `accounts`, so matching is by case-insensitive name — the same
 * convention the advisor's loan block already uses.
 */
export function buildAdvisorDebtContext(input: {
  cardProjection: AdvisorCardProjection | null;
  accounts: AdvisorAccountLike[];
  debts: AdvisorDebtRowLike[];
  months?: number;
}): AdvisorDebtContext {
  const { cardProjection, accounts, debts, months = PROJECTION_MONTHS } = input;

  const enginePayoffByName = new Map<string, number | null>();
  if (cardProjection) {
    for (const c of cardProjection.perCardPayments) {
      enginePayoffByName.set(
        key(c.name),
        firstRevolvingPayoffMonth(cardProjection.monthlyRevolvingBalances, [c.id], months),
      );
    }
  }

  const debtRowByName = (name: string) => debts.find(d => key(d.name) === key(name));
  const accountByName = (name: string) => accounts.find(a => key(a.name) === key(name));

  const engineDebts: AdvisorDebtDetail[] = (cardProjection?.perCardPayments ?? []).map(c => {
    const acct = accountByName(c.name);
    const row = debtRowByName(c.name);
    return {
      name: c.name,
      balance: num(acct?.balance ?? row?.balance),
      apr: num(acct?.apr ?? row?.apr),
      minPayment: num(acct?.min_payment ?? row?.min_payment),
      targetPayment: num(row?.target_payment),
      payoffMonthsFromNow: payoffMonthsFromNow(enginePayoffByName.get(key(c.name)) ?? null),
      source: 'engine',
    };
  });

  const unmatchedDebts: AdvisorDebtDetail[] = debts
    .filter(d => !enginePayoffByName.has(key(d.name)))
    .map(d => ({
      name: String(d.name ?? 'Unknown'),
      balance: num(d.balance),
      apr: num(d.apr),
      minPayment: num(d.min_payment),
      targetPayment: num(d.target_payment),
      payoffMonthsFromNow: null,
      source: 'user_entered',
    }));

  const creditCardDebtFreeMonthsFromNow = cardProjection
    ? payoffMonthsFromNow(firstRevolvingPayoffMonth(
        cardProjection.monthlyRevolvingBalances,
        cardProjection.perCardPayments.map(c => c.id),
        months,
      ))
    : null;

  return { debtDetails: [...engineDebts, ...unmatchedDebts], creditCardDebtFreeMonthsFromNow };
}
