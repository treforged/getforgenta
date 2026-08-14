import { formatCurrency } from './calculations';
import {
  PayScheduleConfig, getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay,
  getRemainingIncomeByDay, getRemainingExpensesByDay, getRemainingNonPaycheckIncomeByDay,
  buildPayConfig, getPrePaycheckNextMonthBills, getMonthNetIncome,
  type EnrichedTransaction,
} from './pay-schedule';
import type { ConfirmedOccurrences } from './confirmed-capture';
import { countRuleOccurrencesInMonth, PROJECTION_MONTHS } from './scheduling';
import { FLOOR_CUSHION_DOLLARS } from './floor-protection';
import { isCapturedInBalance, dueDateInMonth } from './sync-cutoff';
import { cardStartMonthOffset } from './card-start-date';
import {
  parseTranches, trancheInterestBreakdown, allocatePaymentAcrossTranches,
  type BalanceTranche,
} from './balance-tranches';
import type { AccountRow, RuleRow, DebtRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';
// Re-exported so every file that already imports from credit-card-engine.ts (the bulk of the
// debt/forecast surface) gets this without needing a second import line — scheduling.ts is the
// canonical source since it has zero internal dependencies, avoiding a circular import (this
// file already imports countRuleOccurrencesInMonth from it).
export { PROJECTION_MONTHS } from './scheduling';

export type CardData = {
  id: string;
  name: string;
  balance: number;
  apr: number;
  creditLimit: number;
  minPayment: number;
  /** True when the user marked min_payment as manually set (accounts.min_payment_is_manual):
   * minPayment is then honored EXACTLY — including $0 (e.g. a card whose whole balance sits on
   * 0% payment plans with nothing due) — with no 2%-formula or $25-floor fallback anywhere. */
  minPaymentIsManual?: boolean;
  targetPayment: number;
  monthlyNewPurchases: number;
  /**
   * The same recurring-spend estimate as monthlyNewPurchases, but with each rule counted in the
   * first month it is actually ACTIVE instead of strictly next month. monthlyNewPurchases reads
   * 0 for a rule whose start_date is still in the future (countRuleOccurrencesInMonth returns 0
   * before start_date), so a card whose only spend is future-dated shows $0/mo for the whole
   * horizon (N11 — a card opening next year with groceries routed to it from a later date).
   * DISPLAY ONLY: the simulation keeps monthlyNewPurchases, so months before a rule starts are
   * never charged its steady amount. Equal to monthlyNewPurchases when no rule is future-dated.
   */
  steadyMonthlyPurchases?: number;
  monthlyRepayments: number;
  color: string;
  paymentPreference: 'statement' | 'full' | null;
  autopayFullBalance: boolean;
  dueDay: number | null;
  startDate?: string;
  statementBalancePhase: boolean;
  statementBalance: number | null;
  /** Remaining interest-free installment plan balance on this card (0 = none). */
  installmentBalance?: number;
  /** Fixed monthly payment required by the installment plan (0 = none). */
  installmentMonthlyPayment?: number;
  /**
   * True when this card's current-month due date is on/before the Plaid sync cutoff — the cycle's
   * minimum was already paid (the live balance reflects it), so month 0 must not force the
   * revolving minimum again; the next obligation lands in month 1. Extra/optional paydown in
   * month 0 is unaffected. See m0MinDueSettled.
   */
  m0MinSettled?: boolean;
  /**
   * Sub-balances carrying their OWN rates (accounts.balance_tranches — see balance-tranches.ts for
   * the shape and the real case that motivated it). `apr` above stays the STANDARD rate: what the
   * untranched remainder pays, and what a tranche reprices to when its promo_end_date passes.
   *
   * Absent or empty = single-APR card = the pre-tranche engine, to the cent (the parity rule —
   * every tranche-aware helper short-circuits back to the original expression on this path).
   */
  tranches?: BalanceTranche[];
};

export type CardMonthRow = {
  month: number;
  label: string;
  startBalance: number;
  newPurchases: number;
  interest: number;
  payment: number;
  endBalance: number;
  utilization: number;
};

export type CardProjection = {
  card: CardData;
  months: CardMonthRow[];
  payoffMonth: number | null;
  totalInterest: number;
  projectedInterestThisMonth: number;
  recommendedPayment: number;
  utilizationNow: number;
};

export type PayoffRecommendation = {
  cardId: string;
  cardName: string;
  color: string;
  payment: number;
  isMinimumOnly: boolean;
  reason: string;
  estimatedLiquidCash?: number;
  dueDay?: number | null;
};

export type RecommendationSummary = {
  totalAvailableCash: number;
  totalMinimumsdue: number;
  extraCashAvailable: number;
  recommendations: PayoffRecommendation[];
  interestAvoided: number;
  projectedPayoffMonths: number;
  utilizationMilestones: { threshold: number; month: number | null }[];
  cashWarning: boolean;
  strategyLabel: string;
  recommendedSafeMinimum: number;
  userCashFloor: number;
  prePaycheckBills: number;
  breakdown: {
    fundingBalance: number;
    remainingPaycheckIncome: number;
    remainingNonPaycheckIncome: number;
    remainingOneTimeIncome: number;
    remainingExpenses: number;
    remainingOneTimeExpenses: number;
    safeMinimum: number;
    autopayTotal: number;
  };
};

const CARD_COLORS = [
  'hsl(200, 70%, 55%)', 'hsl(280, 55%, 55%)', 'hsl(340, 65%, 50%)',
  'hsl(160, 55%, 45%)', 'hsl(30, 70%, 50%)', 'hsl(60, 55%, 50%)',
];

export const CC_DEFAULT_CATEGORIES = new Set([
  'Groceries', 'Subscriptions', 'Pets', 'Dining', 'Gas', 'Entertainment',
  'Travel', 'Shopping', 'Miscellaneous', 'Other', 'Personal', 'Clothing',
  'Health', 'Fitness', 'Gifts', 'Education',
]);

export const BANK_DEFAULT_CATEGORIES = new Set([
  'Bills', 'Rent', 'Mortgage', 'Utilities', 'Internet', 'Insurance',
  'Debt Payments', 'Transfers', 'Investing', 'Savings',
]);

export function getCardColor(index: number): string {
  return CARD_COLORS[index % CARD_COLORS.length];
}

/**
 * Total credit limit actually open at month `m` of a projection. A card joins
 * the denominator from its start month, never before — an unopened card's limit
 * is not credit the user can draw on.
 */
export function openCreditLimitAtMonth(
  cards: { creditLimit: number; startMonth: number }[],
  m: number,
): number {
  return cards.reduce((s, c) => (c.startMonth <= m ? s + c.creditLimit : s), 0);
}

export function calcMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  return Math.max(25, Math.round(balance * (1 + apr / 1200) * 0.02 * 100) / 100);
}

/**
 * The minimum that must actually be paid toward a card's REVOLVING balance this month.
 *
 * A card's real contract minimum (accounts.min_payment, Plaid-synced or user-entered — surfaced as
 * card.minPayment) is frequently HIGHER than the 2%-of-balance formula once the balance has been
 * paid down (e.g. Discover: $229 contract min vs ~$46 formula at a $2,300 balance). The simulation
 * must honor whichever is greater so a card is never throttled below what the lender actually
 * requires, dragging its real payoff out by months. Bounded above by revOwed so the last payment
 * never overshoots the balance.
 *
 * card.minPayment is the card's TOTAL stated minimum; when the card carries a 0%-installment plan
 * that plan's monthly payment is handled separately (installmentPayByCard / installmentCashCost),
 * so subtract it here to get the revolving-only portion of the contract minimum and avoid
 * double-counting the installment against the revolving cascade.
 *
 * This is the payment/reservation layer only — the pre-paycheck cash floor deliberately stays on
 * the plain calcMinPayment formula (see getAugmentedMinSafeCash / perCardMinPayments): reserving
 * the higher contract min in the floor would inflate min-safe-cash dollar-for-dollar and starve the
 * surplus that pays debt down, which is exactly what we're trying to avoid.
 */
export function revolvingMinDue(card: CardData, revOwed: number): number {
  if (revOwed <= 0) return 0;
  const contractRevMin = Math.max(0, (card.minPayment ?? 0) - (card.installmentMonthlyPayment ?? 0));
  // Manual minimums are exact by definition — the user (or a $0 Plaid liability they confirmed)
  // says this IS what's due, so the formula must never re-inflate it (manual $0 stays $0).
  if (card.minPaymentIsManual) return Math.min(contractRevMin, revOwed);
  return Math.min(Math.max(contractRevMin, calcMinPayment(revOwed, card.apr)), revOwed);
}

// ─── Multi-rate cards (balance tranches) ──────────────────────────────────────────────────────
//
// A card can hold sub-balances at DIFFERENT rates, and a promo rate can EXPIRE (the real case:
// Discover's $5,037.73 at 7.99% until 2028-01-04 against a 16.6% standard rate). The engine walks
// a per-card LEDGER of tranche balances alongside its own `balances` walk: the tranche sum is a
// decomposition of the card's revolving balance, and the untranched REMAINDER — new purchases,
// remainder interest, anything the ledger doesn't claim — is implicit (balance minus tranche sum)
// and pays the standard rate. Allocation is balance-tranches.ts's own CARD Act §164 allocator;
// this file must never grow a second one.
//
// THE PARITY RULE: a card with no tranches must produce numbers identical to the pre-tranche
// engine, to the cent. Every helper below therefore short-circuits an empty ledger back to the
// ORIGINAL expression rather than routing through the (mathematically equal, but
// float-associativity-different) breakdown path.

/** Local YYYY-MM-DD. Deliberately not toISOString(), which shifts the day in +UTC zones. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The date a projection month is judged at for repricing: its LAST day. A promo expiring anywhere
 * inside a month therefore reprices for that whole month — the conservative direction, and it puts
 * the interest step-up in the month it actually happens rather than a month late.
 */
export function monthEndAsOf(from: Date, offset: number): string {
  return isoDay(new Date(from.getFullYear(), from.getMonth() + offset + 1, 0));
}

/** A ledger entry paired with its index in card.tranches, so results map back unambiguously. */
interface LiveTranche { index: number; tranche: BalanceTranche }

/**
 * The card's tranches carrying their LIVE ledger balances, exhausted ones dropped.
 *
 * Two deliberate details. Ids are replaced with positional ones (`t0`, `t1`, …) because
 * accounts.balance_tranches ids are free text and may be blank or duplicated, while
 * allocatePaymentAcrossTranches returns its result keyed by id. And zero-balance entries are
 * dropped BEFORE the module sees them: trancheInterestBreakdown skips zero-usable lines, so a
 * zero entry in the middle would shift every later line out of alignment with its tranche.
 * (Clamping against a too-small balance is safe — it only ever zeroes a SUFFIX, so the surviving
 * lines stay a prefix of this array.)
 */
function liveTranches(card: CardData, bals: readonly number[]): LiveTranche[] {
  const defs = card.tranches;
  if (!defs || defs.length === 0) return [];
  const out: LiveTranche[] = [];
  for (let i = 0; i < defs.length; i++) {
    const balance = bals[i] ?? 0;
    if (balance <= 0.005) continue;
    out.push({ index: i, tranche: { ...defs[i], id: `t${i}`, balance } });
  }
  return out;
}

/**
 * One month's interest on a card's revolving balance, per tranche at its own rate (repriced to the
 * standard rate once its promo_end_date has passed as of `asOf`) plus the remainder at the
 * standard rate.
 *
 * `total` is the card's charge; `lineInterest` (index-aligned with card.tranches) is what to accrue
 * into the ledger so a promo tranche compounds at its own rate. They can disagree by a cent —
 * `total` rounds the sum, `lineInterest` rounds each line — and that cent lands in the implicit
 * remainder, which is where standard-rate money belongs anyway.
 */
export function trancheInterestFor(
  card: CardData, bals: readonly number[], revBal: number, asOf: string,
): { total: number; lineInterest: number[] } {
  const zeros = (card.tranches ?? []).map(() => 0);
  if (revBal <= 0) return { total: 0, lineInterest: zeros };
  const live = liveTranches(card, bals);
  // PARITY: the original single-APR expression, character for character.
  if (live.length === 0) {
    return { total: Math.round(revBal * (card.apr / 100 / 12) * 100) / 100, lineInterest: zeros };
  }
  const breakdown = trancheInterestBreakdown(revBal, live.map(l => l.tranche), card.apr, asOf);
  const lineInterest = [...zeros];
  breakdown.lines.forEach((line, i) => {
    const idx = live[i]?.index;
    if (idx !== undefined) lineInterest[idx] = Math.round(line.monthlyInterest * 100) / 100;
  });
  return { total: Math.round(breakdown.totalMonthlyInterest * 100) / 100, lineInterest };
}

/**
 * The rate the NEXT dollar paid to this card actually saves. Payment goes to the highest-APR
 * bucket first (CARD Act §164), so on a multi-rate card the marginal rate is the highest rate among
 * the OUTSTANDING buckets as of `asOf` — which can sit far above the account's standard APR, and is
 * what avalanche ordering has to compare. No tranches ⇒ exactly card.apr, so single-rate cards
 * never reorder.
 */
export function marginalApr(
  card: CardData, bals: readonly number[], revBal: number, asOf: string,
): number {
  const live = liveTranches(card, bals);
  if (live.length === 0 || revBal <= 0) return card.apr;
  const breakdown = trancheInterestBreakdown(revBal, live.map(l => l.tranche), card.apr, asOf);
  let max = breakdown.remainderBalance > 0.005 ? card.apr : -Infinity;
  for (const line of breakdown.lines) max = Math.max(max, line.apr);
  return isFinite(max) ? max : card.apr;
}

/**
 * Apply a revolving payment to the ledger and return a NEW ledger. The allocation itself is
 * balance-tranches.ts's allocatePaymentAcrossTranches (CARD Act §164, rates resolved as of `asOf`);
 * this only maps its result back onto the ledger. `revBal` is the post-interest, pre-payment
 * revolving balance the payment is made against.
 */
export function applyTranchePayment(
  card: CardData, bals: readonly number[], revBal: number, payment: number, asOf: string,
): number[] {
  const next = [...bals];
  const live = liveTranches(card, bals);
  if (live.length === 0 || payment <= 0) return next;
  const alloc = allocatePaymentAcrossTranches(
    payment, revBal, live.map(l => l.tranche), card.apr, asOf,
  );
  for (const l of live) {
    const paid = alloc.get(l.tranche.id) ?? 0;
    if (paid <= 0) continue;
    next[l.index] = Math.max(0, Math.round((next[l.index] - paid) * 100) / 100);
  }
  return next;
}

/**
 * Clamp the ledger to a revolving balance, in LISTED order — balance-tranches.ts's own rule that
 * the honest reading of tranches summing past the balance is that the later entries are stale.
 * This is how the engine's card-level moves (sub-dollar dust clearing, a payoff, a cash-floor
 * shortfall) reach the ledger, so the tranche sum can never claim more than the card owes.
 */
export function clampTranches(bals: readonly number[], revBal: number): number[] {
  let left = Math.max(0, revBal);
  return bals.map(b => {
    const keep = Math.round(Math.max(0, Math.min(b, left)) * 100) / 100;
    left = Math.round((left - keep) * 100) / 100;
    return keep;
  });
}

/**
 * Q11: has this card's CURRENT-month due date already been captured by a Plaid sync?
 * If the due date (this month, at dueDay) is already captured in the balance, the cycle's minimum
 * was already paid and the live balance reflects it — forcing it again in month 0 double-counts
 * cash (Discover due Jul 1 kept a $227 min in July's plan). Deliberately keyed on the sync cutoff,
 * not `dueDay < today`: a payment made but not yet synced isn't reflected in the balance, so its
 * min must still be reserved. No cutoff or no due day ⇒ never settled (conservative).
 *
 * §1.1 cause C sweep: the comparison is `isCapturedInBalance`, shared with the car-loan and
 * loan-insurance gates, rather than the open-coded `dueDate <= syncCutoffDate` this used to be.
 * That moves two things deliberately — the settlement lag now applies (a minimum due inside the
 * last SETTLEMENT_LAG_DAYS is NOT assumed paid, because a debit that has posted but not settled is
 * absent from `balances.current`), and the boundary is now strict, so a minimum due exactly ON the
 * cutoff day stays reserved instead of vanishing. Both err toward reserving cash, the safe
 * direction: the failure mode is reading cash low, not recommending a payment the user cannot make.
 * This is an OUTFLOW gate — the lag belongs here. See `src/lib/sync-cutoff.ts`.
 *
 * §1A Stage C part 2 deliberately does NOT pass evidence here, and a future session must not add
 * it. The user pays whatever they choose, not the minimum, so `matchCharge` against the minimum
 * amount will almost always miss. On a card that DOES have transaction coverage that miss reads as
 * `covered + unmatched` ⇒ "not captured" ⇒ the minimum is forced again in month 0 even though it
 * was paid — reinstating the exact Q11 double-count this function exists to remove. Matching a card
 * payment needs transfer-linking between the funding account and the card, which §1A does not have.
 */
export function m0MinDueSettled(
  dueDay: number | null | undefined,
  syncCutoffDate: string | null | undefined,
  now: Date,
): boolean {
  if (dueDay == null || !syncCutoffDate) return false;
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return isCapturedInBalance(dueDateInMonth(monthKey, dueDay), syncCutoffDate);
}

export function getDefaultCardForExpense(category: string, accounts: AccountRow[]): string | null {
  if (!CC_DEFAULT_CATEGORIES.has(category)) return null;
  const activeCards = accounts
    .filter(a => a.account_type === 'credit_card' && a.active)
    .sort((a, b) => (Number(b.apr) || 0) - (Number(a.apr) || 0));
  return activeCards.length > 0 ? `account:${activeCards[0].id}` : null;
}

export function buildCardData(
  accounts: AccountRow[], transactions: EnrichedTransaction[], rules: RuleRow[], debts: DebtRow[], colorStartIndex = 0,
): CardData[] {
  if (!accounts || !transactions || !rules || !debts) return [];
  const ccAccounts = accounts.filter(a => a.account_type === 'credit_card' && a.active);

  return ccAccounts.map((acct, i) => {
    const acctKey = `account:${acct.id}`;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // monthlyNewPurchases is the card's RECURRING monthly spend estimate — it is re-applied to
    // every projected month by the simulation (cardPurchasesThisMonth falls back to it for m >= 1).
    // It must therefore be derived from recurring rules ONLY. One-time transactions (e.g. a single
    // "Car registration" charge) are already attributed to their own month via cardPurchasesPerMonth
    // / ccOneTimeByMonth; summing them here would re-charge that one-time amount every month and
    // balloon the card's projected balance (a 'full'/'statement' card that never reaches $0 even
    // with no recurring spend). See docs/debt-model-fixes-plan.md.
    // Use next month (full month, no today-cutoff) so the estimate represents a complete billing
    // cycle — the current month is partial (most recurring bills already fired and are baked into
    // the live balance), so using it would understate future monthly spending.
    const projRef = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Exclude yearly rules from this flat monthly estimate. A yearly charge is a once-a-year
    // spike, not ongoing monthly spend — amortizing it (countRuleOccurrencesInMonth returns 1/12
    // for yearly) makes a card look like it carries that fraction every month (e.g. Prime Visa
    // showing ~$419/mo that includes /12 slices of Pet Insurance, Costco, Amazon Prime, etc.).
    // Yearly items are already attributed to their actual due month via the scheduled-purchase
    // path (cardPurchasesPerMonth / ccScheduledByMonth), so they spike there and must not also be
    // spread here. If the user wanted a charge spread evenly they'd have set it to monthly.
    const isRecurringMonthlySpend = (r: RuleRow) =>
      r.active && r.rule_type === 'expense' && r.frequency !== 'yearly';

    const recurringExplicit = rules
      .filter(r => isRecurringMonthlySpend(r) && (r.payment_source === acctKey || r.payment_source === acct.id))
      .reduce((s, r) =>
        s + Number(r.amount) * countRuleOccurrencesInMonth(r, projRef.getFullYear(), projRef.getMonth()),
      0);

    const highestAprCard = [...ccAccounts].sort((a, b) => (Number(b.apr) || 0) - (Number(a.apr) || 0))[0];
    const isDefaultCard = highestAprCard?.id === acct.id;

    const recurringDefault = isDefaultCard ? rules
      .filter(r => isRecurringMonthlySpend(r) && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
      .reduce((s, r) =>
        s + Number(r.amount) * countRuleOccurrencesInMonth(r, projRef.getFullYear(), projRef.getMonth()),
      0) : 0;

    const monthlyNewPurchases = recurringExplicit + recurringDefault;

    // Steady-state twin of the estimate above (see CardData.steadyMonthlyPurchases): each rule is
    // counted in the first month it actually fires at/after max(next month, its start_date), so a
    // future-dated rule contributes its real monthly amount instead of 0. Probes a couple of
    // months forward because a mid-month start can zero its own start month (due day already past).
    const steadyOccurrences = (r: RuleRow): number => {
      const sd = r.start_date ? new Date(r.start_date + 'T00:00:00') : null;
      const ref = sd && sd > projRef ? sd : projRef;
      for (let k = 0; k < 3; k++) {
        const d = new Date(ref.getFullYear(), ref.getMonth() + k, 1);
        const n = countRuleOccurrencesInMonth(r, d.getFullYear(), d.getMonth());
        if (n > 0) return n;
      }
      return 0;
    };
    const steadyExplicit = rules
      .filter(r => isRecurringMonthlySpend(r) && (r.payment_source === acctKey || r.payment_source === acct.id))
      .reduce((s, r) => s + Number(r.amount) * steadyOccurrences(r), 0);
    const steadyDefault = isDefaultCard ? rules
      .filter(r => isRecurringMonthlySpend(r) && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
      .reduce((s, r) => s + Number(r.amount) * steadyOccurrences(r), 0) : 0;
    const steadyMonthlyPurchases = steadyExplicit + steadyDefault;

    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthRepayments = transactions
      .filter(t => t.type === 'expense' && t.category === 'Debt Payments' && t.note?.toLowerCase().includes(acct.name.toLowerCase()) && t.date >= monthStart)
      .reduce((s, t) => s + Number(t.amount), 0);

    const matchDebt = debts.find(d => d.name.toLowerCase() === acct.name.toLowerCase());
    const balance = Number(acct.balance);
    const apr = Number(acct.apr) || 0;
    const creditLimit = Number(acct.credit_limit) || 0;
    // accounts.min_payment (set on the Accounts tab, Plaid-synced or user-entered) is the sole
    // source of truth for a card's minimum payment — the debts table is a separate legacy table
    // for mortgage/auto/student debts and must never override what's set on the Accounts page,
    // even if a same-named debts row happens to exist with a different value. Falls back to $25
    // only when the Accounts page genuinely has nothing stored. Never recalculate from balance —
    // the stored static value is what's actually due.
    const acctMin = acct.min_payment != null ? Number(acct.min_payment) : null;
    // Manual flag (accounts.min_payment_is_manual): the stored value is exact — including 0 —
    // so skip both the >0 guard and the $25 fallback. A manual card with nothing stored is $0.
    const minPaymentIsManual = Boolean(acct.min_payment_is_manual);
    const minPay = minPaymentIsManual ? (acctMin ?? 0) : ((acctMin != null && acctMin > 0) ? acctMin : 25);
    const targetPay = matchDebt ? Number(matchDebt.target_payment) : minPay;

    const pref = acct.payment_preference;
    const paymentPreference: 'statement' | 'full' | null =
      pref === 'statement' ? 'statement' : pref === 'full' ? 'full' : null;
    const statementBalancePhase = Boolean(acct.statement_balance_phase);
    // Manual interest-saving balance: the amount due at the card's NEXT due date only (the
    // current statement) — NOT a replacement for the card's balance. The full balance keeps
    // walking through every projection; statementBalance only pins the next statement's
    // payment and implies the card is in grace (paying it keeps the card interest-free).
    const statementBalance = acct.statement_balance != null ? Number(acct.statement_balance) : null;
    const autopayFullBalance = balance <= 0;

    return {
      id: acct.id, name: acct.name, balance, apr, creditLimit,
      minPayment: minPay, minPaymentIsManual,
      targetPayment: Math.max(targetPay, minPay),
      monthlyNewPurchases, steadyMonthlyPurchases, monthlyRepayments: monthRepayments,
      color: getCardColor(colorStartIndex + i),
      paymentPreference, autopayFullBalance,
      dueDay: acct.payment_due_day ?? null,
      startDate: acct.card_start_date || undefined,
      statementBalancePhase, statementBalance,
      installmentBalance: Math.max(0, Number(acct.installment_balance) || 0),
      installmentMonthlyPayment: Math.max(0, Number(acct.installment_monthly_payment) || 0),
      // Multi-rate sub-balances. parseTranches drops anything malformed, so a card with no
      // (or unusable) balance_tranches gets [] and keeps the single-APR path exactly.
      tranches: parseTranches(acct.balance_tranches),
    };
  });
}

/** Project a single card with FIXED payment (consistent mode or standalone view) */
export function projectCard(card: CardData, months = PROJECTION_MONTHS): CardProjection {
  const rows: CardMonthRow[] = [];
  let bal = card.balance;
  let instBal = card.installmentBalance ?? 0;
  let totalInterest = 0;
  let payoffMonth: number | null = null;
  const monthlyRate = card.apr / 100 / 12;
  const simMonths = Math.max(months, 360); // run far past display window so payoffMonth is found even when sim gives 0 payments early on
  // Grace period: true when last payment covered full statement balance, so new purchases don't accrue interest
  let inGrace = card.paymentPreference === 'statement' && (card.statementBalancePhase || card.statementBalance != null || card.balance <= card.monthlyNewPurchases + 0.01);
  // Partial grace: the statement money a grace card could NOT cover. Only this accrues, at the
  // standard rate — see the grace update below.
  let graceUnpaid = 0;
  // Live per-tranche balances (index-aligned with card.tranches); empty for a single-APR card.
  let ledger = (card.tranches ?? []).map(t => t.balance);
  // Billing cycle deferred payment: autopay card charges in month m are paid in month m+1.
  let prevMonthPurchases = 0;

  for (let m = 1; m <= simMonths; m++) {
    if (payoffMonth !== null) break;
    // Anchor to day 1 BEFORE shifting the month: setMonth() on a day-29/30/31 date overflows any
    // shorter target month (Jul 30 + 7 => "Feb 30" => Mar 2), which silently dropped February from
    // the card's month dropdown and duplicated March. Label-only, but the dropdown reads it.
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + m - 1);
    const label = d.toLocaleString('en', { month: 'short', year: 'numeric' });
    const startBal = bal;
    const newPurchases = card.monthlyNewPurchases;

    if (card.autopayFullBalance && bal <= 0) {
      const startBal = prevMonthPurchases; // previous month's unpaid charges
      const payment = prevMonthPurchases;  // payment clears last month's statement
      prevMonthPurchases = newPurchases;
      const endBal = newPurchases; // this month's charges, paid next cycle
      const utilization = card.creditLimit > 0 ? (endBal / card.creditLimit) * 100 : 0;
      if (m <= months) rows.push({ month: m, label, startBalance: startBal, newPurchases, interest: 0, payment, endBalance: endBal, utilization });
      continue;
    }

    // Interest accrues only on the revolving (non-installment) portion.
    const revBal = Math.max(0, bal - instBal);
    const asOf = monthEndAsOf(d, 0);
    // Grace card: nothing accrues while the statement is being covered in full, and only the
    // shortfall accrues when it isn't (partial grace). Otherwise every tranche accrues at its own
    // rate — repriced to card.apr once its promo has expired as of `asOf` — and the untranched
    // remainder at card.apr. Identical to the old flat calc for a card with no tranches.
    // In grace ⇒ nothing accrues (unchanged). Out of grace but carrying an uncovered statement ⇒
    // ONLY that shortfall accrues, at the standard rate (partial grace). Otherwise the full
    // revolving balance accrues, per tranche.
    const inGraceRegime = card.paymentPreference === 'statement' && (inGrace || graceUnpaid > 0);
    const accrual = inGraceRegime
      ? {
          total: inGrace ? 0 : Math.round(Math.min(graceUnpaid, revBal) * monthlyRate * 100) / 100,
          lineInterest: ledger.map(() => 0),
        }
      : trancheInterestFor(card, ledger, revBal, asOf);
    const interest = accrual.total;
    ledger = ledger.map((b, i) => Math.round((b + accrual.lineInterest[i]) * 100) / 100);
    // Installment mandatory payment (reduces both total balance and installment balance).
    const instPay = instBal > 0 && (card.installmentMonthlyPayment ?? 0) > 0
      ? Math.min(card.installmentMonthlyPayment!, instBal) : 0;
    const payment = bal <= 0 ? 0 : Math.min(card.targetPayment, bal + newPurchases + interest - instPay);
    if (card.paymentPreference === 'statement') {
      // Partial-ISB grace: the old model was grace-or-nothing — cover the whole statement or pay
      // interest on the ENTIRE balance next cycle. When available cash covers most of a statement,
      // what actually accrues is the shortfall, at the standard rate; a card that was in grace and
      // paid SOME of its statement therefore carries that shortfall and accrues on it alone. A card
      // that was never in grace is untouched: full-balance interest, exactly as before.
      const dueThisCycle = startBal - instBal + interest;
      const covered = payment >= dueThisCycle - 0.01;
      const wasPartial = inGrace || graceUnpaid > 0;
      graceUnpaid = covered ? 0 : (wasPartial ? Math.max(0, Math.round((dueThisCycle - payment) * 100) / 100) : 0);
      inGrace = covered;
    }
    instBal = Math.max(0, instBal - instPay);
    bal = startBal + newPurchases + interest - payment - instPay;
    ledger = clampTranches(
      applyTranchePayment(card, ledger, revBal + interest + newPurchases, payment, asOf),
      Math.max(0, bal - instBal),
    );
    totalInterest += interest;
    const utilization = card.creditLimit > 0 ? (Math.max(0, bal) / card.creditLimit) * 100 : 0;
    if (m <= months) rows.push({ month: m, label, startBalance: Math.round(startBal * 100) / 100, newPurchases, interest, payment, endBalance: Math.round(bal * 100) / 100, utilization });
    if (payoffMonth === null && startBal > 0) {
      if (card.paymentPreference === 'statement') {
        // "interest-free" = carried balance fully cleared; balance at or below rolling purchases
        if (bal <= card.monthlyNewPurchases + 0.01) payoffMonth = m;
      } else if (bal <= 0) {
        payoffMonth = m;
      }
    }
  }

  return {
    card, months: rows, payoffMonth, totalInterest: Math.round(totalInterest),
    projectedInterestThisMonth: rows[0]?.interest || 0,
    recommendedPayment: (card.autopayFullBalance && card.balance <= 0) ? card.monthlyNewPurchases : card.targetPayment,
    utilizationNow: card.creditLimit > 0 ? (card.balance / card.creditLimit) * 100 : 0,
  };
}

export function projectCardVariable(
  card: CardData,
  monthlyPayments: number[],
  months = PROJECTION_MONTHS,
  /**
   * When true, month 1 uses 0 purchases instead of card.monthlyNewPurchases.
   * Set this when monthlyPayments comes from simulateVariablePayoff, whose month 0
   * (= rest of current month) uses 0 purchases because the live card balance already
   * includes current-month spending. Without this flag the running balance diverges
   * from the sim by exactly one month of purchases, causing cards to appear to never
   * reach $0 in the projection table.
   */
  skipFirstMonthPurchases = false,
  /**
   * Optional per-month purchase amounts for this card (index = m-1, same as monthlyPayments).
   * When provided, overrides card.monthlyNewPurchases so one-time CC transactions are
   * reflected in the Purchases column of the projection table.
   * purchasesPerMonth[0] corresponds to projection month 1 (sim month 0) — should be 0.
   * purchasesPerMonth[1] corresponds to projection month 2 (sim month 1), etc.
   */
  purchasesPerMonth?: number[],
  /**
   * Sim-computed revolving balances per month (index = m-1) from simulateVariablePayoff.
   * When provided, revolvingBalances[m-1] === 0 is used as ground truth to detect when a
   * card has cleared its revolving debt and should enter cycling mode. This avoids the
   * ~$0.01 rounding drift in the local `inGrace` check that prevents statement-preference
   * cards from ever setting payoffMonth.
   */
  revolvingBalances?: number[],
  /**
   * Sim-computed true amount owed at the start of each cycling billing cycle (index = m-1),
   * before that month's payment — includes any interest carried from a missed full payment.
   * When provided, used for the cycling row's startBalance/endBalance so a partial payment is
   * visible in the row where it happens instead of silently disappearing until next month.
   */
  cyclingOwedByMonth?: number[],
  /** Sim-computed interest charged each cycling month (index = m-1) on a carried-forward
   * unpaid balance — 0 unless the previous cycle's payment fell short of the full statement. */
  cyclingInterestByMonth?: number[],
  /**
   * Sim-computed TRUE end-of-month balance per month (index = m-1) from simulateVariablePayoff's
   * Step 3-6 cascade — the actual ground truth, after minimum enforcement and multi-card
   * allocation. When provided, the revolving (non-cycling) branch uses this as the authoritative
   * endBalance instead of recomputing its own balance walk with a simplified flat-APR interest
   * model, which can silently drift from the engine's real numbers over several months. Omit this
   * when projecting a hypothetical payment schedule that never went through the engine (payment
   * overrides, minimum-only comparisons) — there is no ground truth for those by definition.
   */
  trueBalanceByMonth?: number[],
  /**
   * Sim-computed TRUE interest charged on a revolving (non-cycling) card's starting balance each
   * month (index = m-1), from simulateVariablePayoff's Step 3 calc. When provided alongside
   * trueBalanceByMonth, used directly instead of back-solving interest from
   * (trueEndBal - startBal - newPurchases + payment) — that algebra assumes `payment` is the
   * exact amount that produced trueEndBal, which is false for callers that display a cash-floor-
   * scaled payment (e.g. CreditCardEngine.tsx's PASS-3 "Forecast Sim" mode) different from the
   * engine's own natural payment. Without this, those months can back-solve a nonsensical
   * (often deeply negative) interest figure that silently disappears from the display.
   */
  trueInterestByMonth?: number[],
): CardProjection {
  const rows: CardMonthRow[] = [];
  let bal = card.balance;
  let totalInterest = 0;
  let payoffMonth: number | null = null;
  const monthlyRate = card.apr / 100 / 12;
  const simMonths = Math.max(months, 360); // run far past display window so payoffMonth is found even when sim gives 0 payments early on
  let inGrace = card.paymentPreference === 'statement' && (card.statementBalancePhase || card.statementBalance != null || card.balance <= card.monthlyNewPurchases + 0.01);
  // Partial grace / tranche ledger — see projectCard, same model. Both only affect the fallback
  // branch below (no sim ground truth); when the engine supplies trueInterestByMonth its numbers
  // win, and they are computed from the same two models inside simulateVariablePayoff.
  let graceUnpaid = 0;
  let ledger = (card.tranches ?? []).map(t => t.balance);

  for (let m = 1; m <= simMonths; m++) {
    const hasPref = card.autopayFullBalance || card.paymentPreference !== null;
    // Use sim revolving balance as ground truth when available: avoids ~$0.01 rounding
    // drift in the local inGrace check that prevents statement cards from ever transitioning.
    const simRevBal = revolvingBalances?.[m - 1];
    const trueEndBal = trueBalanceByMonth?.[m - 1];
    // Remain in the revolving display branch while an installment balance is still owed, even
    // after the revolving portion clears to 0 — the cycling path tracks CC purchases ($0 for
    // upfront plans), so the balance chart would appear flat at $0 while thousands remain owed.
    const isCycling = hasPref && (
      simRevBal !== undefined ? simRevBal === 0 : (bal <= 0 || payoffMonth !== null)
    ) && !((card.installmentBalance ?? 0) > 0 && trueEndBal !== undefined && trueEndBal > 0);

    if (!hasPref && bal <= 0 && payoffMonth !== null) break;
    if (isCycling && m > months) break;

    // Anchor to day 1 before shifting the month — see projectCard above (Feb-skip / Mar-dupe).
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + m - 1);
    const label = d.toLocaleString('en', { month: 'short', year: 'numeric' });
    const startBal = bal;
    const newPurchases = purchasesPerMonth?.[m - 1] !== undefined
      ? purchasesPerMonth[m - 1]
      : (m === 1 && skipFirstMonthPurchases) ? 0
      : m > monthlyPayments.length ? 0 // beyond sim range: track carried balance only; new purchases assumed paid in-cycle
      : card.monthlyNewPurchases;

    if (isCycling) {
      if (payoffMonth === null) payoffMonth = m;
      const payment = Math.round((monthlyPayments[m - 1] ?? 0) * 100) / 100;
      const trueOwedThisCycle = cyclingOwedByMonth?.[m - 1];
      const cycleStartBal = trueOwedThisCycle !== undefined ? Math.round(trueOwedThisCycle * 100) / 100 : payment;
      const cycleInterest = cyclingInterestByMonth?.[m - 1] ?? 0;
      const trueOwedNextCycle = cyclingOwedByMonth?.[m];
      const endBal = trueOwedNextCycle !== undefined ? Math.round(trueOwedNextCycle * 100) / 100 : Math.round(newPurchases * 100) / 100;
      const utilization = card.creditLimit > 0 ? (endBal / card.creditLimit) * 100 : 0;
      totalInterest += cycleInterest;
      rows.push({ month: m, label, startBalance: cycleStartBal, newPurchases, interest: cycleInterest, payment, endBalance: endBal, utilization });
      continue;
    }

    let interest: number;
    let payment: number;
    if (trueEndBal !== undefined) {
      // Ground truth from the engine's own cascade (minimum enforcement, multi-card
      // allocation already applied). endBalance always trusts this directly so transitions
      // (e.g. into cycling mode) stay continuous with no unexplained jump. Interest prefers the
      // engine's own real Step-3 charge (trueInterestByMonth) when available; only back-solve
      // from (trueEndBal - startBal - newPurchases + payment) as a fallback, since that algebra
      // assumes `payment` is the exact amount that produced trueEndBal — false whenever the
      // displayed payment is a cash-floor-scaled amount different from the engine's own.
      payment = Math.round((monthlyPayments[m - 1] ?? 0) * 100) / 100;
      const trueInterest = trueInterestByMonth?.[m - 1];
      interest = trueInterest !== undefined
        ? Math.round(trueInterest * 100) / 100
        // Safety clamp: the back-solve assumes `payment` exactly produced trueEndBal, which is false
        // when the displayed payment is scaled/zeroed — it could otherwise yield a large NEGATIVE
        // "interest" (the -$4,581 phantom). Interest can never be negative.
        : Math.max(0, Math.round((trueEndBal - startBal - newPurchases + payment) * 100) / 100);
      bal = Math.round(trueEndBal * 100) / 100;
    } else {
      const asOf = monthEndAsOf(d, 0);
      // Same two models as projectCard: partial grace (only the uncovered statement money accrues,
      // at the standard rate) and per-tranche accrual repriced as of this month's end. A card with
      // no tranches and full grace lands on the original two expressions exactly.
      const inGraceRegime = card.paymentPreference === 'statement' && (inGrace || graceUnpaid > 0);
      const accrual = inGraceRegime
        ? {
            total: inGrace ? 0 : Math.round(Math.min(graceUnpaid, Math.max(0, bal)) * monthlyRate * 100) / 100,
            lineInterest: ledger.map(() => 0),
          }
        : trancheInterestFor(card, ledger, Math.max(0, bal), asOf);
      const fallbackInterest = accrual.total;
      ledger = ledger.map((b, i) => Math.round((b + accrual.lineInterest[i]) * 100) / 100);
      // Past the sim window, a cycling statement card uses purchases as the payment proxy
      // (the card pays its balance in full each cycle). Without this, minPayment=0 causes
      // 300+ months of compounding interest on the cycling balance → inflated totalInterest.
      const availablePayment = m > monthlyPayments.length && payoffMonth !== null
        ? card.monthlyNewPurchases
        : (monthlyPayments[m - 1] ?? card.minPayment);
      payment = bal <= 0 ? 0 : Math.min(availablePayment, bal + newPurchases + fallbackInterest);
      interest = fallbackInterest;
      bal = startBal + newPurchases + interest - payment;
      if (bal > 0 && bal < 1) bal = 0; // clear sub-dollar dust to match sim behavior
      ledger = applyTranchePayment(card, ledger, Math.max(0, startBal) + interest + newPurchases, payment, asOf);
    }
    // A ground-truth month walks no ledger of its own (the sim already did, and its interest is
    // what gets displayed) — clamping keeps the ledger from ever claiming more than the card owes.
    ledger = clampTranches(ledger, Math.max(0, bal));
    if (card.paymentPreference === 'statement') {
      // Partial-ISB grace — see projectCard. inGrace itself keeps its exact old meaning (it also
      // drives payoffMonth below, which must still mean "interest-free from here"); the shortfall
      // rides alongside in graceUnpaid.
      const dueThisCycle = startBal + interest;
      const covered = payment >= dueThisCycle - 0.01;
      const wasPartial = inGrace || graceUnpaid > 0;
      graceUnpaid = covered ? 0 : (wasPartial ? Math.max(0, Math.round((dueThisCycle - payment) * 100) / 100) : 0);
      inGrace = covered;
    }
    totalInterest += interest;
    const utilization = card.creditLimit > 0 ? (Math.max(0, bal) / card.creditLimit) * 100 : 0;
    if (m <= months) rows.push({ month: m, label, startBalance: Math.round(startBal * 100) / 100, newPurchases, interest, payment: Math.round(payment * 100) / 100, endBalance: Math.round(bal * 100) / 100, utilization });
    // Reconciliation guard (dev only): when we display the engine's ground-truth end balance, the
    // row must satisfy End = Start + purchases + interest − payment. If it doesn't, the displayed
    // payment came from a different model than the balance (the class of bug that produced balances
    // dropping without matching payments). Surface it loudly instead of letting it pass silently.
    if (import.meta.env?.DEV && trueEndBal !== undefined && m <= months) {
      const residual = Math.round((bal - (startBal + newPurchases + interest - payment)) * 100) / 100;
      // Tolerate sub-dollar noise from displaying whole-dollar-rounded payments; only flag a real
      // model mismatch (e.g. an installment/plan payment that moves the balance but isn't shown in
      // the payment column). $1 comfortably clears rounding while catching the hundreds-of-dollars
      // divergences that motivated this guard.
      if (Math.abs(residual) > 1) {
        console.warn(`[projectCardVariable] ${card.name} ${label} does not reconcile: End ${bal} ≠ Start ${startBal} + purch ${newPurchases} + int ${interest} − pay ${Math.round(payment * 100) / 100} (residual ${residual})`);
      }
    }
    // Sim ground truth: revolving debt cleared this month → interest-free from here, mirroring
    // the cycling branch's payoffMonth assignment. Sub-dollar tolerance (same dust convention as
    // the `bal < 1` clear below) because the sim can leave a few cents of rounding dust on the
    // revolving series (e.g. a flat $0.04 forever) that defeats a strict === 0 check. Without
    // this, a card held in this display branch (installment exception, or dust blocking the
    // cycling branch) whose inGrace check also misses by cents keeps payoffMonth null, and the
    // post-window fallback walk pays only card.minPayment (possibly $0) for the remaining ~300
    // months of simMonths — compounding flat-APR interest into an absurd totalInterest
    // (the $132k Prime Visa TOTAL INTEREST header).
    if (payoffMonth === null && hasPref && simRevBal !== undefined && simRevBal < 1) payoffMonth = m;
    if (payoffMonth === null && startBal > 0) {
      if (card.paymentPreference === 'statement') {
        // inGrace = payment covered opening balance + interest this cycle,
        // meaning only new purchases remain → card is interest-free going forward.
        // This is correct regardless of whether purchasesPerMonth differs from
        // monthlyNewPurchases, and avoids false positives beyond the sim window
        // where newPurchases drops to 0.
        if (inGrace) payoffMonth = m;
      } else if (bal <= 0) {
        payoffMonth = m;
      }
    }
  }

  return {
    card, months: rows, payoffMonth, totalInterest: Math.round(totalInterest),
    projectedInterestThisMonth: rows[0]?.interest || 0,
    recommendedPayment: (card.autopayFullBalance && card.balance <= 0) ? card.monthlyNewPurchases : (monthlyPayments[0] ?? card.targetPayment),
    utilizationNow: card.creditLimit > 0 ? (card.balance / card.creditLimit) * 100 : 0,
  };
}

// ─── Simulation output types ──────────────────────────────

/** A projected debt payment emitted by simulateVariablePayoff for Forecast / Transactions rendering. */
export type SimulatedDebtPayment = {
  date: string;           // ISO date — last day of the payment month
  description: string;    // e.g. "Prime Visa Payment"
  amount: number;         // positive outflow amount
  account: string;        // funding account id ('' when unknown)
  category: 'Debt Payments';
  card: string;           // credit card account id
  type: 'debt_payoff';
  projected: true;
};

/** Flags emitted by simulateVariablePayoff describing per-month anomalies. */
export type SimulationFlag = {
  month: number;
  flag: 'UNSTABLE' | 'FLOOR_BREACHED' | 'CARD_AT_RISK';
  /** Set when flag === 'CARD_AT_RISK' — identifies which card missed its minimum. */
  cardId?: string;
};

/**
 * Event-based, cash-floor-aware variable payoff simulation.
 *
 * Algorithm (Steps 1-8, plan debt-engine-v2.md):
 *   Step 1  Initialise balances and currentCash from inputs.
 *   Step 2  Compute available cash from events (or scalar fallback).
 *   Step 3  Pay minimums; handle FLOOR_BREACHED with snowball protection.
 *   Step 4  Allocate extra cash to priority card (avalanche / snowball).
 *           C3: card balance has NOT been reduced yet — do not double-subtract.
 *   Step 5  Deduct payments from balances and currentCash.
 *   Step 6  Apply interest AFTER all payments (C4 — never mid-month).
 *   Step 7  Advance month: currentCash += monthIncome - monthExpenses.
 *   Step 8  Repeat until all balances = 0 or month limit reached.
 *
 * Backward-compatible: existing callers pass 7 positional args (scalars).
 * Event-based callers (TASK 2) additionally pass monthEvents[] and fundingAccountId.
 */
/** Return type of {@link simulateVariablePayoff} — the sim's authoritative per-month/per-card
 * payment, balance, and cycling ledger. Named so downstream modules (forecast-engine,
 * useCardProjection, cardProjectionResim) can reference it directly instead of deriving it via
 * `ReturnType<typeof simulateVariablePayoff>`. */
export interface SimResult {
  monthlyPayments: Map<string, number[]>;
  monthlyBalances: Map<string, number[]>;
  monthlyRevolvingBalances: Map<string, number[]>;
  /** Per-card per-month minimum payment based on projected balance — shrinks as debt is paid. */
  perCardMinPayments: Map<string, number[]>;
  /** Per-card per-month TRUE amount owed at the start of the cycling billing cycle — this
   * cycle's mandatory statement PLUS any accumulated backlog (post-interest, pre-payment),
   * combined for display continuity so a cycling card's "Start balance" never appears to
   * silently drop debt. Used by projectCardVariable so a partial payment is visible in the row
   * where it happens instead of silently disappearing. */
  monthlyCyclingOwed: Map<string, number[]>;
  /** Per-card per-month interest charged on a cycling card's accumulated backlog — always 0
   * unless the card currently carries backlog (i.e. a prior cycle's statement wasn't paid in
   * full). */
  monthlyCyclingInterest: Map<string, number[]>;
  /** Per-card per-month interest actually charged on a REVOLVING (non-cycling) card's starting
   * balance this cycle (Step 3's real calc — 0 during a statement-preference grace period).
   * Ground truth for projectCardVariable's revolving branch so its displayed interest reflects
   * what the engine actually charged, independent of whatever payment ends up displayed (which
   * may be a cash-floor-scaled amount that differs from the payment used to produce this figure). */
  monthlyInterest: Map<string, number[]>;
  /** Per-card per-month MANDATORY (current-cycle-only) cycling payment, excluding any
   * backlog-cascade payment folded into the same month's monthlyPayments entry. Callers building
   * a cash-flow look-ahead should treat this (not monthlyPayments) as the non-reducible bill for
   * a cycling card — monthlyPayments may also include discretionary backlog paydown. */
  monthlyMandatoryCyclingPayment: Map<string, number[]>;
  /** Per-card per-month payment funded by the Step-5 debt-cash pool (the revolving/backlog
   * cascade) — the exact spend of the pool that debtCashTargetByMonth REPLACES. Excludes Step-2
   * mandatory cycling statements and mandatory installment/BNPL payments, which are paid outside
   * that pool. buildPaymentLedger's `revolving` sums this, so the convergence loop's next-pass
   * target echoes precisely what the pool spent — classifying by start-of-month revolving
   * balance instead leaked backlog-cascade spend into `cycling` and ratcheted the target down
   * every pass (the 2026-07-09 non-convergence regression). */
  monthlyDebtCashPayment: Map<string, number[]>;
  /** Per-card per-month accumulated cycling backlog, end-of-month post-payment. The unambiguous
   * "does this card need avalanche priority / a reserved floor minimum" signal — deliberately
   * separate from monthlyRevolvingBalances, which must stay a one-way 0-once-cycling signal for
   * projectCardVariable's display-branch routing (see where this is pushed, Step 6). */
  monthlyCyclingBacklog: Map<string, number[]>;
  projectedPayoffMonths: number;
  cashFloorBreaches: { month: number; endingCash: number }[];
  flags: SimulationFlag[];
  projectedCashByMonth: number[];
  debtPaymentTransactions: SimulatedDebtPayment[];
  warningMessages: { month: number; message: string }[];
}

export interface PaymentLedgerCardEntry {
  id: string;
  payment: number;
}

/** Authoritative per-month payment split, derived directly from a SimResult's own outputs —
 * .claude/plan/unify-cycling-model.md Stage 2. `revolving` is the sim's own record of what the
 * Step-5 debt-cash pool spent (monthlyDebtCashPayment) — exactly the pool that
 * debtCashTargetByMonth replaces, so the convergence loop's next-pass target echoes the sim's
 * actual spend. (It previously classified by start-of-month revolving balance, which leaked
 * backlog-cascade spend into `cycling` and installment shares into `revolving`, ratcheting the
 * convergence target down every pass — the 2026-07-09 regression.) `cycling` is the remainder:
 * mandatory statements plus mandatory installment/BNPL shares. */
export interface PaymentLedgerEntry {
  total: number;
  revolving: number;
  cycling: number;
  perCard: PaymentLedgerCardEntry[];
}

export function buildPaymentLedger(
  sim: SimResult,
  cards: CardData[],
  months = PROJECTION_MONTHS,
): PaymentLedgerEntry[] {
  return Array.from({ length: months }, (_, i) => {
    let total = 0;
    let revolving = 0;
    const perCard: PaymentLedgerCardEntry[] = [];
    for (const card of cards) {
      const payment = sim.monthlyPayments.get(card.id)?.[i] ?? 0;
      total += payment;
      revolving += sim.monthlyDebtCashPayment.get(card.id)?.[i] ?? 0;
      perCard.push({ id: card.id, payment });
    }
    return { total, revolving, cycling: total - revolving, perCard };
  });
}

export function simulateVariablePayoff(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  /** Scalar fallback — used when monthEvents is not provided. */
  monthlyTakeHome: number,
  /** Scalar fallback — used when monthEvents is not provided. */
  monthlyExpenses: number,
  months = PROJECTION_MONTHS,
  /**
   * Optional event-based per-month income/expense sums (C5).
   * monthEvents[0]  = current month scoped today→EOM (scoped by caller, C1).
   * monthEvents[1+] = full future month sums.
   * When omitted, monthlyTakeHome / monthlyExpenses scalars are used for every month.
   */
  monthEvents?: { income: number; expenses: number }[],
  /** Used to populate the `account` field on SimulatedDebtPayment records. */
  fundingAccountId?: string,
  /**
   * Optional per-month per-card CC purchase amounts (T1/T3).
   * cardPurchasesPerMonth[m][cardId] = total CC purchases for that card in month m.
   * Month 0 should be 0 — the live card.balance already includes today's purchases.
   * When omitted, falls back to card.monthlyNewPurchases for months 1+ (legacy callers).
   */
  cardPurchasesPerMonth?: { [cardId: string]: number }[],
  /**
   * Override for month 0 (current month) remaining income from today to month-end.
   * Takes priority over monthEvents[0].income and the monthlyTakeHome scalar.
   * Derived from allTransactions so the live account balance is the ground truth.
   */
  month0RemainingIncome?: number,
  /**
   * Override for month 0 (current month) remaining expenses from today to month-end.
   * Takes priority over monthEvents[0].expenses and the monthlyExpenses scalar.
   */
  month0RemainingExpenses?: number,
  /**
   * Optional one-time (non-recurring) income and expense totals per month.
   * Applied in Step 7 AFTER debt allocation so they do not reduce availableCash
   * in prior months (prevents look-ahead cash hoarding for future large purchases).
   * Month 0 is asymmetric on purpose: index 0 is skipped by the Step 5 availableCash term
   * (month-0 debt capacity is handled by month0Remaining*), but Step 7 DOES advance cash by
   * it. Callers must therefore pass only month-0 one-times not yet in the starting balance
   * (useCardProjection filters index 0 to dates after the sync cutoff).
   */
  oneTimeByMonth?: { income: number; expenses: number }[],
  /**
   * Optional effective safe floor for month 0 only — overrides cashFloor for the current month.
   * Should be max(cashFloor, prePaycheckBills) so month 0 payments match recommendations.
   */
  month0SafeFloor?: number,
  /**
   * Optional per-month cap on the total debt payment allocation. Always caps the revolving/
   * backlog cascade (Step 5). Once every card that started with debt has reached $0 (no
   * revolving or backlog balance remains), it ALSO caps the cycling/paid-off pool (Step 2) —
   * otherwise a full-balance/statement card would keep draining all available cash into its
   * statement during a save-up month even after the "real" debt is gone. Floored at the
   * relevant minimums in both places so a cap can never force a minimum-payment violation.
   * Set to ccMinTotal for "save-up" months identified by the look-ahead pre-pass in callers.
   * Mirrors Forecast PASS 2 behavior so future-month debt projections are consistent.
   */
  maxDebtPaymentByMonth?: number[],
  /**
   * Optional per-month safe cash floor, computed via getMinSafeCash for each month.
   * When provided, replaces the constant cashFloor for months 1+.
   * Mirrors Forecast's monthMinSafe so the debt payoff floor matches the forecast floor.
   */
  cashFloorByMonth?: number[],
  /**
   * Optional per-month total of revolving cards' minimum payments already reserved by
   * cashFloorByMonth/month0SafeFloor (when that floor came from getAugmentedMinSafeCash, which
   * bakes CC minimums in for cards with a dueDay). When provided, Step 2 subtracts this from its
   * own reservedForRevolving before sizing cycling cards' payoff pool, so the same dollars aren't
   * reserved twice — once by the floor shrinking tentativeAvailAboveFloor, and again here. Omit
   * (or pass all zeros) when the floor is bare (no CC minimums baked in) — e.g. the bootstrap pass
   * in useCardProjection.ts, which still needs reservedForRevolving as the only protection.
   */
  ccMinAlreadyInFloorByMonth?: number[],
  /**
   * Optional per-month per-card BNPL (monthly_charge) installment charges. These hit the card
   * as new purchases each month (already in cardPurchasesPerMonth) but are interest-free, so
   * they require a mandatory payment equal to the charge amount. The cascade target for the card
   * is reduced by this charge so the revolving cascade doesn't try to pay it twice.
   * installmentChargeByMonth[m][cardId] = total BNPL charge for that card in month m.
   */
  installmentChargeByMonth?: { [cardId: string]: number }[],
  /**
   * Optional per-month per-card UPFRONT-plan installment payment schedule (due-date-anchored —
   * see deriveUpfrontPlanFields in payment-plan-generator.ts). When provided, a card's mandatory
   * upfront installment for month m is upfrontPayByMonth[m][cardId] (possibly $0 before the
   * plan's first real due date) instead of a flat card.installmentMonthlyPayment starting at
   * month 0. When omitted, the flat legacy behavior is preserved exactly — callers without plan
   * data (tests, standalone projections) are unaffected.
   */
  upfrontPayByMonth?: { [cardId: string]: number }[],
  /**
   * Phase 2 Option C convergence — the forecast engine's authoritative per-month REVOLVING debt
   * cash (its step-2 revolving share + that month's step-3 surplus; see ForecastRow.
   * revolvingDebtCash). When provided for month m it REPLACES the sim's own revolving-cascade
   * cash pool (Step 5's availableCash): the cascade allocates exactly
   * min(max(target, contract minimums), owed) — covering both clamp months AND surplus months
   * (maxDebtPaymentByMonth alone can't force paying MORE, it's only a cap). Per-card minimums
   * always win over a lower target, so a floor-forced engine month can never produce
   * min-payment violations (2026-06-19 lesson). The cycling mandatory pool (Step 2) and
   * installment payments are unaffected. Omitted ⇒ byte-identical legacy behavior.
   */
  debtCashTargetByMonth?: number[],
  /**
   * Q1 override-rebalance — user-pinned per-card per-month payments:
   * paymentOverridesByMonth[cardId][monthIdx] = the card's exact TOTAL payment that month.
   * A pinned card's payment is exactly the override, clamped only at ≥0 and at what the card
   * actually owes (balance + interest + purchases for a revolving card; current-cycle statement
   * + backlog for a cycling card) so a nonexistent balance is never overpaid. The pinned amount
   * is deducted from the month's cash BEFORE Step 2 (cycling mandatory pool) and Step 5
   * (revolving cascade) size their pools, and the card is excluded from normal allocation in
   * both steps — so the OTHER cards rebalance around the pin under the normal strategy/minimum/
   * floor rules. Pinning below the contract minimum is allowed (explicit user command; the
   * minimum-enforcement guard skips pinned cards). One exception to "total": a mandatory
   * installment share (upfront plan + BNPL, Step 2.5) can't be pinned away — the pin's cascade
   * share is max(0, pin − installment due), so a pin below the installment due still pays the
   * installment in full. Omitted ⇒ byte-identical legacy behavior.
   */
  paymentOverridesByMonth?: { [cardId: string]: Record<number, number> },
): SimResult {
  if (cards.length === 0) {
    return {
      monthlyPayments: new Map(),
      monthlyBalances: new Map(),
      monthlyRevolvingBalances: new Map(),
      perCardMinPayments: new Map(),
      monthlyCyclingOwed: new Map(),
      monthlyCyclingInterest: new Map(),
      monthlyInterest: new Map(),
      monthlyMandatoryCyclingPayment: new Map(),
      monthlyDebtCashPayment: new Map(),
      monthlyCyclingBacklog: new Map(),
      projectedPayoffMonths: 0,
      cashFloorBreaches: [],
      flags: [],
      projectedCashByMonth: [],
      debtPaymentTransactions: [],
      warningMessages: [],
    };
  }

  // ── Step 1 — Initialise ────────────────────────────────────
  const balances = new Map<string, number>(cards.map(c => [c.id, c.balance]));
  // Tracks each card's remaining interest-free installment plan balance month by month.
  const installmentBals = new Map<string, number>(cards.map(c => [c.id, c.installmentBalance ?? 0]));
  const monthlyPayments = new Map<string, number[]>(cards.map(c => [c.id, []]));
  const monthlyBalances = new Map<string, number[]>(cards.map(c => [c.id, []]));
  const monthlyRevolvingBalances = new Map<string, number[]>(cards.map(c => [c.id, []]));
  const perCardMinPayments = new Map<string, number[]>(cards.map(c => [c.id, []]));
  const monthlyCyclingOwed = new Map<string, number[]>(cards.map(c => [c.id, []]));
  const monthlyCyclingInterest = new Map<string, number[]>(cards.map(c => [c.id, []]));
  const monthlyInterest = new Map<string, number[]>(cards.map(c => [c.id, []]));
  // A cycling card's mandatory (current-cycle-only) payment, excluding any backlog-cascade
  // payment folded into the same month's monthlyPayments entry. Lets callers building a
  // look-ahead treat ONLY the mandatory portion as a non-reducible bill, instead of mistaking
  // discretionary backlog paydown for a fixed expense (see useCardProjection.ts's
  // computeCyclingPaymentByMonth).
  const monthlyMandatoryCyclingPayment = new Map<string, number[]>(cards.map(c => [c.id, []]));
  // Step-5 debt-cash-pool spend per card per month — see the SimResult field's JSDoc.
  const monthlyDebtCashPayment = new Map<string, number[]>(cards.map(c => [c.id, []]));
  // A cycling card's accumulated backlog, end-of-month, post-payment — the unambiguous signal
  // for "does this card need avalanche priority / a reserved minimum in the floor," kept separate
  // from monthlyRevolvingBalances (which must stay a one-way 0-once-cycling signal — see the
  // comment where this is pushed).
  const monthlyCyclingBacklog = new Map<string, number[]>(cards.map(c => [c.id, []]));
  let currentCash = liquidCash;
  let projectedPayoffMonths = 0;
  const cashFloorBreaches: { month: number; endingCash: number }[] = [];
  const flags: SimulationFlag[] = [];
  const projectedCashByMonth: number[] = [];
  const debtPaymentTransactions: SimulatedDebtPayment[] = [];
  const warningMessages: { month: number; message: string }[] = [];

  const now = new Date();

  // Month index (0 = current month) at which each card becomes active.
  // Cards with a future startDate are excluded from the simulation until their start month.
  const cardStartMonths = new Map<string, number>(
    cards.map(c => [c.id, cardStartMonthOffset(c.startDate, now)]),
  );

  // Tracks cards that have reached $0 — one-way transition, never re-enters debt mode.
  const paidOffCards = new Set<string>();

  // Grace period tracking for statement-balance preference cards.
  // When a card pays its full statement balance (startBal + interest), the new purchases
  // added that cycle are in grace period — no interest charged next billing cycle.
  const graceMap = new Map<string, boolean>(
    cards.map(c => [c.id, c.paymentPreference === 'statement' && (c.statementBalancePhase || c.statementBalance != null || c.balance <= c.monthlyNewPurchases + 0.01)]),
  );
  // Partial-ISB grace: the statement/interest-saving money a grace card could NOT cover. The old
  // model was grace-or-nothing — cover the whole ISB or lose grace and pay interest on the ENTIRE
  // balance next cycle. The real case is neither (Tre's ISB is $2,845 and available cash covers
  // most of it): what accrues is the shortfall, at the card's STANDARD rate, which is also what
  // makes a statement card's MARGINAL rate real for avalanche ordering. A card that was never in
  // grace is untouched — it keeps paying interest on its whole balance, exactly as before.
  const graceUnpaid = new Map<string, number>(cards.map(c => [c.id, 0]));
  // Live per-tranche balances per card (index-aligned with card.tranches), walked month by month
  // alongside `balances`. MUST stay function-local for the same reason cyclingBacklog does —
  // useCardProjection.ts calls this function up to 5 times per render.
  const trancheBals = new Map<string, number[]>(
    cards.map(c => [c.id, (c.tranches ?? []).map(t => t.balance)]),
  );

  // Manual interest-saving balance (CardData.statementBalance): the user-entered amount due
  // at the card's next due date. Modeled as a synthetic payment pin on top of the real
  // balance walk: months before the due month pay $0 (that cycle's statement was already
  // paid before today), the due month pays exactly the entered amount, and every later month
  // reverts to normal statement-preference behavior (the unbilled remainder becomes the next
  // statement). The due month is month 0 when the card's due day hasn't passed yet this
  // month, else month 1. A user override on the same card/month wins over the synthetic pin.
  const manualStatementByCard = new Map<string, { dueMonth: number; amount: number }>();
  for (const c of cards) {
    if (c.paymentPreference !== 'statement' || c.statementBalance == null || c.balance <= 0) continue;
    if ((cardStartMonths.get(c.id) ?? 0) > 0) continue;
    const dueMonth = c.dueDay != null && c.dueDay >= now.getDate() ? 0 : 1;
    manualStatementByCard.set(c.id, { dueMonth, amount: Math.max(0, c.statementBalance) });
  }

  // Billing cycle deferred purchases: a paid-off card's charges in month m are paid
  // in month m+1 (statement closes at month-end, payment due ~25 days into next month).
  // Always reflects ONLY the current cycle's fresh spend — never a carried-forward shortfall
  // (see cyclingBacklog below) — so this pool never compounds into unbounded debt.
  const paidOffDeferredPurchases = new Map<string, number>(cards.map(c => [c.id, 0]));
  // A cycling card's accumulated unpaid-statement debt — set when the mandatory pool (Step 2)
  // can't cover a cycling card's current-cycle statement in full. Tracked separately from
  // `balances` (reserved for cards genuinely revolving from the start) so a cycling card's
  // routine monthly bill stays mandatory-first-funded while any backlog instead competes for
  // "extra" cash in the SAME avalanche/snowball cascade revolving cards use (Step 5) — instead
  // of recompounding indefinitely with its own dedicated, unconditional-priority pool the way it
  // used to (real-world bug: a chronically-underfunded cycling card's "owed" grew without bound
  // every month, permanently starving any genuinely-revolving card of above-minimum cash).
  // MUST stay a function-local const, re-initialized fresh on every call — useCardProjection.ts
  // calls this function up to 5 times per render (bootstrap + 3 outer-refinement passes + an
  // optional capped retry); a module-level map would silently corrupt every pass after the first.
  const cyclingBacklog = new Map<string, number>(cards.map(c => [c.id, 0]));

  for (let m = 0; m < months; m++) {

    // ── Income / expenses for this month ───────────────────────
    // Month 0: use caller-provided remaining-income/expenses (today → EOM).
    // Months 1+: fall back to monthEvents or scalar.
    const monthIncome = (m === 0 && month0RemainingIncome !== undefined)
      ? month0RemainingIncome
      : (monthEvents?.[m]?.income ?? monthlyTakeHome);
    const monthExpenses = (m === 0 && month0RemainingExpenses !== undefined)
      ? month0RemainingExpenses
      : (monthEvents?.[m]?.expenses ?? monthlyExpenses);

    // End-of-month ISO date for SimulatedDebtPayment records
    const payDate = new Date(now.getFullYear(), now.getMonth() + m + 1, 0);
    const payDateStr = payDate.toISOString().split('T')[0];
    // The date this month's rates are resolved at (last day of the month — see monthEndAsOf).
    // Kept separate from payDateStr, which is UTC-formatted for the transaction records.
    const trancheAsOf = monthEndAsOf(now, m);

    /**
     * This cycle's interest on a revolving card, and the per-tranche split to accrue into the
     * ledger. Called TWICE per month with identical inputs — once by the pinned-override mirror
     * (which must not mutate anything) and once by Step 3 (which also accrues) — so it lives in
     * one place and the two can never drift.
     */
    const revolvingInterestFor = (card: CardData): { interest: number; lineInterest: number[] } => {
      const bal = balances.get(card.id) ?? 0;
      const instBal = installmentBals.get(card.id) ?? 0;
      // Interest accrues only on the revolving (non-installment) portion.
      const revBal = Math.max(0, bal - instBal);
      const inGrace = card.paymentPreference === 'statement' && (graceMap.get(card.id) ?? false);
      const unpaid = graceUnpaid.get(card.id) ?? 0;
      if (inGrace || (card.paymentPreference === 'statement' && unpaid > 0)) {
        // In grace: nothing accrues (unchanged). Out of grace carrying an uncovered statement:
        // ONLY that shortfall accrues, at the standard rate — the partial-ISB case.
        return {
          interest: inGrace ? 0 : Math.round(Math.min(unpaid, revBal) * (card.apr / 100 / 12) * 100) / 100,
          lineInterest: [],
        };
      }
      const accrual = trancheInterestFor(card, trancheBals.get(card.id) ?? [], revBal, trancheAsOf);
      return { interest: accrual.total, lineInterest: accrual.lineInterest };
    };

    // Per-card CC purchases this month.
    // Month 0 = 0: live card.balance already includes today's purchases.
    // Returns 0 for cards that haven't reached their start month yet.
    const cardPurchasesThisMonth = (c: CardData): number => {
      if ((cardStartMonths.get(c.id) ?? 0) > m) return 0;
      return cardPurchasesPerMonth?.[m]?.[c.id] ?? (m === 0 ? 0 : c.monthlyNewPurchases);
    };

    // Floor and one-time items — computed once per month, shared by Steps 2 and 5.
    const effectiveFloor = (m === 0 && month0SafeFloor !== undefined)
      ? month0SafeFloor
      : (cashFloorByMonth?.[m] ?? cashFloor);
    const oneTimeNet = m === 0 ? 0
      : (oneTimeByMonth?.[m]?.income ?? 0) - (oneTimeByMonth?.[m]?.expenses ?? 0);

    // This month's mandatory upfront-plan installment for a card. Schedule-aware when the
    // caller supplied upfrontPayByMonth (due-date-anchored — $0 before the plan's first real
    // due date), flat card.installmentMonthlyPayment otherwise (legacy behavior). Used by
    // perCardMinPayments, reservedForRevolving, and Step 2.5 so all three layers agree on
    // what installment cash actually leaves this month.
    const upfrontDueFor = (card: CardData, instBal: number): number => {
      if (instBal <= 0) return 0;
      if (upfrontPayByMonth) return Math.min(upfrontPayByMonth[m]?.[card.id] ?? 0, instBal);
      return (card.installmentMonthlyPayment ?? 0) > 0
        ? Math.min(card.installmentMonthlyPayment!, instBal) : 0;
    };

    // Push 0 for cards that haven't reached their start month — keeps arrays aligned.
    // Also collect balance-sensitive minimum for each card this month (Option A).
    for (const card of cards) {
      if ((cardStartMonths.get(card.id) ?? 0) > m) {
        monthlyPayments.get(card.id)!.push(0);
        monthlyBalances.get(card.id)!.push(0);
        monthlyRevolvingBalances.get(card.id)!.push(0);
        perCardMinPayments.get(card.id)!.push(0);
        monthlyCyclingOwed.get(card.id)!.push(0);
        monthlyCyclingInterest.get(card.id)!.push(0);
        monthlyInterest.get(card.id)!.push(0);
        monthlyMandatoryCyclingPayment.get(card.id)!.push(0);
        monthlyDebtCashPayment.get(card.id)!.push(0);
        monthlyCyclingBacklog.get(card.id)!.push(0);
      } else if (paidOffCards.has(card.id)) {
        // A backlog card still needs its minimum reserved in the floor (see
        // reservedForRevolving/getAugmentedMinSafeCash) — a bare 0 here would make it look like
        // it needs no protection even though monthlyCyclingBacklog (see Step 6) reports otherwise.
        const backlog = cyclingBacklog.get(card.id) ?? 0;
        perCardMinPayments.get(card.id)!.push(
          backlog > 0
            ? (card.minPaymentIsManual ? revolvingMinDue(card, backlog) : calcMinPayment(backlog, card.apr))
            : 0,
        );
      } else {
        const bal = balances.get(card.id) ?? 0;
        const instBal = installmentBals.get(card.id) ?? 0;
        const revBal = Math.max(0, bal - instBal);
        const instMinPay = upfrontDueFor(card, instBal);
        // Manual cards reserve their exact contract revolving min (possibly $0) instead of the
        // formula, so the floor never protects a minimum the lender isn't actually charging.
        const revMinPay = (m === 0 && card.m0MinSettled)
          ? 0 // Q11: this cycle's revolving min was already paid pre-sim — see m0MinDueSettled
          : (card.minPaymentIsManual ? revolvingMinDue(card, revBal) : calcMinPayment(revBal, card.apr));
        perCardMinPayments.get(card.id)!.push(bal > 0 ? (revMinPay + instMinPay) : 0);
      }
    }

    // ── Step 1 — Mark newly paid-off cards (one-way transition) ──
    for (const card of cards) {
      if ((cardStartMonths.get(card.id) ?? 0) > m) continue; // not active yet
      if (!paidOffCards.has(card.id) && (balances.get(card.id) ?? 0) <= 0) {
        paidOffCards.add(card.id);
      }
    }

    // ── Step 1b — Charge interest on any cycling-card backlog carried from last month ──
    // Mirrors Step 3's revolving-interest calc exactly, just on the separate backlog map. Runs
    // before Step 2 so the mandatory pool stays uninvolved, and before Step 5 so the avalanche
    // cascade pays down the POST-interest amount this same month (interest is included in what's
    // being paid off, not deferred an extra cycle).
    const backlogInterestMap = new Map<string, number>();
    for (const card of cards) {
      const bal = cyclingBacklog.get(card.id) ?? 0;
      if (bal <= 0) continue;
      const interest = Math.round(bal * (card.apr / 100 / 12) * 100) / 100;
      cyclingBacklog.set(card.id, Math.round((bal + interest) * 100) / 100);
      backlogInterestMap.set(card.id, interest);
    }

    // ── Pinned payment overrides (paymentOverridesByMonth) ─────────────────────────
    // Resolve each of this month's overrides into concrete cash shares up front so both
    // allocation pools can deduct the pinned spend before sizing (see the param JSDoc).
    // The revolving-interest mirror below matches Step 3's calc exactly — it IS the same function
    // (revolvingInterestFor), and balances, graceMap, graceUnpaid, trancheBals and installmentBals
    // are not mutated between here and Step 3 — and owedCycle matches
    // Step 2's owedByCard (paidOffDeferredPurchases isn't mutated until Step 2's payment loop).
    //   step5Share     — cash the pin consumes from the Step-5 pool (revolving cascade for a
    //                    debt card; backlog cascade for a cycling card).
    //   mandatoryShare — cash the pin consumes from the Step-2 cycling mandatory pool
    //                    (always 0 for a revolving card).
    const pinnedThisMonth = new Map<string, { step5Share: number; mandatoryShare: number }>();
    if (paymentOverridesByMonth || manualStatementByCard.size > 0) {
      for (const card of cards) {
        const userRaw = paymentOverridesByMonth?.[card.id]?.[m];
        // Synthetic manual-statement pin: 0 before the due month, the ISB amount at it.
        const ms = manualStatementByCard.get(card.id);
        const syntheticRaw = ms !== undefined && m <= ms.dueMonth
          ? (m === ms.dueMonth ? ms.amount : 0)
          : undefined;
        const raw = userRaw !== undefined ? userRaw : syntheticRaw;
        if (raw === undefined || (cardStartMonths.get(card.id) ?? 0) > m) continue;
        const pinFloor = Math.max(0, raw);
        if (paidOffCards.has(card.id)) {
          const owedCycle = Math.round((paidOffDeferredPurchases.get(card.id) ?? 0) * 100) / 100;
          const backlog = cyclingBacklog.get(card.id) ?? 0; // already post-Step-1b interest
          const pin = Math.round(Math.min(pinFloor, owedCycle + backlog) * 100) / 100;
          const mandatoryShare = Math.round(Math.min(pin, owedCycle) * 100) / 100;
          pinnedThisMonth.set(card.id, {
            mandatoryShare,
            step5Share: Math.round((pin - mandatoryShare) * 100) / 100,
          });
        } else {
          const bal = balances.get(card.id) ?? 0;
          const instBal = installmentBals.get(card.id) ?? 0;
          const { interest } = revolvingInterestFor(card);
          const owed = bal + interest + cardPurchasesThisMonth(card);
          const pin = Math.round(Math.min(pinFloor, owed) * 100) / 100;
          // The pin is the card's TOTAL payment; the mandatory installment share (paid via
          // installmentCashCost, Step 2.5) comes out first and can't be pinned away.
          const instDue = Math.round(upfrontDueFor(card, instBal) * 100) / 100
            + Math.round((installmentChargeByMonth?.[m]?.[card.id] ?? 0) * 100) / 100;
          pinnedThisMonth.set(card.id, {
            mandatoryShare: 0,
            step5Share: Math.max(0, Math.round((pin - instDue) * 100) / 100),
          });
        }
      }
    }
    let pinnedStep5Total = 0;
    let pinnedMandatoryTotal = 0;
    for (const pin of pinnedThisMonth.values()) {
      pinnedStep5Total += pin.step5Share;
      pinnedMandatoryTotal += pin.mandatoryShare;
    }

    // Hoisted here (used by both the cycling-pool cap below and the revolving cascade cap in
    // Step 5) so a single per-month value drives both.
    const mDebtCap = maxDebtPaymentByMonth?.[m];
    // True once every card that started this simulation carrying debt (revolving OR cycling
    // backlog) has reached $0 — i.e. no genuinely-revolving or backlog debt remains this month.
    const allRevolvingClear = cards.every(c => {
      if ((cardStartMonths.get(c.id) ?? 0) > m) return true; // not active yet — doesn't count
      if (!paidOffCards.has(c.id)) return false; // still genuinely revolving
      return (cyclingBacklog.get(c.id) ?? 0) <= 0.005; // cycling with no backlog debt
    });

    // ── Step 2 — Handle paid-off cards: pay purchases, capped by cash above floor ──
    // These cards stay at $0 permanently. Purchase cost is a cash outflow
    // but does NOT create a balance that accrues interest (grace period model).
    // Payments are deferred by one billing cycle: charges from month m are paid
    // in month m+1 (statement closes month-end, payment due ~25 days later).
    // Cap total paid-off payments so currentCash never drops below effectiveFloor.
    const tentativeAvailAboveFloor = Math.max(0, currentCash + monthIncome - monthExpenses + Math.max(0, oneTimeNet) - effectiveFloor);
    // Reserve revolving-card (and backlog-card — see cyclingBacklog) minimums before giving cash
    // to the mandatory cycling pool. Without this, large deferred purchases (e.g. Venture X)
    // drain the pool entirely, leaving revolving/backlog cards with nothing beyond their own
    // minimum in Step 5's avalanche cascade — causing their balances to grow instead of paying
    // down. Backlog cards are included for the same reason genuinely-revolving cards are: their
    // minimum is guaranteed via availableCash (Step 5), which is what's left AFTER this
    // reservation — omitting them here would let the mandatory pool eat into that guarantee.
    const reservedForRevolving = cards
      .filter(c => (cardStartMonths.get(c.id) ?? 0) <= m && (
        (!paidOffCards.has(c.id) && (balances.get(c.id) ?? 0) > 0) ||
        (paidOffCards.has(c.id) && (cyclingBacklog.get(c.id) ?? 0) > 0)
      ))
      .reduce((s, c) => {
        // Reserve the SAME contract minimum the Step 5 cascade will actually enforce
        // (revolvingMinDue), not the plain 2% formula. If this reservation is smaller than what the
        // cascade pays, the extra the cascade pulls toward the revolving card comes out of general
        // cash the mandatory cycling pool was counting on — draining it downstream and shorting
        // cycling cards a cycle or two later (the useCardProjection.cyclingFloor regression). The
        // double-reservation guard below (ccMinAlreadyInFloor) still nets the floor's formula-sized
        // share back out, so the floor reserves `formula` and this layer reserves the rest
        // (`contract − formula`) — together exactly the contract min, and no more.
        // A pinned card reserves its exact pinned Step-5 spend instead of its contract minimum —
        // larger pins shrink the mandatory cycling pool accordingly; smaller pins free cash to it.
        const pin = pinnedThisMonth.get(c.id);
        if (paidOffCards.has(c.id)) {
          if (pin) return s + pin.step5Share;
          return s + revolvingMinDue(c, cyclingBacklog.get(c.id) ?? 0);
        }
        const bal = balances.get(c.id) ?? 0;
        const instBal = installmentBals.get(c.id) ?? 0;
        const revBal = Math.max(0, bal - instBal);
        const instMinPay = upfrontDueFor(c, instBal);
        if (pin) return s + pin.step5Share + instMinPay;
        // Q11: settled cards have no month-0 revolving min to reserve (cycle already paid).
        const revMin = (m === 0 && c.m0MinSettled) ? 0 : revolvingMinDue(c, revBal);
        return s + revMin + instMinPay;
      }, 0);
    // When the active floor already reserved some/all of this (the augmented floor used by the
    // outer-refinement passes in useCardProjection.ts), don't reserve it a second time here — only
    // the gap, if any (e.g. a card missing a dueDay so the floor couldn't include it), still needs
    // protecting at this layer. Omitted entirely by the bootstrap pass (bare floor, nothing to
    // subtract), so this is an exact no-op there.
    const ccMinAlreadyInFloor = ccMinAlreadyInFloorByMonth?.[m] ?? 0;
    const effectiveReservedForRevolving = Math.max(0, reservedForRevolving - ccMinAlreadyInFloor);
    // Pinned cycling cards' mandatory shares are paid outside the pool (fixed, below) — deduct
    // them here so the pool only funds the unpinned cards' distribution.
    let paidOffPool = Math.max(0, tentativeAvailAboveFloor - effectiveReservedForRevolving - pinnedMandatoryTotal);
    let paidOffCashCost = 0;
    const paidOffCardsThisMonth = [...cards].filter(c => paidOffCards.has(c.id));

    // Pre-compute what each cycling card's MANDATORY pool owes this cycle (last cycle's
    // deferred purchases only — never a carried-forward shortfall, see cyclingBacklog).
    const owedByCard = new Map<string, number>();
    for (const card of paidOffCardsThisMonth) {
      owedByCard.set(card.id, Math.round((paidOffDeferredPurchases.get(card.id) ?? 0) * 100) / 100);
    }
    const paidSoFar = new Map<string, number>(paidOffCardsThisMonth.map(c => [c.id, 0]));

    // Once all revolving/backlog debt is clear, a save-up month's cap (maxDebtPaymentByMonth,
    // mirrors Forecast PASS 2's reduced target — see its JSDoc) also applies to the cycling pool —
    // otherwise a full-balance/statement card keeps draining all available cash into its statement
    // even while the caller is trying to preserve cash for an upcoming large expense. Floored at
    // the cycling cards' own contract minimums so this can never violate a minimum payment,
    // mirroring the max(mDebtCap, totalMins) guarantee the Step 5 cascade cap uses below.
    if (allRevolvingClear && mDebtCap !== undefined && isFinite(mDebtCap)) {
      const cyclingMinTotal = paidOffCardsThisMonth.reduce((s, c) => {
        if (pinnedThisMonth.has(c.id)) return s; // pinned spend is fixed and already off-pool
        const owed = owedByCard.get(c.id) ?? 0;
        if (owed <= 0) return s;
        const minRequired = Math.min(Math.max(25, Math.round(owed * 0.02 * 100) / 100), owed);
        return s + minRequired;
      }, 0);
      // Pinned mandatory spend consumes the cap first (it was already deducted from the pool).
      paidOffPool = Math.min(paidOffPool, Math.max(mDebtCap - pinnedMandatoryTotal, cyclingMinTotal));
    }

    // Split `pool` across `cards` proportional to each card's need (per `needFn`), capping each
    // at its own need and redistributing any leftover (from cards whose need was smaller than
    // their proportional share) to the cards still wanting more — classic water-filling, so no
    // single card ever claims 100% of a tight pool while another gets $0. Previously this used a
    // strict priority order (by APR, or by "was shorted last cycle"); with two cycling cards
    // competing for a pool that's tight every month, strict priority made each one flip-flop
    // between a large catch-up payment and $0 as priority alternated — proportional sharing
    // avoids that oscillation while still giving more to whichever card needs more.
    const distributeProportionally = (pool: number, eligible: CardData[], needFn: (id: string) => number) => {
      let remainingPool = pool;
      let remaining = eligible.filter(c => needFn(c.id) > 0.005);
      let guard = 0;
      while (remainingPool > 0.005 && remaining.length > 0 && guard < remaining.length + 1) {
        guard++;
        const totalNeed = remaining.reduce((s, c) => s + needFn(c.id), 0);
        if (totalNeed <= 0.005) break;
        let used = 0;
        for (const card of remaining) {
          const need = needFn(card.id);
          const share = remainingPool * (need / totalNeed);
          const give = Math.round(Math.min(share, need) * 100) / 100;
          paidSoFar.set(card.id, Math.round(((paidSoFar.get(card.id) ?? 0) + give) * 100) / 100);
          used += give;
        }
        remainingPool = Math.round((remainingPool - used) * 100) / 100;
        remaining = remaining.filter(c => needFn(c.id) > 0.005);
        if (used < 0.005) break;
      }
      return remainingPool;
    };

    // Phase A — guarantee every cycling card at least its minimum payment (capped at what it
    // actually owes), mirroring the same guarantee revolving cards already get (see
    // reservedForRevolving above and the minimum-enforcement guard below). Without this, a card
    // can be shut out entirely ($0) in a tight month even though its minimum is tiny.
    // needFn subtracts paidSoFar (mirroring Phase B below) so a card's need correctly drops to 0
    // once its guarantee is met and distributeProportionally's water-filling loop excludes it from
    // `remaining` on the next iteration. Without this, a tight pool that needs more than one
    // iteration to fully distribute (see distributeProportionally's `guard`-bounded while loop)
    // re-fed every card its FULL constant target on every pass instead of its remaining target —
    // the card with the larger target compounds this fastest, absorbing several multiples of its
    // intended guarantee before the guard cutoff stops it, starving competing cycling cards of
    // Phase B's leftover entirely (confirmed live: a $669 pool intended to split ~$479/$190
    // between two cycling cards instead landed $604/$65).
    // Pinned cards are excluded from both phases (their payment is fixed, spend already deducted
    // from the pool) — the needFn→0 exclusion pattern, applied via the eligible list.
    const unpinnedPaidOffCards = paidOffCardsThisMonth.filter(c => !pinnedThisMonth.has(c.id));
    paidOffPool = distributeProportionally(
      paidOffPool, unpinnedPaidOffCards,
      id => Math.max(0, Math.min(cards.find(c => c.id === id)!.minPayment, owedByCard.get(id) ?? 0) - (paidSoFar.get(id) ?? 0)),
    );

    // Phase B — distribute the remaining pool toward full payoff, proportional to what's left
    // owed (so a card with a bigger carried-forward shortfall gets more of the pool, without ever
    // zeroing out a competing card outright).
    // Phase B is the last claim on this pool — what it returns unspent is deliberately left as
    // cash rather than cascaded further, so the leftover is discarded rather than reassigned.
    distributeProportionally(
      paidOffPool, unpinnedPaidOffCards,
      id => Math.max(0, (owedByCard.get(id) ?? 0) - (paidSoFar.get(id) ?? 0)),
    );

    // mandatoryPayByCard is NOT pushed to monthlyPayments yet — a card may also receive a
    // backlog-cascade payment later this same month (Step 5), and every downstream consumer
    // indexes monthlyPayments positionally by month, so there must be exactly one push per card
    // per month. The final, consolidated push happens after Step 5/6 resolve any backlog payment.
    const mandatoryPayByCard = new Map<string, number>();
    for (const card of paidOffCardsThisMonth) {
      // Pay PREVIOUS month's deferred charges (billing cycle delay) — mandatory, unconditional.
      const owedThisCycle = owedByCard.get(card.id) ?? 0;
      // Absolute backstop: minimums should always be met when there's anything owed, even in the
      // rare case the pool above couldn't cover it (mirrors the revolving-card guard below).
      // A pinned card pays exactly its pinned mandatory share — no pool draw, no minimum backstop
      // (pinning below the minimum is an explicit user command); any unpaid statement remainder
      // rolls into interest-bearing backlog below, same as an underfunded pool month.
      const minRequired = Math.min(Math.max(25, Math.round(owedThisCycle * 0.02 * 100) / 100), owedThisCycle);
      const pin = pinnedThisMonth.get(card.id);
      const pay = pin ? pin.mandatoryShare
        : Math.max(paidSoFar.get(card.id) ?? 0, owedThisCycle > 0 ? minRequired : 0);
      mandatoryPayByCard.set(card.id, pay);
      paidOffCashCost += pay;
      // Display combines this cycle's mandatory statement with the (already post-interest, see
      // Step 1b) backlog amount, so "Start balance" never appears to silently drop debt even
      // though two different mechanisms fund it (mandatory pool here; backlog cascade in Step 5).
      const backlogNow = cyclingBacklog.get(card.id) ?? 0;
      monthlyCyclingOwed.get(card.id)!.push(Math.round((owedThisCycle + backlogNow) * 100) / 100);
      monthlyCyclingInterest.get(card.id)!.push(backlogInterestMap.get(card.id) ?? 0);
      monthlyInterest.get(card.id)!.push(0); // cycling cards track interest via monthlyCyclingInterest instead
      // Carry forward any unpaid amount when the pool couldn't cover the full mandatory
      // statement — this becomes real, interest-bearing backlog debt (Step 1b next month),
      // competing for "extra" cash in the avalanche/snowball cascade (Step 5) instead of
      // recompounding into next cycle's mandatory pool the way it used to.
      const unpaidPrincipal = Math.round((owedThisCycle - pay) * 100) / 100;
      if (unpaidPrincipal > 0.01) {
        cyclingBacklog.set(card.id, Math.round((backlogNow + unpaidPrincipal) * 100) / 100);
      }
      const thisMonthPurchases = Math.max(cardPurchasesThisMonth(card), card.monthlyNewPurchases);
      paidOffDeferredPurchases.set(card.id, thisMonthPurchases);
    }
    // Cycling cards already pushed above — push 0 for cards not yet in cycling mode
    // this month (still revolving, or not yet active) to keep all per-month arrays aligned.
    for (const card of cards) {
      if ((cardStartMonths.get(card.id) ?? 0) > m || paidOffCards.has(card.id)) continue;
      monthlyCyclingOwed.get(card.id)!.push(0);
      monthlyCyclingInterest.get(card.id)!.push(0);
    }

    // Cards still carrying debt (exclude pre-start cards — they already got 0 pushed above)
    const debtCards = cards.filter(c => !paidOffCards.has(c.id) && (cardStartMonths.get(c.id) ?? 0) <= m);
    // Cycling cards carrying backlog debt — compete for "extra" cash in the SAME avalanche/
    // snowball cascade as debtCards (Step 5), separate from debtCards itself so Step 4's
    // balBeforePayment (which adds this month's fresh purchases) never double-counts a backlog
    // card's purchases — those are already funded by the mandatory pool above (Step 2).
    const backlogCards = cards.filter(c =>
      paidOffCards.has(c.id) && (cyclingBacklog.get(c.id) ?? 0) > 0.005 && (cardStartMonths.get(c.id) ?? 0) <= m,
    );

    // ── Step 2.5 — Mandatory installment plan payments ──────────────────────────────────────
    // Installment portions are interest-free but require a fixed payment each month. Computed
    // here so Step 3 (interest) can exclude the installment balance, and Step 5 (cascade) can
    // deduct them from availableCash before allocating surplus. Actual balance updates happen
    // in Step 6 after the cascade — so installmentBals[card] still reflects the START-of-month
    // value through Steps 3–5, which the grace-period and paidOff-transition checks need.
    //
    // installmentPayByCard = total mandatory payment (upfront plan + BNPL) for each card.
    // upfrontInstPayByCard = upfront plan payment only — used in Step 6 to reduce installmentBals.
    //   BNPL charges wash out within the month (charge = payment) so installmentBals is unaffected.
    const installmentPayByCard = new Map<string, number>();
    const upfrontInstPayByCard = new Map<string, number>();
    let installmentCashCost = 0;
    for (const card of debtCards) {
      // Upfront installment plan (e.g. Chase Plan It): fixed monthly payment on existing balance
      const instBal = installmentBals.get(card.id) ?? 0;
      const upfrontDue = Math.round(upfrontDueFor(card, instBal) * 100) / 100;
      if (upfrontDue > 0) {
        installmentPayByCard.set(card.id, upfrontDue);
        upfrontInstPayByCard.set(card.id, upfrontDue);
        installmentCashCost += upfrontDue;
      }
      // BNPL monthly charge (e.g. Amazon BNPL): charge hits card as new purchase, payment
      // covers it in full — cascade should not also try to pay this portion.
      const bnplCharge = installmentChargeByMonth?.[m]?.[card.id] ?? 0;
      if (bnplCharge > 0) {
        const bnplPay = Math.round(bnplCharge * 100) / 100;
        installmentPayByCard.set(card.id, (installmentPayByCard.get(card.id) ?? 0) + bnplPay);
        installmentCashCost += bnplPay;
      }
    }

    // ── Step 3 — Compute interest on STARTING balances ────────
    // Interest is charged only on the balance carried from last month.
    // For statement-balance preference cards in grace period (last payment covered
    // the full statement balance), new purchases carry without accruing interest —
    // matching real credit card grace period behavior.
    // A multi-rate card additionally accrues each tranche's own interest into its ledger here, so
    // a promo tranche compounds at ITS rate until it reprices (revolvingInterestFor resolves the
    // rates as of trancheAsOf). The untranched remainder is implicit — balance minus tranche sum —
    // so its share of the interest needs no bookkeeping.
    const interestMap = new Map<string, number>();
    for (const card of debtCards) {
      const { interest, lineInterest } = revolvingInterestFor(card);
      interestMap.set(card.id, interest);
      if (lineInterest.some(v => v > 0)) {
        const ledger = trancheBals.get(card.id) ?? [];
        trancheBals.set(card.id, ledger.map((b, i) => Math.round((b + (lineInterest[i] ?? 0)) * 100) / 100));
      }
    }

    // ── Step 4 — Balance before payment = startBal + interest + purchases ──
    const balBeforePayment = new Map<string, number>();
    for (const card of debtCards) {
      const bal = balances.get(card.id) ?? 0;
      const interest = interestMap.get(card.id) ?? 0;
      const purchases = cardPurchasesThisMonth(card);
      balBeforePayment.set(card.id, bal + interest + purchases);
    }

    // Unified "amount owed" accessor across both genuinely-revolving cards (debtCards) and
    // cycling cards carrying backlog (backlogCards) — lets Step 5's avalanche/snowball cascade
    // treat both groups as one combined priority list. No paymentPreference/statement cap here
    // (that's only relevant for the EXTRA-cash cascade target, see cascadeTarget below) — this is
    // the full amount that could ever be owed, used for minimums and sort order.
    const owedForCard = (id: string): number => balBeforePayment.get(id) ?? cyclingBacklog.get(id) ?? 0;
    // Extra-cash cascade target: genuinely-revolving statement-preference cards cap at
    // startBal+interest (avoid prepaying new purchases); backlog cards have no purchases mixed
    // in to begin with, so their full backlog amount is always the target.
    const cascadeTarget = (card: CardData): number => {
      if (balBeforePayment.has(card.id)) {
        // Cascade targets only the revolving (non-installment) portion — the installment
        // payment is already handled as a mandatory deduction in Step 2.5/Step 6.
        const instBal = installmentBals.get(card.id) ?? 0;
        if (card.paymentPreference === 'statement') {
          const startBal = balances.get(card.id) ?? 0;
          const interest = interestMap.get(card.id) ?? 0;
          return Math.max(0, startBal - instBal + interest);
        }
        // For non-statement cards, also subtract the BNPL charge for this month — it appears in
        // balBeforePayment as a new purchase but is paid mandatorily (not by the revolving cascade).
        const bnplPay = installmentChargeByMonth?.[m]?.[card.id] ?? 0;
        return Math.max(0, balBeforePayment.get(card.id)! - instBal - bnplPay);
      }
      return cyclingBacklog.get(card.id) ?? 0;
    };

    // ── Step 5 — Available surplus for debt payoff ────────────
    // Minimum for revolving cards excludes the installment portion (handled separately as
    // installmentCashCost, already deducted from availableCash). Minimum for backlog cards is unchanged.
    const totalMins = [...debtCards, ...backlogCards].reduce((s, c) => {
      if (pinnedThisMonth.has(c.id)) return s; // pinned spend is fixed — deducted from the pool below
      if (m === 0 && c.m0MinSettled) return s; // Q11: month-0 min already paid this cycle
      const owed = owedForCard(c.id);
      const instBal = installmentBals.get(c.id) ?? 0;
      const revOwed = Math.max(0, owed - instBal);
      return s + revolvingMinDue(c, revOwed);
    }, 0);

    // availableCash = what's left above the floor after income, expenses, paid-off costs,
    // mandatory installment payments, and one-time items for this month.
    // Month 0 uses month0SafeFloor (= max(cashFloor, ppBills)) so the projection matches recommendations.
    // effectiveFloor and oneTimeNet are computed at top of this iteration (before Step 2).
    // pinnedStep5Total: pinned cards' fixed Step-5 spend comes off the top — the cascade below
    // only allocates the remainder across unpinned cards.
    // End-of-month cash IS next month's pre-paycheck cash (endCash[m] is judged against month
    // m+1's floor), so the discretionary pool must not drain below NEXT month's floor either —
    // draining to only this month's floor makes every bill-timing step-up month start below its
    // own floor (Q9: Discover absorbed the difference as uncapped avalanche cash).
    const nextMonthFloor = m + 1 < months ? (cashFloorByMonth?.[m + 1] ?? cashFloor) : effectiveFloor;
    // FLOOR_CUSHION_DOLLARS (months > 0 only): draining to EXACTLY the floor lets sub-tolerance
    // convergence residue land cents below it (see floor-protection.ts). Month 0 stays uncushioned
    // so the projection keeps matching the live safe-to-pay recommendation exactly.
    const step5Floor = Math.max(effectiveFloor, nextMonthFloor) + (m > 0 ? FLOOR_CUSHION_DOLLARS : 0);
    let availableCash = currentCash + monthIncome - monthExpenses - step5Floor - paidOffCashCost + oneTimeNet - installmentCashCost - pinnedStep5Total;
    if (availableCash < 0) {
      flags.push({ month: m + 1, flag: 'UNSTABLE' });
      availableCash = 0;
    }

    // Cap debt allocation in save-up months (look-ahead pre-pass set these to ccMinTotal).
    // B2: the cap can never force the deployable cash below this month's true minimums (totalMins,
    // now the contract-min sum via revolvingMinDue). Without the max(mDebtCap, totalMins) floor a
    // save-up cap sized on the 2% formula could drop availableCash below the contract minimums the
    // cascade is about to enforce, forcing the min-enforcement guard to override it and silently
    // over-draining cash beyond what the look-ahead reserved. Still bounded above by the real
    // availableCash, so this never invents cash the month doesn't have.
    // (mDebtCap hoisted above, before Step 2 — also drives the cycling-pool cap there.)
    if (mDebtCap !== undefined && isFinite(mDebtCap)) {
      // Pinned Step-5 spend consumes the cap first (mirrors the Step-2 cap's pinnedMandatoryTotal
      // deduction) — availableCash above already excludes it, so the cap must too.
      availableCash = Math.min(availableCash, Math.max(mDebtCap - pinnedStep5Total, totalMins));
    }

    // Convergence target (Phase 2 Option C): the forecast engine's authoritative revolving debt
    // cash for this month REPLACES the sim's own pool — the engine's cash walk is the source of
    // truth, so this may push availableCash above what the sim's approximate walk thinks exists
    // (surplus months) or below it (clamp months). Floored at totalMins so contract minimums are
    // never violated by a lower target; the cascade below still caps every card at what it owes,
    // so excess target cash is never spent. Wins over mDebtCap when both are provided.
    const mDebtTarget = debtCashTargetByMonth?.[m];
    if (mDebtTarget !== undefined && isFinite(mDebtTarget)) {
      // The target is the TOTAL revolving debt cash for the month; pinned Step-5 spend comes out
      // of it first, leaving the remainder for the unpinned cascade.
      availableCash = Math.max(mDebtTarget - pinnedStep5Total, totalMins);
    }

    const payments = new Map<string, number>(cards.map(c => [c.id, 0]));

    if (availableCash < totalMins) {
      // FLOOR_BREACHED: can't cover all minimums above the floor
      flags.push({ month: m + 1, flag: 'FLOOR_BREACHED' });
      cashFloorBreaches.push({ month: m + 1, endingCash: currentCash - totalMins - paidOffCashCost });

      // Snowball protection: pay smallest balances first when cash is tight. Backlog cards are
      // folded in via owedForCard — sorting by bare `balances` (always 0 for a backlog card)
      // would incorrectly put every backlog card first regardless of how much it actually owes.
      const sortedForBreached = [...debtCards, ...backlogCards]
        .filter(c => !pinnedThisMonth.has(c.id)) // pinned cards pay their fixed pin regardless
        .sort((a, b) => owedForCard(a.id) - owedForCard(b.id));
      // Deduct mandatory installment payments first — they are as non-negotiable as revolving
      // mins. Pinned Step-5 spend is equally fixed (explicit user command), so it comes out too.
      let remainingForMins = Math.max(0, currentCash - installmentCashCost - pinnedStep5Total);
      let atRiskWarningEmitted = false;
      for (const card of sortedForBreached) {
        const owed = owedForCard(card.id);
        const instBal = installmentBals.get(card.id) ?? 0;
        const revOwed = Math.max(0, owed - instBal);
        const min = (m === 0 && card.m0MinSettled) ? 0 : revolvingMinDue(card, revOwed);
        if (remainingForMins >= min) {
          payments.set(card.id, min);
          remainingForMins -= min;
        } else {
          payments.set(card.id, 0);
          flags.push({ month: m + 1, flag: 'CARD_AT_RISK', cardId: card.id });
          if (!atRiskWarningEmitted) {
            warningMessages.push({
              month: m + 1,
              message: 'Available cash cannot cover all minimum payments. Consider reducing expenses or increasing income.',
            });
            atRiskWarningEmitted = true;
          }
        }
      }

    } else {
      // Sort by strategy only. Cards with a paymentPreference still have a revolving balance
      // here — they compete under normal avalanche/snowball until balance reaches zero, at
      // which point they transition to paidOffCards (cycling mode). No priority boost. Backlog
      // cards (cycling cards carrying unpaid debt) compete in this SAME combined priority list —
      // this is the literal "next card in line gets the extra cash" cascade.
      //
      // Avalanche sorts on the MARGINAL rate, not the account's stated APR: the next dollar paid to
      // a multi-rate card lands on its highest-APR bucket (CARD Act §164), which can sit well above
      // card.apr — so a card whose standard rate is low but which carries an expensive tranche
      // belongs ahead of cards it used to sort behind. Identical to `b.apr - a.apr` for every card
      // without tranches, which is every card until one is entered.
      const avalancheApr = (c: CardData): number => marginalApr(
        c, trancheBals.get(c.id) ?? [],
        Math.max(0, owedForCard(c.id) - (installmentBals.get(c.id) ?? 0)), trancheAsOf,
      );
      const strategyOrder = [...debtCards, ...backlogCards]
        .filter(c => !pinnedThisMonth.has(c.id)) // pinned cards sit outside the cascade entirely
        .sort((a, b) =>
          strategy === 'avalanche'
            ? avalancheApr(b) - avalancheApr(a)
            : owedForCard(a.id) - owedForCard(b.id)
        );

      // ── Step 5a — Pay minimums ─────────────────────────────
      let remaining = availableCash;
      for (const card of strategyOrder) {
        const owedStep5 = owedForCard(card.id);
        const instBal = installmentBals.get(card.id) ?? 0;
        const revOwed = Math.max(0, owedStep5 - instBal);
        const baseMin = (m === 0 && card.m0MinSettled) ? 0 : revolvingMinDue(card, revOwed);
        const min = Math.min(baseMin, remaining);
        payments.set(card.id, min);
        remaining -= min;
      }

      // ── Step 5b — Cascade surplus to priority cards ────────
      // Strategy order (avalanche/snowball) determines priority.
      // paymentPreference is an overlay that caps the amount allocated per card:
      //   null/full: pay as much as possible toward this card (standard cascade)
      //   statement: cap at startBal + interest — avoids paying new purchases this cycle
      //   backlog card: full backlog amount — no purchases mixed in to cap against
      for (const card of strategyOrder) {
        if (remaining <= 0) break;
        const currentPayment = payments.get(card.id) ?? 0;
        const target = cascadeTarget(card);
        const maxExtra = Math.max(0, target - currentPayment);
        const extra = Math.min(remaining, maxExtra);
        if (extra > 0) {
          payments.set(card.id, currentPayment + extra);
          remaining -= extra;
        }
      }
    }

    // Pinned cards receive exactly their pinned Step-5 share, set outside both allocation
    // branches above (their cash was already deducted from availableCash / remainingForMins).
    // For a revolving card this is the cascade share (pin − installment due); for a cycling card
    // it's the backlog-paydown share, applied in Step 6b.
    for (const [id, pin] of pinnedThisMonth) {
      payments.set(id, pin.step5Share);
    }

    // ── Minimum enforcement guard ──────────────────────────────────────
    // After all allocation, ensure every active debt card (and backlog card) receives at least
    // the revolving-portion minimum. Installment payment is already tracked in installmentPayByCard.
    // Pinned cards are exempt — a below-minimum pin is an explicit user command (see param JSDoc).
    for (const card of [...debtCards, ...backlogCards]) {
      if (pinnedThisMonth.has(card.id)) continue;
      if (m === 0 && card.m0MinSettled) continue; // Q11: no forced month-0 min to enforce
      const owed = owedForCard(card.id);
      const instBal = installmentBals.get(card.id) ?? 0;
      const revOwed = Math.max(0, owed - instBal);
      const currentPay = payments.get(card.id) ?? 0;
      const minRequired = revolvingMinDue(card, revOwed);
      if (currentPay < minRequired && revOwed > 0) {
        payments.set(card.id, minRequired);
      }
    }

    // ── Step 6 — Apply payments, update balances, emit transactions ──
    let totalDebtPayments = paidOffCashCost;
    for (const card of debtCards) {
      const startBal = balances.get(card.id) ?? 0;
      const interest = interestMap.get(card.id) ?? 0;
      const purchases = cardPurchasesThisMonth(card);
      const pay = Math.round((payments.get(card.id) ?? 0) * 100) / 100;
      // Installment payment is mandatory and separate from the revolving cascade.
      const instPayThisMonth = installmentPayByCard.get(card.id) ?? 0;
      const totalPay = Math.round((pay + instPayThisMonth) * 100) / 100;
      monthlyPayments.get(card.id)!.push(totalPay);
      // `pay` is exactly the Step-5 pool spend (payments map, post-guard); the installment share
      // is mandatory cash paid outside the pool.
      monthlyDebtCashPayment.get(card.id)!.push(pay);
      monthlyInterest.get(card.id)!.push(interest);
      totalDebtPayments += totalPay;

      const bbp = balBeforePayment.get(card.id) ?? 0; // startBal + interest + purchases
      // Round to cents here, not just where this value is later displayed — otherwise tiny
      // floating-point residue (e.g. 1337.1300000000006) silently carries into next month's
      // startBal and compounds across the whole simulation.
      const endBal = Math.round(Math.max(0, bbp - totalPay) * 100) / 100;
      const finalBal = endBal < 1 ? 0 : endBal; // clear sub-dollar dust
      balances.set(card.id, finalBal);
      // When the total balance just reached $0, pre-seed deferred purchases so the
      // first paidOff month pays monthlyNewPurchases instead of $0 (billing-delay artifact).
      // Fall back to monthlyNewPurchases for statement/autopay cards whose rules aren't tagged
      // with this card's payment_source (cardPurchasesThisMonth would be 0 → $0/$— display).
      if (finalBal === 0 && !paidOffCards.has(card.id)) {
        const seedAmt = (card.paymentPreference === 'statement' || card.autopayFullBalance)
          ? Math.max(cardPurchasesThisMonth(card), card.monthlyNewPurchases)
          : cardPurchasesThisMonth(card);
        paidOffDeferredPurchases.set(card.id, seedAmt);
      }

      // Statement-preference cards never hit finalBal === 0 while carrying revolving debt
      // (end balance = purchases > 0). Transition them to paidOffCards when the REVOLVING
      // portion has dropped to purchases level — i.e., revolving debt is gone. Uses the
      // start-of-month installment balance (not yet reduced) to isolate the revolving carry-over.
      const startInstBal = installmentBals.get(card.id) ?? 0; // still pre-Step-6 value
      // Use upfront-only installment pay — BNPL payment washes out (charge=pay) and doesn't
      // change the revolving carry-over calculation.
      const upfrontInstPay = upfrontInstPayByCard.get(card.id) ?? 0;
      const revolvingFinalBal = finalBal - startInstBal + upfrontInstPay; // revolving remaining
      // Remaining 0%-installment balance AFTER this month's plan payment. A statement card whose
      // revolving portion is gone may still be carrying a 0% installment (e.g. Prime Visa's Amazon
      // plan) — retiring it here would set balances to 0 and drop it from debtCards, silently
      // deleting the installment remainder and halting its fixed monthly payment. Keep it an active
      // debt card (revolving = 0, so no interest and no surplus target) until the plan amortizes to
      // $0; only then does it truly reach a zero balance and transition.
      const remainingInstAfterPay = Math.max(0, Math.round((startInstBal - upfrontInstPay) * 100) / 100);
      if (
        card.paymentPreference === 'statement' &&
        !paidOffCards.has(card.id) &&
        finalBal > 0 &&
        revolvingFinalBal >= 0 &&
        // Sub-dollar tolerance (same < $1 dust convention as the finalBal clear above): the
        // convergence loop's whole-dollar debtCashTargetByMonth can leave the payoff payment
        // cents short, and a +/-$0.01 tolerance kept that dust card in debtCards forever (Q10).
        revolvingFinalBal < cardPurchasesThisMonth(card) + 1 &&
        remainingInstAfterPay <= 0.01
      ) {
        paidOffCards.add(card.id);
        paidOffDeferredPurchases.set(card.id,
          Math.max(cardPurchasesThisMonth(card), card.monthlyNewPurchases));
        balances.set(card.id, 0);
      }

      // If this card's total balance just reached $0 (either path above), retroactively correct
      // the cycling display arrays pushed as 0-placeholders in Step 2.
      if ((balances.get(card.id) ?? 0) === 0) {
        const owedArr = monthlyCyclingOwed.get(card.id);
        const interestArr = monthlyCyclingInterest.get(card.id);
        if (owedArr && owedArr.length > 0) owedArr[owedArr.length - 1] = Math.round(startBal * 100) / 100;
        if (interestArr && interestArr.length > 0) interestArr[interestArr.length - 1] = interest;
      }

      // Tranche ledger: this cycle's payment goes to the highest-APR bucket first (CARD Act §164,
      // via balance-tranches.ts's allocator), then the ledger is clamped to what the card actually
      // still owes — which is how the engine's own card-level moves (sub-dollar dust clearing, the
      // payoff/cycling transition above, a cash-floor shortfall) reach it. No-op without tranches.
      if ((card.tranches?.length ?? 0) > 0) {
        const ledger = trancheBals.get(card.id) ?? [];
        const revBeforePay = Math.max(0, Math.round((bbp - startInstBal) * 100) / 100);
        const endBalNow = balances.get(card.id) ?? 0;
        const instAfterPay = Math.max(0, Math.round((startInstBal - upfrontInstPay) * 100) / 100);
        trancheBals.set(card.id, clampTranches(
          applyTranchePayment(card, ledger, revBeforePay, pay, trancheAsOf),
          Math.max(0, Math.round((endBalNow - instAfterPay) * 100) / 100),
        ));
      }

      // Update grace state: grace applies next month if the revolving carry-over
      // (startBal minus installment portion, plus interest) was fully covered by the
      // revolving cascade payment. installmentBals still holds the start-of-month value.
      // Partial-ISB grace (see graceUnpaid): a card that WAS in the grace regime and covered only
      // part of its statement stays there carrying the shortfall, and only the shortfall accrues
      // next cycle. graceMap itself keeps its exact old meaning — fully covered, nothing accrues.
      if (card.paymentPreference === 'statement') {
        const ms = manualStatementByCard.get(card.id);
        const dueThisCycle = (ms && m === ms.dueMonth)
          // Paying the user-entered interest-saving amount is by definition what keeps the
          // card interest-free — the unbilled remainder is not yet due and can't break grace.
          ? ms.amount
          : Math.round((startBal - startInstBal + interest) * 100) / 100;
        if (ms && m < ms.dueMonth) {
          // Statement already paid this cycle (due day passed before today) — grace persists.
          graceMap.set(card.id, true);
          graceUnpaid.set(card.id, 0);
        } else {
          const covered = pay >= dueThisCycle - 0.01;
          const wasInRegime = (graceMap.get(card.id) ?? false) || (graceUnpaid.get(card.id) ?? 0) > 0;
          graceMap.set(card.id, covered);
          graceUnpaid.set(card.id, covered || !wasInRegime
            ? 0
            : Math.max(0, Math.round((dueThisCycle - pay) * 100) / 100));
        }
      }

      // Reduce installment balance by the UPFRONT plan payment only.
      // BNPL payments (in instPayThisMonth but not upfrontInstPay) wash out within the month
      // (charge = payment) and do not reduce the tracked installment balance.
      if (upfrontInstPay > 0) {
        installmentBals.set(card.id, Math.max(0, Math.round((startInstBal - upfrontInstPay) * 100) / 100));
      }

      if (totalPay > 0) {
        debtPaymentTransactions.push({
          date: payDateStr, description: `${card.name} Payment`,
          amount: totalPay, account: fundingAccountId ?? '',
          category: 'Debt Payments', card: card.id,
          type: 'debt_payoff', projected: true,
        });
      }
    }

    // ── Step 6b — Apply backlog-cascade payments (cycling cards carrying backlog) ──
    // Simpler than the debtCards loop above: no purchases, grace period, or transition logic —
    // a backlog card stays in paidOffCards throughout (its mandatory current-cycle statement
    // keeps being funded by Step 2 regardless of backlog status). Just principal paydown.
    const backlogPayByCard = new Map<string, number>();
    for (const card of backlogCards) {
      const pay = Math.round((payments.get(card.id) ?? 0) * 100) / 100;
      backlogPayByCard.set(card.id, pay);
      totalDebtPayments += pay;
      const remaining = Math.round((cyclingBacklog.get(card.id)! - pay) * 100) / 100;
      cyclingBacklog.set(card.id, remaining < 1 ? 0 : remaining); // clear sub-dollar dust
      if (pay > 0) {
        debtPaymentTransactions.push({
          date: payDateStr, description: `${card.name} Payment`,
          amount: pay, account: fundingAccountId ?? '',
          category: 'Debt Payments', card: card.id,
          type: 'debt_payoff', projected: true,
        });
      }
    }

    // ── Step 6c — Single consolidated monthlyPayments push for every cycling card ──
    // A cycling card may have been funded by BOTH the mandatory pool (Step 2) and the backlog
    // cascade (Step 6b) this month. Every downstream consumer indexes monthlyPayments
    // positionally by month, so there must be exactly one push per card per month — push the
    // summed amount here rather than letting Step 2 push directly.
    for (const card of paidOffCardsThisMonth) {
      const mandatoryPay = mandatoryPayByCard.get(card.id) ?? 0;
      const backlogPay = backlogPayByCard.get(card.id) ?? 0;
      monthlyPayments.get(card.id)!.push(Math.round((mandatoryPay + backlogPay) * 100) / 100);
      monthlyMandatoryCyclingPayment.get(card.id)!.push(mandatoryPay);
      // Only the backlog-cascade share came out of the Step-5 debt-cash pool; the mandatory
      // statement was funded by the Step-2 cycling pool.
      monthlyDebtCashPayment.get(card.id)!.push(backlogPay);
    }
    // debtCards never overlap with paidOffCardsThisMonth, so they need their own (mandatory-only,
    // i.e. zero) entry to keep this array aligned with monthlyPayments for every card/month.
    for (const card of debtCards) {
      monthlyMandatoryCyclingPayment.get(card.id)!.push(0);
    }

    // Record end-of-month balance for all active cards (paid-off cards with no backlog show $0).
    // monthlyBalances additionally falls back to the backlog amount (harmless — projectCardVariable's
    // cycling-row branch never reads trueBalanceByMonth, only its revolving branch does, and a
    // backlog-carrying card is never revolving by this field's definition — see monthlyCyclingBacklog
    // below for the dedicated, unambiguous backlog signal). monthlyRevolvingBalances deliberately does
    // NOT fall back to backlog: projectCardVariable's isCycling check (and useCardProjection.ts's own
    // cycling-vs-revolving branches) gate on this field being exactly 0 for a cycling card, and that
    // must stay a one-way signal — a backlog fluctuating this field back to nonzero would wrongly
    // flip a cycling card's DISPLAY into the revolving branch the moment it falls behind.
    for (const card of cards) {
      if ((cardStartMonths.get(card.id) ?? 0) <= m) {
        const endBal = balances.get(card.id) ?? 0;
        const backlog = cyclingBacklog.get(card.id) ?? 0;
        monthlyBalances.get(card.id)!.push(endBal > 0 ? endBal : backlog);
        monthlyCyclingBacklog.get(card.id)!.push(backlog);
        // For statement-preference cards, subtract actual purchases charged this month so only
        // the revolving carry-over (interest-bearing debt) is counted. Month 0 uses 0 purchases
        // (live balance already includes them), so endBal itself is the revolving balance.
        const revolvingBal = card.paymentPreference === 'statement'
          ? Math.round(Math.max(0, endBal - cardPurchasesThisMonth(card)) * 100) / 100
          : endBal;
        monthlyRevolvingBalances.get(card.id)!.push(revolvingBal);
      }
    }

    // Payoff ETA = last month where any card still carried real debt (revolving balance or
    // cycling backlog) — freezes once both are fully paid off, same as before this redesign.
    if (debtCards.length > 0 || backlogCards.length > 0) {
      projectedPayoffMonths = m + 1;
    }

    // ── Step 7 — Advance cash ──────────────────────────────────
    currentCash = Math.round((currentCash + monthIncome - monthExpenses - totalDebtPayments) * 100) / 100;
    // One-time items applied AFTER debt allocation to avoid look-ahead cash hoarding
    const oneTime = oneTimeByMonth?.[m];
    if (oneTime && (oneTime.income > 0 || oneTime.expenses > 0)) {
      currentCash = Math.round((currentCash + oneTime.income - oneTime.expenses) * 100) / 100;
    }
    projectedCashByMonth.push(currentCash);
  }

  return {
    monthlyPayments,
    monthlyBalances,
    monthlyRevolvingBalances,
    perCardMinPayments,
    monthlyCyclingOwed,
    monthlyCyclingInterest,
    monthlyInterest,
    monthlyMandatoryCyclingPayment,
    monthlyDebtCashPayment,
    monthlyCyclingBacklog,
    projectedPayoffMonths,
    cashFloorBreaches,
    flags,
    projectedCashByMonth,
    debtPaymentTransactions,
    warningMessages,
  };
}

/**
 * Generate due-date-aware recommendations using estimated liquid cash by each card's due date.
 */
export function generateRecommendations(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  monthlyTakeHome: number,
  monthlyExpenses: number,
  paymentMode: 'variable' | 'consistent' = 'variable',
  payConfig?: PayScheduleConfig,
  rules?: RuleRow[],
  fundingAccountId?: string | null,
  prePaycheckBillsTotal?: number,
  fundingBalance?: number,
  oneTimeExpensesThisMonth?: number,
  oneTimeIncomeThisMonth?: number,
  transactions?: EnrichedTransaction[],
  primaryDueDay?: number,
  monthlySavingsAndCar?: number,
  syncCutoffDate?: string,
  // Remaining-this-month cash outflow from payment plans sourced from the funding/checking account
  // (not credit-card-sourced plans, which hit card balances). These are real upcoming outflows that
  // reduce the cash available to deploy toward debt, but they don't appear in the transaction stream,
  // so subtract them from availableAboveFloor below. Already cutoff-scoped by the caller.
  month0PlanOutflow = 0,
  // §1B Stage 4A — rule occurrences the user confirmed a bank transaction already paid. Optional
  // and defaulted: omitting it must leave the recommendation byte-identical to pre-Stage-4.
  confirmedOccurrences?: ConfirmedOccurrences,
): RecommendationSummary {
  // Preference cards = zero-balance cycling cards only (balance <= 0 encoded in autopayFullBalance).
  // Positive-balance full/statement cards compete under normal strategy in revolvingCards —
  // the preference only kicks in once the balance reaches zero (cycling mode going forward).
  const preferenceCards = cards.filter(c => c.autopayFullBalance);
  const revolvingCards = cards.filter(c => !c.autopayFullBalance && c.balance > 0);

  // Manual interest-saving balance: this month's obligation is $0 when the card's due day
  // has already passed (that statement was paid before today), else exactly the entered
  // amount. Mirrors the synthetic pin in simulateVariablePayoff.
  const manualStmtDueNow = (card: CardData): number | null => {
    if (card.paymentPreference !== 'statement' || card.statementBalance == null || card.balance <= 0) return null;
    return card.dueDay != null && card.dueDay >= new Date().getDate() ? Math.max(0, card.statementBalance) : 0;
  };

  const totalMinDue = revolvingCards.reduce((s, c) => {
    const ms = manualStmtDueNow(c);
    if (ms !== null) return s + Math.min(c.minPayment, ms);
    if (c.m0MinSettled) return s; // Q11: this cycle's min already paid — next one is due next month
    return s + c.minPayment;
  }, 0);

  const userCashFloor = cashFloor;
  const ppBills = prePaycheckBillsTotal ?? 0;
  const recommendedSafeMinimum = Math.max(userCashFloor, ppBills);

  const effectiveFundingBalance = fundingBalance ?? liquidCash;

  const effectivePrimaryDueDay = primaryDueDay ?? (() => {
    const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
    if (revolving.length === 0) return 31;
    const dueDays = revolving.map(c => c.dueDay || 31);
    return Math.min(...dueDays);
  })();

  // Declared without a seed on purpose: every branch of the if/else-if/else below assigns both,
  // so TS's definite-assignment check will flag any future branch that forgets to.
  let remainingTransactionIncome: number;
  let remainingTransactionExpenses: number;
  // Whether we fell back to the monthlyExpenses scalar (which already has plan cash outflow folded
  // in by the caller). In that degenerate no-transactions/no-rules case, don't subtract
  // month0PlanOutflow again below — it would double-count.
  let usedScalarExpenses = false;

  if (transactions && transactions.length > 0) {
    const fundingSources = fundingAccountId
      ? new Set([fundingAccountId, `account:${fundingAccountId}`])
      : new Set<string>();
    remainingTransactionIncome = getRemainingTransactionIncomeByDay(transactions, 31, syncCutoffDate);
    remainingTransactionExpenses = getRemainingTransactionExpensesByDay(
      transactions, 31, true, fundingSources, CC_DEFAULT_CATEGORIES, syncCutoffDate, confirmedOccurrences,
    );
  } else if (payConfig && rules) {
    remainingTransactionIncome = getRemainingIncomeByDay(payConfig, 31)
      + getRemainingNonPaycheckIncomeByDay(rules, 31, fundingAccountId || null);
    remainingTransactionExpenses = getRemainingExpensesByDay(rules, 31, fundingAccountId || null);
  } else {
    remainingTransactionIncome = monthlyTakeHome;
    remainingTransactionExpenses = monthlyExpenses;
    usedScalarExpenses = true;
  }

  const remainingPaycheckIncome = remainingTransactionIncome;
  const remainingNonPaycheckIncome = 0;
  const remainingOneTimeIncome = 0;
  const remainingExpenses = remainingTransactionExpenses;
  const remainingOneTimeExpenses = 0;

  const totalRemainingIncome = remainingTransactionIncome;
  const totalRemainingOutflows = remainingTransactionExpenses;

  // Preference cards (statement/full) are allocated first, capped by cash above floor.
  // Subtract outflows (bank bills through due date) so upcoming expenses aren't ignored.
  // Payment-plan cash outflows (checking-sourced) don't appear in the transaction stream, so
  // subtract them here too — otherwise they never reduce the cash available to deploy toward debt.
  const planOutflow = usedScalarExpenses ? 0 : month0PlanOutflow;
  const availableAboveFloor = Math.max(0,
    effectiveFundingBalance + totalRemainingIncome - totalRemainingOutflows - recommendedSafeMinimum - planOutflow
  );
  let preferencePool = availableAboveFloor;
  let autopayTotal = 0;
  const preferenceRecs: PayoffRecommendation[] = [];

  for (const card of preferenceCards) {
    const desired = card.paymentPreference === 'full'
      ? Math.max(0, card.balance) + card.monthlyNewPurchases
      : card.monthlyNewPurchases;
    const actual = Math.round(Math.min(desired, preferencePool) * 100) / 100;
    preferencePool -= actual;
    autopayTotal += actual;
    preferenceRecs.push({
      cardId: card.id, cardName: card.name, color: card.color,
      payment: actual,
      isMinimumOnly: actual < desired,
      reason: card.paymentPreference === 'full' ? 'Pay Full Balance'
        : card.paymentPreference === 'statement' ? 'Pay Statement Balance'
        : 'Pay Monthly Charges',
      dueDay: card.dueDay,
    });
  }

  const safeToPayTotal = preferencePool; // remaining for revolving cards

  const cashWarning = Math.ceil(safeToPayTotal - totalMinDue) < 0;

  const cardEstimatedCash = new Map<string, number>();
  for (const card of revolvingCards) {
    const dueDay = card.dueDay || 31;
    if (transactions && transactions.length > 0) {
      const incByDue = getRemainingTransactionIncomeByDay(transactions, dueDay, syncCutoffDate);
      cardEstimatedCash.set(card.id, effectiveFundingBalance + incByDue);
    } else {
      cardEstimatedCash.set(card.id, effectiveFundingBalance + totalRemainingIncome);
    }
  }

  const strategyLabels: Record<string, string> = {
    avalanche: 'Highest APR First',
    snowball: 'Smallest Balance First',
  };

  let remaining = safeToPayTotal;
  const recs: PayoffRecommendation[] = [...preferenceRecs];

  // Pure strategy sort — no preference-card priority. Full/statement positive-balance
  // cards compete under normal avalanche/snowball until their balance reaches zero.
  // Avalanche ranks on the marginal rate for the same reason the simulation does (see its Step 5b):
  // the next dollar paid to a multi-rate card lands on its highest-APR bucket. Equals card.apr for
  // every card without tranches.
  const recAsOf = isoDay(new Date());
  const recApr = (c: CardData): number =>
    marginalApr(c, (c.tranches ?? []).map(t => t.balance), Math.max(0, c.balance), recAsOf);
  const sorted = [...revolvingCards].sort((a, b) =>
    strategy === 'avalanche' ? recApr(b) - recApr(a) : a.balance - b.balance
  );

  for (const card of sorted) {
    const ms = manualStmtDueNow(card);
    // Q11: settled (non-ISB) card has no forced minimum this month — base is $0; the extra
    // allocation loop below can still direct optional paydown at it.
    const settled = ms === null && !!card.m0MinSettled;
    const basePayment = ms !== null
      ? Math.max(0, Math.min(ms, remaining))
      : settled ? 0
      : Math.max(0, Math.min(card.minPayment, remaining, card.balance));
    recs.push({
      cardId: card.id, cardName: card.name, color: card.color, payment: basePayment,
      isMinimumOnly: ms === null && !settled,
      reason: settled ? 'Paid this cycle — minimum due next month'
        : ms === null ? 'Minimum due'
        : ms === 0 ? 'Statement paid this cycle'
        : 'Pay interest-saving balance',
      estimatedLiquidCash: cardEstimatedCash.get(card.id),
      dueDay: card.dueDay,
    });
    remaining -= basePayment;
  }

  if (remaining > 0) {
    for (let i = 0; i < sorted.length && remaining > 0; i++) {
      const card = sorted[i];
      const rec = recs.find(r => r.cardId === card.id)!;
      // statement preference: cap extra at current balance (don't pre-pay new purchases)
      // full or null: pay balance + anticipated new purchases (clear the card fully)
      // manual interest-saving balance: this month's obligation is fixed — never add extra
      // (the unbilled remainder isn't due yet, and a paid statement needs nothing more).
      const maxExtra = manualStmtDueNow(card) !== null ? 0
        : card.paymentPreference === 'statement'
        ? Math.max(0, card.balance - rec.payment)
        : Math.max(0, card.balance + card.monthlyNewPurchases - rec.payment);
      const extra = Math.min(remaining, maxExtra);
      if (extra > 0) {
        rec.payment += extra;
        rec.isMinimumOnly = false;
        // Show the preference label only when the payment actually clears the desired amount.
        // While the card still carries revolving debt the strategy label is more accurate.
        const payingFull = card.paymentPreference === 'full'
          && rec.payment >= card.balance + card.monthlyNewPurchases - 0.01;
        const payingStatement = card.paymentPreference === 'statement'
          && rec.payment >= card.balance - 0.01;
        rec.reason = payingFull ? 'Pay Full Balance'
          : payingStatement ? 'Pay Statement Balance'
          : strategy === 'avalanche'
          ? `Highest APR (${card.apr}%)`
          : `Smallest balance (${formatCurrency(card.balance, false)})`;
        remaining -= extra;
      }
    }
  }

  const interestMinOnly = revolvingCards.reduce((s, c) => s + (c.balance * (c.apr / 100 / 12)), 0);
  const interestWithRecs = revolvingCards.reduce((s, c) => {
    const rec = recs.find(r => r.cardId === c.id);
    const afterPayment = Math.max(0, c.balance - (rec?.payment || 0) + c.monthlyNewPurchases);
    return s + afterPayment * (c.apr / 100 / 12);
  }, 0);

  const { projectedPayoffMonths } = simulateVariablePayoff(
    cards, liquidCash, cashFloor, strategy, monthlyTakeHome, monthlyExpenses, 120,
  );

  // A card with a future card_start_date is not open yet, so its limit is not
  // available credit. simulateVariablePayoff already holds such cards out until
  // their start month (cardStartMonths); the milestones must use the same rule or
  // they measure against credit the user does not have.
  const milestoneNow = new Date();
  const milestoneCards = cards.map(c => ({
    creditLimit: c.creditLimit,
    startMonth: cardStartMonthOffset(c.startDate, milestoneNow),
  }));
  const thresholds = [30, 10];
  const milestones = thresholds.map(t => {
    let simB = cards.map(c => c.autopayFullBalance ? 0 : c.balance);
    for (let m = 0; m < 120; m++) {
      const totalBal = simB.reduce((s, b) => s + Math.max(0, b), 0);
      const totalLimit = openCreditLimitAtMonth(milestoneCards, m);
      const util = totalLimit > 0 ? (totalBal / totalLimit) * 100 : 0;
      if (util <= t) return { threshold: t, month: m };
      simB = simB.map((bal, i) => {
        if (bal <= 0 || cards[i].autopayFullBalance) return 0;
        const card = cards[i];
        const effectiveBal = bal < 1 ? 0 : bal;
        if (effectiveBal === 0) return Math.max(0, card.monthlyNewPurchases);
        const rec = recs.find(r => r.cardId === card.id);
        return Math.max(0, effectiveBal + card.monthlyNewPurchases
          + effectiveBal * (card.apr / 100 / 12) - (rec?.payment || card.minPayment));
      });
    }
    return { threshold: t, month: null };
  });

  const filteredRecs = recs.filter(r => r.payment > 0);
  const totalRecommendedPayment = filteredRecs.reduce((s, r) => s + r.payment, 0);

  return {
    totalAvailableCash: totalRecommendedPayment,
    totalMinimumsdue: totalMinDue,
    extraCashAvailable: Math.max(0, safeToPayTotal - totalMinDue),
    recommendations: filteredRecs,
    interestAvoided: Math.round((interestMinOnly - interestWithRecs) * 100) / 100,
    projectedPayoffMonths,
    utilizationMilestones: milestones,
    cashWarning,
    strategyLabel: strategyLabels[strategy] || strategy,
    recommendedSafeMinimum,
    userCashFloor,
    prePaycheckBills: ppBills,
    breakdown: {
      fundingBalance: effectiveFundingBalance,
      remainingPaycheckIncome,
      remainingNonPaycheckIncome,
      remainingOneTimeIncome,
      remainingExpenses,
      remainingOneTimeExpenses,
      safeMinimum: recommendedSafeMinimum,
      autopayTotal,
    },
  };
}

/**
 * Shared helper: compute current-month debt payment recommendations.
 * Used by Dashboard, Budget Control, Savings Goals, and Forecast to get
 * the same debt payment values that Debt Payoff displays.
 */
export type MonthlyDebtBreakdown = {
  recommendations: { cardId: string; cardName: string; color: string; payment: number; dueDay: number | null; reason: string; isMinimumOnly: boolean }[];
  totalMinimumsDue: number;
  totalRecommended: number;
  totalAvailableCash: number;
  autopayTotal: number;
  strategyLabel: string;
  cashWarning: boolean;
  interestAvoided: number;
};

function buildCurrentMonthRecommendationSummary(
  accounts: AccountRow[],
  transactions: EnrichedTransaction[],
  rules: RuleRow[],
  debts: DebtRow[],
  profile: Partial<Tables<'profiles'>> | null | undefined,
  monthlySavingsAndCar?: number,
  safeMinimumOverride?: number,
  syncCutoffDate?: string,
  extraMonthlyExpenses = 0,
  confirmedOccurrences?: ConfirmedOccurrences,
): RecommendationSummary | null {
  if (!accounts || !transactions || !rules || !debts) return null;
  const cards = buildCardData(accounts, transactions, rules, debts);
  if (cards.length === 0) return null;

  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidAccounts = accounts.filter(a => a.active && liquidTypes.includes(a.account_type));
  const liquidCash = liquidAccounts.reduce((s, a) => s + Number(a.balance), 0);
  const cashFloor = profile?.cash_floor != null ? Number(profile.cash_floor) : 1000;
  const pc = buildPayConfig(profile);
  const monthlyTakeHome = getMonthNetIncome(pc, new Date().getFullYear(), new Date().getMonth());
  const now0 = new Date();
  // Same 4b goal auto-stop gap as `calcCashOnlyMonthlyExpenses` (see the long note there): a
  // transfer/investment rule funding a completed goal keeps counting as an outflow, because
  // `goals` are not in scope here either. Far less exposed than the 60-month loop, though — this
  // is a CURRENT-MONTH sum, so it can only be wrong once a goal is ALREADY complete today, and
  // `end_date` (which 97.3's auto-end writes) is honoured below. Verified $0 live 2026-08-08.
  const monthlyExpenses = rules.filter(r => {
    if (!r.active) return false;
    if (r.rule_type === 'transfer' || r.rule_type === 'investment') {
      if (r.start_date && new Date(r.start_date + 'T00:00:00') > now0) return false;
      if (r.end_date && new Date(r.end_date + 'T00:00:00') < now0) return false;
      return true;
    }
    if (r.rule_type !== 'expense') return false;
    return true;
  }).reduce((s, r) => {
    const amt = Number(r.amount);
    return s + amt * countRuleOccurrencesInMonth(r, now0.getFullYear(), now0.getMonth(), now0);
  }, 0);

  const defaultId = profile?.default_deposit_account || null;
  let fundingAccountId: string | null = null;
  if (defaultId) {
    const acct = liquidAccounts.find(a => a.id === defaultId);
    if (acct) fundingAccountId = acct.id;
  }
  if (!fundingAccountId) {
    const checking = liquidAccounts.find(a => a.account_type === 'checking');
    fundingAccountId = checking?.id || liquidAccounts[0]?.id || null;
  }

  const fundAcct = liquidAccounts.find(a => a.id === fundingAccountId);
  const fundBal = fundAcct ? Number(fundAcct.balance) : liquidCash;
  const { total: ppBills } = getPrePaycheckNextMonthBills(rules, pc, fundingAccountId);

  const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
  const primaryDueDay = revolving.length > 0
    ? Math.min(...revolving.map(c => c.dueDay || 31))
    : 31;

  return generateRecommendations(
    cards, liquidCash, cashFloor, 'avalanche', monthlyTakeHome, monthlyExpenses + extraMonthlyExpenses,
    'variable', pc, rules, fundingAccountId, safeMinimumOverride ?? ppBills, fundBal,
    undefined, undefined, transactions, primaryDueDay, monthlySavingsAndCar,
    syncCutoffDate, extraMonthlyExpenses, confirmedOccurrences,
  );
}

export function getMonthlyDebtBreakdown(
  accounts: AccountRow[],
  transactions: EnrichedTransaction[],
  rules: RuleRow[],
  debts: DebtRow[],
  profile: Partial<Tables<'profiles'>> | null | undefined,
  monthlySavingsAndCar?: number,
  safeMinimumOverride?: number,
  syncCutoffDate?: string,
  extraMonthlyExpenses = 0,
  confirmedOccurrences?: ConfirmedOccurrences,
): MonthlyDebtBreakdown {
  const summary = buildCurrentMonthRecommendationSummary(accounts, transactions, rules, debts, profile, monthlySavingsAndCar, safeMinimumOverride, syncCutoffDate, extraMonthlyExpenses, confirmedOccurrences);
  if (!summary) return { recommendations: [], totalMinimumsDue: 0, totalRecommended: 0, totalAvailableCash: 0, autopayTotal: 0, strategyLabel: 'Avalanche', cashWarning: false, interestAvoided: 0 };
  return {
    recommendations: summary.recommendations.map(r => ({
      cardId: r.cardId,
      cardName: r.cardName,
      color: r.color,
      payment: r.payment,
      dueDay: r.dueDay || null,
      reason: r.reason,
      isMinimumOnly: r.isMinimumOnly,
    })),
    totalMinimumsDue: summary.totalMinimumsdue,
    totalRecommended: summary.recommendations.reduce((s, r) => s + r.payment, 0),
    totalAvailableCash: summary.totalAvailableCash,
    autopayTotal: summary.breakdown.autopayTotal,
    strategyLabel: summary.strategyLabel,
    cashWarning: summary.cashWarning,
    interestAvoided: summary.interestAvoided,
  };
}

/**
 * @deprecated No callers remain. Dashboard, Budget Control and Savings Goals moved to
 * `useMonth0DebtBreakdown` (lib/month0-debt-breakdown.ts), which derives the same shape from the
 * converged `cardProjection.month0` that Debt Payoff and Forecast read. This one-shot pass used a
 * different cash floor, save-up reserve and income window, so it reported different payments than
 * /debt for the same card. Do not add new callers.
 */
export function getCurrentMonthDebtRecommendations(
  accounts: AccountRow[],
  transactions: EnrichedTransaction[],
  rules: RuleRow[],
  debts: DebtRow[],
  profile: Partial<Tables<'profiles'>> | null | undefined,
  monthlySavingsAndCar?: number,
  extraMonthlyExpenses = 0,
): { cardId: string; cardName: string; payment: number; dueDay: number | null; reason: string }[] {
  const summary = buildCurrentMonthRecommendationSummary(accounts, transactions, rules, debts, profile, monthlySavingsAndCar, undefined, undefined, extraMonthlyExpenses);
  if (!summary) return [];
  return summary.recommendations.map(r => ({
    cardId: r.cardId,
    cardName: r.cardName,
    payment: r.payment,
    dueDay: r.dueDay || null,
    reason: r.reason,
  }));
}
