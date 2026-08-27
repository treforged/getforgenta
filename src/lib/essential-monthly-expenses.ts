/**
 * What one month of KEEPING THE LIGHTS ON actually costs — the basis an emergency fund is sized in.
 *
 * ── WHY IT IS NOT `baseExpenses`, AND NOT `cashOut` ─────────────────────────
 * The two figures already in the codebase both answer a different question, and both were tried
 * first (2026-08-26) before this module existed:
 *
 *   • `forecast-engine`'s `baseExpenses` counts only rules paid FROM THE FUNDING ACCOUNT. On Tre's
 *     own rows that omits ~$700/mo of groceries, fuel, supplements, pet insurance and subscriptions
 *     because those are CHARGED TO A CARD. They are still bills; the card is a payment method, not
 *     a reason the money is optional. Sizing a runway off `baseExpenses` under-funds it by a fifth.
 *   • `monthly-expense-model`'s `cashOut` is the opposite error for this purpose: it is an OBSERVED
 *     month of transactions and it includes debt PRINCIPAL and savings contributions. A runway is
 *     what you must still pay when income stops, and aggressive card paydown is precisely what you
 *     would stop doing.
 *
 * ── THE BASIS, IN THE USER'S OWN WORDS ──────────────────────────────────────
 * Tre, 2026-08-26: *"bills and the debt payments which are recurring statement balance like
 * groceries, supplements, and fuel"*. So:
 *
 *     every active recurring EXPENSE rule, whether it is paid from checking or charged to a card
 *   + the vehicle loan payment
 *   + the vehicle insurance premium
 *   − anything paid from a DIFFERENT bank account (a business account), which never touches the
 *     user's cash and which the month drawer already labels "no cash impact"
 *   − revolving card PAYDOWN, which is not a rule and therefore never enters this sum at all
 *
 * ── WHY IT IS A MULTIPLIER TIMES THIS, NEVER A STORED DOLLAR FIGURE ─────────
 * The figure MOVES, and every way it moves matters to the user:
 *   • the car loan is in it and DISAPPEARS when the loan is paid off;
 *   • Tre's rent rule is $1,915 today and $1,480 after the move;
 *   • a rule added tomorrow is part of the runway tomorrow.
 * A goal that stored "$10,160" would be silently wrong within months. `savings_goals` therefore
 * stores the MULTIPLIER (3 months, 6 months) and the dollars are recomputed here every time —
 * which is also the only version of the feature that works for a customer who is not Tre.
 *
 * Pure: no database, no clock. The reference day arrives as an argument.
 */

import { countRuleOccurrencesInMonth } from './scheduling';
import { getTotalCarLoanMonthly } from './vehicle-loan-engine';
import type { CarFund } from './types';

/** The `recurring_rules` columns this reads. Structurally satisfied by a rule row. */
export type EssentialRule = {
  active?: boolean | null;
  rule_type?: string | null;
  amount?: number | string | null;
  frequency?: string | null;
  due_day?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  /** Bare account id or `account:<id>`, matching how the app stores a payment source. */
  payment_source?: string | null;
};

/** The `accounts` columns this reads. Structurally satisfied by an account row. */
export type EssentialAccount = {
  id: string;
  account_type?: string | null;
  active?: boolean | null;
};

export type EssentialMonthlyExpensesParams = {
  rules: readonly EssentialRule[];
  accounts: readonly EssentialAccount[];
  carFunds: readonly CarFund[];
  /**
   * The account the user's cash actually lives in. A rule paid from ANY OTHER bank account is
   * excluded — that is the "no cash impact" rule the forecast's month drawer already applies.
   *
   * ⚠️ NULL MEANS "DO NOT EXCLUDE ANYTHING". Without a funding account there is no way to tell a
   * business account from the user's own, and dropping every sourced rule would under-report the
   * runway — the direction that leaves someone short. Over-reporting is the safe error here.
   */
  fundingAccountId?: string | null;
  /** The day the figure is computed for. Its month is the first of the window averaged. */
  asOf?: Date;
  /**
   * How many months to average over. Twelve by default, and the default is doing real work: a
   * weekly rule falls 4 times in most months and 5 in some, an annual rule is already spread by
   * `countRuleOccurrencesInMonth`, and a single month would hand back whichever of those the
   * calendar happened to produce.
   */
  months?: number;
};

/** Half a cent. Below this a figure is rounding noise, not money. */
const CENT = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Credit-card ids in BOTH the bare and `account:`-prefixed forms.
 *
 * Mirrors `forecast-engine`'s `ccPaymentSourcesForOtherAcct` deliberately: a card-sourced rule is
 * NOT an "other account" expense there, and it is NOT excluded here, for the same reason. The two
 * have to agree about what a card is or the runway and the drawer would describe different months.
 */
function creditCardSourceIds(accounts: readonly EssentialAccount[]): Set<string> {
  const ids = new Set<string>();
  for (const a of accounts) {
    if (a.active === false) continue;
    if (a.account_type !== 'credit_card') continue;
    ids.add(a.id);
    ids.add(`account:${a.id}`);
  }
  return ids;
}

/**
 * Whether one rule's cost is part of the runway.
 *
 * Exported because the decision, not the arithmetic, is the part a reader will want to check
 * against their own rows — and because a test that pins the rule one row at a time is worth more
 * than one that pins a total.
 */
export function isEssentialExpenseRule(
  rule: EssentialRule,
  cardSourceIds: ReadonlySet<string>,
  fundingAccountId: string | null,
): boolean {
  if (rule.active === false) return false;
  if (rule.rule_type !== 'expense') return false;
  // No source recorded ⇒ the funding account, which is how every other reader treats it.
  if (!rule.payment_source) return true;
  // Charged to a card. Still a bill: the card is how it is paid, not a reason it is optional.
  if (cardSourceIds.has(rule.payment_source)) return true;
  if (!fundingAccountId) return true;
  return rule.payment_source.replace(/^account:/, '') === fundingAccountId;
}

/**
 * One month of essential cost, averaged across the window.
 *
 * Returns 0 rather than a guess when there is nothing to measure — a runway nobody can source is
 * exactly the confident number this codebase refuses to print.
 */
export function computeEssentialMonthlyExpenses(p: EssentialMonthlyExpensesParams): number {
  const {
    rules, accounts, carFunds,
    fundingAccountId = null, asOf = new Date(), months = 12,
  } = p;

  const windowMonths = Number.isFinite(months) && months >= 1 ? Math.floor(months) : 1;
  const cardSourceIds = creditCardSourceIds(accounts);
  const essential = rules.filter(r => isEssentialExpenseRule(r, cardSourceIds, fundingAccountId));

  let total = 0;
  for (let i = 0; i < windowMonths; i++) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() + i, 1);

    for (const r of essential) {
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const occurrences = countRuleOccurrencesInMonth(
        {
          frequency: String(r.frequency ?? 'monthly'),
          due_day: r.due_day ?? null,
          start_date: r.start_date ?? null,
          end_date: r.end_date ?? null,
          created_at: r.created_at ?? null,
        },
        d.getFullYear(), d.getMonth(), asOf,
      );
      total += amount * occurrences;
    }

    // The vehicle loan and its insurance are cash out every month the car is owned, and neither is
    // a recurring rule — the engine carries both as their own terms. Passing the month's own date
    // is what makes the figure fall when a loan is paid off inside the window.
    total += getTotalCarLoanMonthly(carFunds as CarFund[], d);
    for (const cf of carFunds) {
      if (cf.phase !== 'loan') continue;
      const premium = Number(cf.monthly_insurance);
      if (!Number.isFinite(premium) || premium <= 0) continue;
      const startStr = cf.insurance_start_date ?? cf.payment_start_date;
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      if (startStr && new Date(startStr + 'T00:00:00') > monthEnd) continue;
      total += premium;
    }
  }

  const avg = total / windowMonths;
  return avg < CENT ? 0 : round2(avg);
}
