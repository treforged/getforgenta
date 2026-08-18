// WHAT a charge may be linked TO — one definition, every surface.
//
// WHY THIS FILE EXISTS. `review-write-inputs.ts` already owns the row each decision WRITES, which is
// why the deck and the list cannot record the same decision differently. What stayed behind in
// `BankActivity.tsx` was the other half: which rules, plans, vehicle charges and ledger entries are
// even OFFERED, and in what order. The Decision Deck now has pickers too (Tre, 2026-08-18: "why
// cant i choose to connect to an existing transaction?"), and a second surface computing its own
// candidate list is how one charge ends up with two different sets of destinations depending on the
// screen the user happened to be on.
//
// ⚠️ NOTHING HERE DECIDES WHETHER A LINK IS ALLOWED. Whether a charge may hold this row at all is
// `validateReviewInput` / `validateReviewSet`; whether the picker is even shown is the caller's
// (the list hides "link to an entry" once the charge holds links). These functions answer only
// "what could the user pick".

import { formatCurrency } from './calculations';
import { getActiveCarLoanPayments } from './vehicle-loan-engine';

/** How many ledger entries the "link to an entry" picker offers, nearest dates first. */
export const LEDGER_PICKER_LIMIT = 40;

/** Days between two `YYYY-MM-DD` dates, for ordering the ledger picker around the charge. */
export const daysApart = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

/** One row of a picker. `value` is what the caller turns into a write. */
export interface LinkOption {
  value: string;
  label: string;
}

interface NamedActive { id: string; name: string; active?: boolean | null }

/**
 * Rules a charge may be linked to by hand.
 *
 * ⚠️ ACTIVE ONLY — an inactive rule describes nothing that still bills, so it cannot be what a bank
 * charge settled. Returns the ROWS rather than options because the write needs the whole row:
 * `acceptRuleInput` reads its frequency and due day to place the occurrence.
 */
export function pickableRules<R extends NamedActive>(rules: readonly R[]): R[] {
  return rules.filter(r => r.active).slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * §1B Stage 4C — payment plans a charge may be linked to. Active only, same reasoning as the rules:
 * a finished or cancelled plan bills nothing a bank charge could be settling.
 *
 * A plan is a THIRD kind of thing a charge can pay, not a variant of the other two: an instalment is
 * projected from `payment_plans` by `getMonthlyPlanCashExpenses`, never from `recurring_rules` and
 * never as a ledger row.
 */
export function pickablePlans<P extends NamedActive>(plans: readonly P[]): P[] {
  return plans.filter(p => p.active).slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** The label a rule or plan is offered under: its name and what it bills. */
export const amountLabel = (name: string, amount: unknown): string =>
  `${name} · ${formatCurrency(Math.abs(Number(amount) || 0), false)}`;

type CarFundLike = Parameters<typeof getActiveCarLoanPayments>[0][number] & {
  id: string;
  vehicle_name: string;
  phase?: string | null;
  monthly_insurance?: number | string | null;
};

/**
 * §1B Stage 4B — the vehicle charges a bank row may be linked to.
 *
 * ⚠️ TWO DESTINATIONS PER VEHICLE, not one. A `phase='loan'` car fund bills a loan payment AND an
 * insurance premium every month, usually from the same account, and the engines gate the two
 * independently. Offering one "link to this vehicle" entry would record a decision the
 * number-moving half could only disambiguate by comparing amounts — the heuristic §1A demoted — so
 * the user picks the obligation, not just the car.
 *
 * ⚠️ `<fundId>:<kind>` is ONE option value carrying both halves, because a vehicle and a charge kind
 * are only meaningful together and two selects would let a user submit half of one.
 *
 * The loan payment's amount comes from `getActiveCarLoanPayments`, the same helper the engines
 * charge against cash, rather than `actual_monthly_payment`: it is the authoritative figure, it
 * already excludes lump sums, and it yields nothing at all for a loan that has not started or has
 * paid off — exactly the set of payments a charge could be settling.
 */
export function pickableCarCharges(carFunds: readonly CarFundLike[]): LinkOption[] {
  const options: LinkOption[] = [];
  // `getActiveCarLoanPayments` takes a mutable array; the copy keeps this function's own input
  // readonly, which is what stops a caller's memoised list being sorted out from under it.
  for (const p of getActiveCarLoanPayments([...carFunds])) {
    options.push({
      value: `${p.carFundId}:loan_payment`,
      label: `${p.vehicleName} · car payment · ${formatCurrency(p.payment, false)}`,
    });
  }
  // Insurance is an OWNERSHIP cost, not a financing one — it outlives the loan and is anchored to
  // `insurance_start_date ?? loan_start_date`, so it is listed off the fund's own premium rather
  // than off the payment list above. A vehicle with no premium recorded bills nothing to link to.
  for (const cf of carFunds) {
    const premium = Number(cf.monthly_insurance || 0);
    if (cf.phase !== 'loan' || premium <= 0) continue;
    options.push({
      value: `${cf.id}:insurance`,
      label: `${cf.vehicle_name} · car insurance · ${formatCurrency(premium, false)}`,
    });
  }
  return options;
}

interface LedgerLike { id: string; date: string; category: string; amount: number | string }

/**
 * The ledger entries offered for "this charge IS an entry I already made".
 *
 * ⚠️ NEAREST DATES FIRST, then capped. The entry a bank charge belongs to is almost always within
 * days of it and the ledger spans months, so an unordered list buries the right answer. The cap is
 * what keeps a `<select>` usable on a phone; it is deliberately a cap on the OFFER, never a claim
 * that older entries are wrong.
 */
export function nearestLedgerOptions(
  ledger: readonly LedgerLike[],
  chargeDate: string,
  limit: number = LEDGER_PICKER_LIMIT,
): LinkOption[] {
  return [...ledger]
    .sort((a, b) => daysApart(a.date, chargeDate) - daysApart(b.date, chargeDate))
    .slice(0, limit)
    .map(l => ({
      value: l.id,
      label: `${l.date} · ${l.category} · ${formatCurrency(Math.abs(Number(l.amount)), false)}`,
    }));
}
