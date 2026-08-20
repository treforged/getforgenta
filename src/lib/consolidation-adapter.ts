// The bridge between what the database stores and what `consolidation.ts` asks for.
//
// WHY THIS FILE EXISTS. `consolidation.ts` is deliberately pure and narrow: it speaks
// `ConsolidationCard` and `ScheduledCardCharge` and knows nothing about supabase rows, account
// types, or plan frequencies. That is what makes it testable against Discover's own printed
// payment table. Everything ugly about the real data — string-typed numerics, `account_type`
// filtering, a `payment_source` that is sometimes `account:<id>` and sometimes `<id>`, plans
// measured in weeks rather than months — lives here instead.
//
// ⚠️ THE ONE RULE THAT MATTERS: `plan_type = 'upfront'` IS ALREADY IN THE CARD BALANCE.
// An upfront plan (Chase Plan It style) charged the whole purchase to the card on day one and is
// being repaid in instalments; the card's `balance` already carries it. Counting it again as a
// future charge would inflate the loan the sizing solver asks for by the full remaining principal
// of every such plan. Only `monthly_charge` (BNPL/Amazon style, where each instalment is a NEW
// charge that has not hit the card yet) is a future charge.
//
// ⚠️ SECOND RULE: a card whose `card_start_date` is in the future is NOT OPEN, and its limit is not
// drawable credit. This module passes `startDate` straight through and lets `summarizeUtilization`
// (via `consolidation.ts`) be the single place that decides. It is the difference between a
// reported 41.5% and the real 74.1%, and it must never be re-derived here.

import { parseTranches } from './balance-tranches';
import { normalizePaymentSource } from './transaction-matching';
import { getPaymentDates, type PaymentPlanFrequency } from './payment-plan-generator';
import type { ConsolidationCard, ScheduledCardCharge } from './consolidation';

/**
 * The `accounts` columns this reads.
 *
 * Declared structurally rather than as a `Pick<Tables<'accounts'>, …>` so a raw supabase row
 * satisfies it without a cast, the way `ObligationPlan` in `charge-obligations.ts` does. Numerics
 * are widened to `number | string` because postgres `numeric` arrives as a string through PostgREST
 * on some column configurations and every consumer in this repo coerces defensively.
 */
export interface ConsolidationAccountRow {
  id: string;
  name: string;
  account_type: string;
  active: boolean;
  balance: number | string;
  credit_limit?: number | string | null;
  apr?: number | string | null;
  min_payment?: number | string | null;
  card_start_date?: string | null;
  balance_tranches?: unknown;
}

/**
 * The `payment_plans` columns this reads. Same structural-typing reasoning as above; `frequency`
 * and `plan_type` are `string` on the generated table type and unions on `PaymentPlan`.
 */
export interface ConsolidationPlanRow {
  id: string;
  name: string;
  active: boolean;
  plan_type: string;
  frequency: string;
  /** `YYYY-MM-DD`. */
  start_date: string;
  payment_amount: number | string;
  total_payments: number | string;
  payment_source: string | null;
}

const PLAN_FREQUENCIES = new Set<string>(['weekly', 'biweekly', 'monthly']);

function num(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
}

/** `YYYY-MM` of a `YYYY-MM-DD`, for counting the calendar months a schedule actually spans. */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Active credit-card accounts, in the shape the consolidation engine wants.
 *
 * Cards with no limit AND no balance are dropped — a $0/$0 row contributes nothing to either the
 * interest answer or the utilization answer, and leaving it in only adds a null-utilization line to
 * every per-card table. A card with a balance and no limit is KEPT: it still costs interest, and
 * `summarizeUtilization` already handles a zero limit without dividing by it.
 */
export function consolidationCards(
  accounts: readonly ConsolidationAccountRow[],
): ConsolidationCard[] {
  return accounts
    .filter(a => a.active && a.account_type === 'credit_card')
    .map(a => {
      const balance = num(a.balance);
      const creditLimit = num(a.credit_limit);
      const minPayment = num(a.min_payment);
      return {
        id: a.id,
        name: a.name,
        balance,
        creditLimit,
        apr: num(a.apr),
        // parseTranches drops anything malformed, so a card with unusable `balance_tranches` gets
        // [] and the engine takes its single-APR path — the same contract credit-card-engine relies on.
        tranches: parseTranches(a.balance_tranches),
        startDate: a.card_start_date ?? null,
        ...(minPayment > 0 ? { minPayment } : {}),
      } satisfies ConsolidationCard;
    })
    .filter(c => c.balance > 0 || c.creditLimit > 0);
}

export interface ScheduledChargeOptions {
  /** `YYYY-MM-DD`. Instalments dated before this have already landed and are in the balance. */
  asOf: string;
  /**
   * Plan ids the user has said they will repoint at checking. They still appear in the result — the
   * surface should show what repointing buys — but with `landsOnCard: false`, which is free in the
   * sizing solver. Borrowing to cover a Pay-in-4 you could simply pay from cash is not.
   */
  repointedPlanIds?: readonly string[];
}

/**
 * Committed future charges that will land on one of `cards`, from `payment_plans`.
 *
 * Only `monthly_charge` plans qualify (see the file header). A plan is matched to a card by
 * `payment_source`, which `normalizePaymentSource` strips of its optional `account:` prefix — the
 * two forms are both live in this database and comparing raw strings misses half of them.
 *
 * WEEKLY AND BIWEEKLY PLANS ARE CONVERTED, NOT REJECTED. The engine's `ScheduledCardCharge` is
 * monthly, so a biweekly plan is expressed as its remaining total spread over the calendar months
 * it actually spans. The TOTAL is preserved exactly, which is the number the utilization ceiling
 * turns on; only its distribution within those months is smoothed, and the engine reads the worst
 * point after every charge has landed, not any single month.
 */
export function scheduledCardCharges(
  plans: readonly ConsolidationPlanRow[],
  cards: readonly ConsolidationCard[],
  opts: ScheduledChargeOptions,
): ScheduledCardCharge[] {
  const cardIds = new Set(cards.map(c => c.id));
  const repointed = new Set(opts.repointedPlanIds ?? []);
  const out: ScheduledCardCharge[] = [];

  for (const plan of plans) {
    if (!plan.active) continue;
    // The whole point of the header warning. `upfront` is already in the card's balance.
    if (plan.plan_type !== 'monthly_charge') continue;
    if (!PLAN_FREQUENCIES.has(plan.frequency)) continue;

    const cardId = normalizePaymentSource(plan.payment_source);
    if (!cardId || !cardIds.has(cardId)) continue;

    const totalPayments = Math.max(0, Math.floor(num(plan.total_payments)));
    const perPayment = num(plan.payment_amount);
    if (totalPayments <= 0 || perPayment <= 0) continue;

    const remaining = getPaymentDates(
      plan.start_date,
      plan.frequency as PaymentPlanFrequency,
      totalPayments,
    ).filter(d => d >= opts.asOf);
    if (remaining.length === 0) continue;

    const monthsRemaining = new Set(remaining.map(monthKey)).size;
    const remainingTotal = perPayment * remaining.length;

    out.push({
      label: plan.name,
      cardId,
      amountPerMonth: remainingTotal / monthsRemaining,
      monthsRemaining,
      landsOnCard: !repointed.has(plan.id),
    });
  }

  return out;
}

/** Total still committed to land on cards, for the "this is why a clean payoff does not stay clean" line. */
export function totalScheduledCharges(charges: readonly ScheduledCardCharge[]): number {
  return charges
    .filter(c => c.landsOnCard !== false)
    .reduce((s, c) => s + c.amountPerMonth * c.monthsRemaining, 0);
}
