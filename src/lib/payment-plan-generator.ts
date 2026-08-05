import type { EnrichedTransaction } from './pay-schedule';
import { isCapturedInBalance } from './sync-cutoff';

export type PaymentPlanFrequency = 'weekly' | 'biweekly' | 'monthly';

export type PaymentPlan = {
  id: string;
  user_id: string;
  name: string;
  provider: string | null;
  total_amount: number;
  payment_amount: number;
  frequency: PaymentPlanFrequency;
  start_date: string; // YYYY-MM-DD
  total_payments: number;
  category: string;
  payment_source: string | null;
  /** 'upfront' = full amount charged to card day 1, paid monthly (Chase Plan It style).
   *  'monthly_charge' = fixed amount hits card each month (BNPL/Amazon style). */
  plan_type: 'upfront' | 'monthly_charge';
  notes: string | null;
  active: boolean;
  created_at: string;
};

export function getPaymentDates(startDate: string, frequency: PaymentPlanFrequency, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate + 'T00:00:00');
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().split('T')[0]);
    if (frequency === 'weekly') {
      d.setDate(d.getDate() + 7);
    } else if (frequency === 'biweekly') {
      d.setDate(d.getDate() + 14);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
  }
  return dates;
}

/**
 * Payment due dates for an 'upfront' plan charged to a CREDIT CARD.
 *
 * The purchase hits the card on start_date, but no installment is due then — the purchase
 * belongs to the statement period it was made in, and its first installment lands on the
 * card's due date of the FOLLOWING statement, i.e. not the upcoming due date after the
 * purchase but the one after that. Example: purchased Jun 23, card due day 7 → the upcoming
 * Jul 7 due date belongs to the statement that already closed, so the first installment is
 * due Aug 7, then monthly on the 7th. Anchoring these to start_date instead (what plain
 * getPaymentDates does) counts installments as paid ~2 cycles early, which understates the
 * card's 0% installment carve-out and leaks plan principal into the revolving balance —
 * where the avalanche then "pays it off" at a phantom high APR.
 *
 * Falls back to the plain start_date-anchored stream when the card has no due day on file
 * or the plan isn't monthly (card installment plans bill per statement cycle = monthly;
 * weekly/biweekly plans here would mean the data is really BNPL-style and date-literal).
 */
export function getUpfrontCardPlanDates(plan: PaymentPlan, cardDueDay: number | null | undefined): string[] {
  if (!cardDueDay || plan.frequency !== 'monthly') {
    return getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
  }
  const start = new Date(plan.start_date + 'T00:00:00');
  // First occurrence of the card's due day strictly after the purchase…
  const y = start.getFullYear();
  let mo = start.getMonth();
  if (start.getDate() >= cardDueDay) mo += 1;
  // …belongs to the already-closed statement — skip it; first installment is the one after.
  mo += 1;
  const dates: string[] = [];
  for (let i = 0; i < plan.total_payments; i++) {
    const daysInMonth = new Date(y, mo + i + 1, 0).getDate();
    const d = new Date(y, mo + i, Math.min(cardDueDay, daysInMonth));
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
}

/**
 * getPlanProgress for a card-charged 'upfront' plan, using the due-date-anchored stream
 * above. `asOf` (default today) counts an installment as paid once its due date has passed —
 * a paid installment is already reflected in the card's live balance, so callers deriving
 * the remaining 0% carve-out (installmentBalance) must not count it again.
 */
export function getUpfrontPlanProgress(
  plan: PaymentPlan,
  cardDueDay: number | null | undefined,
  asOf?: string,
): { paid: number; remaining: number; endDate: string; dates: string[] } {
  const cutoff = asOf ?? new Date().toISOString().split('T')[0];
  const dates = getUpfrontCardPlanDates(plan, cardDueDay);
  const paid = dates.filter(d => d <= cutoff).length;
  const endDate = dates[dates.length - 1] ?? plan.start_date;
  return { paid, remaining: plan.total_payments - paid, endDate, dates };
}

export function getNextPaymentDate(plan: PaymentPlan): string | null {
  const today = new Date().toISOString().split('T')[0];
  const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
  return dates.find(d => d >= today) ?? null;
}

/**
 * A plan is "active" for display purposes only while it still owes installments.
 *
 * `plan.active` is a stored flag the user toggles; nothing writes it back to false when the last
 * installment date passes, so a fully-paid plan (4/4, $0 remaining) stays `active: true` forever
 * and inflates the "N active" count. Completion is derived from the payment schedule, so derive
 * it here rather than depending on a write-back that does not exist.
 */
export function isPlanInProgress(plan: PaymentPlan, asOf?: string): boolean {
  return plan.active && getPlanProgress(plan, asOf).remaining > 0;
}

export function getPlanProgress(plan: PaymentPlan, asOf?: string): { paid: number; remaining: number; endDate: string } {
  const today = asOf ?? new Date().toISOString().split('T')[0];
  const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
  const paid = dates.filter(d => d < today).length;
  const endDate = dates[dates.length - 1] ?? plan.start_date;
  return { paid, remaining: plan.total_payments - paid, endDate };
}

export function getMonthlyPlanCashExpenses(
  plans: PaymentPlan[],
  year: number,
  month: number,
  ccAccountIds: Set<string>,
  afterDate?: string,
): number {
  let total = 0;
  for (const plan of plans) {
    if (!plan.active) continue;
    if (plan.payment_source && ccAccountIds.has(plan.payment_source)) continue;
    const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
    for (const date of dates) {
      if (afterDate && date <= afterDate) continue;
      const d = new Date(date + 'T00:00:00');
      if (d.getFullYear() === year && d.getMonth() === month) {
        total += plan.payment_amount;
      }
    }
  }
  return total;
}

/** Minimal card shape deriveUpfrontPlanFields needs — structurally satisfied by CardData. */
export type UpfrontPlanCard = { id: string; balance: number; dueDay?: number | null };

/**
 * Everything the simulation layer needs to model card-charged 'upfront' plans, derived in ONE
 * place so Forecast (useCardProjection) and the Debt Payoff engine component compute identical
 * numbers — these two previously derived plan fields independently (or not at all), which was
 * a root cause of the tabs disagreeing about the same card.
 *
 * - installmentByCard: remaining 0% principal (due-date-anchored, so nothing counts as paid
 *   before its real first due date) + flat monthly payment total, per card. The balance is
 *   capped at the card's live balance (the user may have entered a plan larger than the charge).
 * - upfrontPayByMonth[m][cardId]: the installment cash actually DUE in projection month m —
 *   $0 in months before the first real due date, which is exactly what start_date anchoring
 *   got wrong. Dates on/before syncCutoffDate are excluded (already reflected in live balances).
 */
export function deriveUpfrontPlanFields(
  cards: UpfrontPlanCard[],
  plans: PaymentPlan[],
  projectionMonths: number,
  now: Date,
  syncCutoffDate?: string,
): {
  installmentByCard: Map<string, { balance: number; monthlyPayment: number }>;
  upfrontPayByMonth: { [cardId: string]: number }[];
} {
  const cutoff = syncCutoffDate ?? now.toISOString().split('T')[0];
  const sourceToCardId = new Map<string, UpfrontPlanCard>(
    cards.flatMap(c => [[c.id, c], [`account:${c.id}`, c]] as [string, UpfrontPlanCard][]),
  );
  const installmentByCard = new Map<string, { balance: number; monthlyPayment: number }>();
  const upfrontPayByMonth: { [cardId: string]: number }[] =
    Array.from({ length: projectionMonths }, () => ({}));

  for (const plan of plans) {
    if (!plan.active || plan.plan_type !== 'upfront' || !plan.payment_source) continue;
    const card = sourceToCardId.get(plan.payment_source);
    if (!card) continue;

    const { remaining, dates } = getUpfrontPlanProgress(plan, card.dueDay, cutoff);
    const prev = installmentByCard.get(card.id) ?? { balance: 0, monthlyPayment: 0 };
    installmentByCard.set(card.id, {
      balance: Math.round((prev.balance + Math.max(0, remaining * plan.payment_amount)) * 100) / 100,
      monthlyPayment: Math.round((prev.monthlyPayment + plan.payment_amount) * 100) / 100,
    });

    for (const date of dates) {
      // §1.1 cause C sweep: this is the installment CASH gate — "has this payment already left
      // the funding account?" — so it uses the shared `isCapturedInBalance` rule and inherits the
      // settlement lag. An installment due in the last few days may have posted without settling,
      // and `balances.current` excludes pending debits, so it stays charged in month 0 rather than
      // being assumed gone. Prior-month dates are still dropped by the `mi < 0` guard below.
      //
      // Deliberately NOT applied to `getUpfrontPlanProgress` above: that counts how many
      // installments have been PAID, to size the remaining 0% principal on the CARD. That is a
      // credit-card-balance question against a different basis, not a funding-cash question, so
      // the outflow lag does not belong there.
      if (isCapturedInBalance(date, cutoff)) continue;
      const pd = new Date(date + 'T00:00:00');
      const mi = (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth());
      if (mi < 0 || mi >= projectionMonths) continue;
      upfrontPayByMonth[mi][card.id] =
        Math.round(((upfrontPayByMonth[mi][card.id] ?? 0) + plan.payment_amount) * 100) / 100;
    }
  }

  // Cap each card's carve-out at its live balance AFTER summing all its plans.
  for (const [cardId, v] of installmentByCard) {
    const card = cards.find(c => c.id === cardId);
    if (card) installmentByCard.set(cardId, { ...v, balance: Math.min(v.balance, card.balance) });
  }

  return { installmentByCard, upfrontPayByMonth };
}

export type PlanTransaction = EnrichedTransaction & { planId: string; paymentIndex: number };

export function generatePaymentPlanTransactions(plans: PaymentPlan[]): PlanTransaction[] {
  const results: PlanTransaction[] = [];
  for (const plan of plans) {
    if (!plan.active) continue;
    const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
    dates.forEach((date, i) => {
      results.push({
        id: `plan:${plan.id}:${i}`,
        date,
        type: 'expense',
        amount: plan.payment_amount,
        category: plan.category,
        note: `${plan.name} (${i + 1}/${plan.total_payments})`,
        payment_source: plan.payment_source ?? '',
        account: '',
        isGenerated: true,
        isPlanPayment: true,
        planId: plan.id,
        paymentIndex: i,
      });
    });
  }
  return results;
}
