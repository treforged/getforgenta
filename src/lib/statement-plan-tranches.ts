// Turn the plan rows read off a statement into the card's balance tranches (ask baee397e).
//
// ⚠️ A CARD PLAN IS A TRANCHE, NOT A `payment_plans` ROW. The engine models a Chase Equal Pay or Pay
// Over Time plan as a 0% sub-balance of the card with its own instalment (see balance-tranches.ts).
// A `payment_plans` row on the same card counts the purchase a second time — measured 2026-10-01 on
// Tre's Prime Visa, where one did exactly that until it was switched off (ask 7ab8a42f).
//
// ⚠️ PROPOSE, NEVER DELETE. A tranche the statement no longer prints is reported as "not on this
// statement" and kept: a plan can be missing because it was paid off, or because the extraction
// missed a row, and only the person can tell which.

import type { BalanceTranche } from './balance-tranches';
import type { StatementPlan } from './statement-plans';
import type { TranchePayload } from './tranche-form';

export type PlanChangeStatus = 'new' | 'update' | 'unchanged';

export interface PlanChange {
  status: PlanChangeStatus;
  label: string;
  /** The tranche as it is now; null for a new plan. */
  before: BalanceTranche | null;
  after: BalanceTranche;
}

export interface PlanTrancheProposal {
  changes: PlanChange[];
  /** Existing plan-shaped tranches the statement did not print. Kept, only reported. */
  notOnStatement: BalanceTranche[];
  /** The full array to write if the person applies: every untouched tranche plus the changes. */
  next: BalanceTranche[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dollars(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Last instalment of a Pay Over Time plan: start month + total payments, on the card's due day. */
export function payOverTimeEndDate(startDate: string, totalPayments: number, dueDay: number | null): string {
  const [y, m, d] = startDate.split('-').map(Number);
  const idx = (m - 1) + totalPayments;
  const year = y + Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay ?? d, lastDay);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function titleWords(desc: string): string {
  return desc
    .replace(/#\s*\d+/g, '')
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function labelFor(plan: StatementPlan): string {
  if (plan.kind === 'equal_pay') {
    const [y, m] = (plan.endDate as string).split('-').map(Number);
    return `Equal Pay Promo (exp ${MONTHS[m - 1]} ${y}, orig ${dollars(plan.originalAmount)})`;
  }
  return `Pay Over Time - ${titleWords(plan.description)} (${plan.totalPayments} mo)`;
}

function isPlanTranche(t: BalanceTranche): boolean {
  return /equal pay|pay over time/i.test(t.label);
}

/** First two words of the merchant, lower-cased: enough to tell plans apart, tolerant of "#1649". */
function merchantKey(desc: string): string {
  return titleWords(desc).toLowerCase().split(' ').slice(0, 2).join(' ');
}

function findMatch(plan: StatementPlan, pool: BalanceTranche[], endDate: string): BalanceTranche | undefined {
  if (plan.kind === 'equal_pay') {
    const orig = dollars(plan.originalAmount);
    const byOrig = pool.find(t => /equal pay/i.test(t.label) && t.label.includes(orig));
    if (byOrig) return byOrig;
    // Only by date when the date is unambiguous: two promos can expire the same month.
    const byDate = pool.filter(t => /equal pay/i.test(t.label) && t.promo_end_date === endDate);
    return byDate.length === 1 ? byDate[0] : undefined;
  }
  const key = merchantKey(plan.description);
  return pool.find(t => /pay over time/i.test(t.label) && t.label.toLowerCase().includes(key));
}

function fromPlan(plan: StatementPlan, endDate: string, base: BalanceTranche | null, newId: () => string): BalanceTranche {
  return {
    id: base?.id ?? newId(),
    label: base?.label ?? labelFor(plan),
    balance: plan.remainingBalance,
    apr: 0,
    promo_end_date: endDate,
    min_payment: plan.monthlyPayment,
    monthly_fee: plan.monthlyFee,
    fixed_term: plan.kind === 'pay_over_time' ? true : (base?.fixed_term ?? false),
  };
}

function same(a: BalanceTranche, b: BalanceTranche): boolean {
  return a.balance === b.balance && a.apr === b.apr && a.promo_end_date === b.promo_end_date
    && (a.min_payment ?? null) === (b.min_payment ?? null)
    && (a.monthly_fee ?? null) === (b.monthly_fee ?? null)
    && Boolean(a.fixed_term) === Boolean(b.fixed_term);
}

/** The jsonb shape the column takes: absent rather than null, as the tranche editor writes it. */
export function toTranchePayload(t: BalanceTranche): TranchePayload {
  return {
    id: t.id,
    label: t.label,
    balance: t.balance,
    apr: t.apr,
    ...(t.promo_end_date ? { promo_end_date: t.promo_end_date } : {}),
    ...(t.min_payment ? { min_payment: t.min_payment } : {}),
    ...(t.monthly_fee ? { monthly_fee: t.monthly_fee } : {}),
    ...(t.fixed_term ? { fixed_term: true } : {}),
  };
}

export function proposePlanTranches(
  existing: readonly BalanceTranche[],
  plans: readonly StatementPlan[],
  dueDay: number | null,
  newId: () => string = () => crypto.randomUUID(),
): PlanTrancheProposal {
  const pool = existing.filter(isPlanTranche);
  const used = new Set<string>();
  const changes: PlanChange[] = [];

  for (const plan of plans) {
    const endDate = plan.kind === 'equal_pay'
      ? (plan.endDate as string)
      : payOverTimeEndDate(plan.startDate as string, plan.totalPayments as number, dueDay);
    const match = findMatch(plan, pool.filter(t => !used.has(t.id)), endDate) ?? null;
    if (match) used.add(match.id);
    const after = fromPlan(plan, endDate, match, newId);
    const status: PlanChangeStatus = !match ? 'new' : same(match, after) ? 'unchanged' : 'update';
    changes.push({ status, label: after.label, before: match, after });
  }

  const replaced = new Map(changes.filter(c => c.before).map(c => [c.before!.id, c.after]));
  const next = [
    ...existing.map(t => replaced.get(t.id) ?? t),
    ...changes.filter(c => c.status === 'new').map(c => c.after),
  ];
  return { changes, notOnStatement: pool.filter(t => !used.has(t.id)), next };
}
