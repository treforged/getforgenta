import {
  projectCardVariable, simulateVariablePayoff, CardData, PROJECTION_MONTHS,
} from '@/lib/credit-card-engine';
import type { SimResult } from '@/lib/credit-card-engine';
import type { ProjectionDataRow, CardProjectionResult } from './useCardProjection';

/**
 * Phase 2 Option C convergence, step 3 — pure rebuild of a CardProjectionResult's sim-derived
 * fields from a re-targeted simulation (simulateVariablePayoff run with the forecast engine's
 * authoritative per-month revolving debt cash as debtCashTargetByMonth, param #20).
 *
 * At the fixed point the sim actually PAYS the engine's cash, so there is deliberately NO
 * pass-3 replica, NO scaling, and NO extra-distribution here: the sim's payments ARE the plan.
 * Per-card surpluses are all zero, which makes the engine's step3-display adjustments no-ops
 * and lets the popup and accordion reconcile natively.
 *
 * Extracted from useCardProjection's useMemo so it can be unit-tested without rendering the
 * hook; the hook's closure supplies the pipeline locals via ResimContext.
 */

export interface ResimContext {
  cards: CardData[];
  /** Per-month per-card real purchases (index = month), same array the base pipeline built. */
  cardPurchasesPerMonth: { [cardId: string]: number }[];
  now: Date;
  saveUpMonths: Set<number>;
  maxDebtPaymentByMonth: number[];
}

/** Sim-derived fields of CardProjectionResult that a re-targeted sim replaces. Everything not
 * listed here (month0, save-up sets, m0 figures, cards/simCards…) is KEPT from the base result. */
export type ResimOverrides = Pick<CardProjectionResult,
  | 'data' | 'debtPaymentTotals' | 'allPaymentTotals' | 'perCardPayments'
  | 'perCardPaymentsScaled' | 'monthlyRevolvingBalances' | 'monthlyBalances'
  | 'perCardMinPayments' | 'monthlyCyclingOwed' | 'monthlyCyclingInterest' | 'monthlyInterest'
  | 'monthlyCyclingBacklog' | 'monthlyMandatoryCyclingPayment'
  | 'forecastAdjustedRevolvingBalances' | 'simRevolvingPayoffMonth' | 'forecastRevolvingPayoffMonth'
>;

/** Mirrors the base pipeline's computeCyclingPaymentByMonth (see useCardProjection.ts): the
 * non-reducible cycling outflow per month — mandatory statements only, never discretionary
 * backlog paydown — with the same max(actual, intended) deadlock-breaker. */
function computeCyclingPaymentByMonth(
  sim: SimResult,
  cards: CardData[],
  cardPurchasesPerMonth: { [cardId: string]: number }[],
): number[] {
  return Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
    cards.reduce((s, c) => {
      const revBal = sim.monthlyRevolvingBalances.get(c.id)?.[m] ?? c.balance;
      if (revBal > 0) return s;
      const actual = sim.monthlyMandatoryCyclingPayment.get(c.id)?.[m] ?? 0;
      const intended = m > 0 ? (cardPurchasesPerMonth[m - 1]?.[c.id] ?? 0) : 0;
      return s + Math.max(actual, intended);
    }, 0),
  );
}

export function buildResimOverrides(simT: SimResult, ctx: ResimContext): ResimOverrides {
  const { cards, cardPurchasesPerMonth, now, saveUpMonths, maxDebtPaymentByMonth } = ctx;

  const projs = cards.map(c => {
    const pays = simT.monthlyPayments.get(c.id) || [];
    const revBals = simT.monthlyRevolvingBalances.get(c.id) || [];
    const purchases = cardPurchasesPerMonth.map(monthMap => monthMap[c.id] ?? 0);
    const cyclingOwed = simT.monthlyCyclingOwed.get(c.id) || [];
    const cyclingInterest = simT.monthlyCyclingInterest.get(c.id) || [];
    const trueBalances = simT.monthlyBalances.get(c.id) || [];
    const trueInterest = simT.monthlyInterest.get(c.id) || [];
    return projectCardVariable(c, pays, PROJECTION_MONTHS, true, purchases, revBals, cyclingOwed, cyclingInterest, trueBalances, trueInterest);
  });

  // ── data rows (same derivation as the base pipeline, sourced from simT) ────
  const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
  const data = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const row: ProjectionDataRow = { month: d.toLocaleString('en', { month: 'short', year: 'numeric' }), totalCCBalance: 0, displayCCBalance: 0, totalInterest: 0, utilization: 0 };
    for (const p of projs) {
      const m = p.months[i];
      if (m) {
        row[p.card.name] = Math.round(m.endBalance);
        row.totalInterest += m.interest;
      } else if (p.payoffMonth !== null && i >= p.payoffMonth) {
        if (p.card.paymentPreference === 'full' || p.card.paymentPreference === 'statement') {
          row[p.card.name] = Math.round(cardPurchasesPerMonth[i]?.[p.card.id] ?? p.card.monthlyNewPurchases);
        } else {
          row[p.card.name] = 0;
        }
      }
    }
    row.totalCCBalance = Math.round(Math.max(0,
      cards.reduce((s, c) => s + (simT.monthlyRevolvingBalances.get(c.id)?.[i] ?? 0), 0),
    ));
    let displayBal = 0;
    for (const card of cards) {
      const simBal = simT.monthlyBalances.get(card.id)?.[i] ?? 0;
      if (simBal > 0) displayBal += simBal;
      else if (card.paymentPreference === 'full' || card.paymentPreference === 'statement') displayBal += cardPurchasesPerMonth[i]?.[card.id] ?? card.monthlyNewPurchases;
    }
    row.displayCCBalance = Math.round(Math.max(0, displayBal));
    row.totalInterest = Math.round(row.totalInterest);
    row.utilization = totalLimit > 0 ? Math.round((row.totalCCBalance / totalLimit) * 100) : 0;
    return row;
  });

  // ── payment totals (same start-of-month revolving classification as the base) ─
  const debtPaymentTotals = Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
    projs.reduce((total, proj) => {
      const m = proj.months[i];
      if (!m || m.startBalance <= 0) return total;
      const startRevBal = i === 0
        ? (simT.monthlyRevolvingBalances.get(proj.card.id)?.[0] ?? 0)
        : (simT.monthlyRevolvingBalances.get(proj.card.id)?.[i - 1] ?? 0);
      if (startRevBal <= 0) return total;
      return total + m.payment;
    }, 0),
  );

  const allPaymentTotals = Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
    cards.reduce((total, card) => total + (simT.monthlyPayments.get(card.id)?.[i] ?? 0), 0),
  );

  // Save-up months with no revolving debt: cap only the DISCRETIONARY cycling portion
  // (backlog paydown), never the mandatory statements — same rule as the base pipeline.
  const mandatoryCyclingByMonth = computeCyclingPaymentByMonth(simT, cards, cardPurchasesPerMonth);
  for (const m of saveUpMonths) {
    const cap = maxDebtPaymentByMonth[m];
    if (!isFinite(cap) || debtPaymentTotals[m] > 0) continue;
    const mandatory = mandatoryCyclingByMonth[m] ?? 0;
    const discretionary = Math.max(0, allPaymentTotals[m] - mandatory);
    const discretionaryCap = Math.max(0, cap - mandatory);
    if (discretionary > discretionaryCap) {
      allPaymentTotals[m] = mandatory + discretionaryCap;
    }
  }

  const perCardPayments = cards.map(c => ({
    name: c.name, id: c.id,
    payments: Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
      Math.round(simT.monthlyPayments.get(c.id)?.[i] ?? 0)),
  }));

  // Revolving cards take the sim's payment DIRECTLY (no pass-3 scale, no extra); the cycling
  // save-up discretionary branch is kept verbatim from the base pipeline. Surpluses are zero.
  const perCardPaymentsScaled = cards.map(c => ({
    name: c.name, id: c.id,
    payments: Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
      const simAmt = Math.round(simT.monthlyPayments.get(c.id)?.[m] ?? 0);
      const revBal = simT.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0;
      if (revBal === 0 && saveUpMonths.has(m) && debtPaymentTotals[m] === 0) {
        if (c.paymentPreference === 'statement' || c.paymentPreference === 'full') return simAmt;
        const cardMandatory = simT.monthlyMandatoryCyclingPayment.get(c.id)?.[m] ?? 0;
        const cardDiscretionary = Math.max(0, simAmt - cardMandatory);
        const totalDiscretionaryCapped = Math.max(0, allPaymentTotals[m] - (mandatoryCyclingByMonth[m] ?? 0));
        const totalCardDiscretionary = cards.reduce((s, cc) => {
          if ((simT.monthlyRevolvingBalances.get(cc.id)?.[m] ?? 0) > 0) return s;
          const ccAmt = Math.round(simT.monthlyPayments.get(cc.id)?.[m] ?? 0);
          const ccMandatory = simT.monthlyMandatoryCyclingPayment.get(cc.id)?.[m] ?? 0;
          return s + Math.max(0, ccAmt - ccMandatory);
        }, 0);
        const discretionaryShare = totalCardDiscretionary > 0
          ? Math.round(cardDiscretionary * (totalDiscretionaryCapped / totalCardDiscretionary))
          : 0;
        return Math.min(simAmt, cardMandatory + discretionaryShare);
      }
      return simAmt;
    }),
    surpluses: Array<number>(PROJECTION_MONTHS).fill(0),
  }));

  // First month simT's total revolving balance (across cards that start revolving) hits $0.
  // With zero surpluses the forecast-adjusted trajectory IS the sim trajectory, so both payoff
  // fields collapse to the same value.
  let payoffMonth: number | null = null;
  const revolvingCardIds = cards
    .filter(c => (simT.monthlyRevolvingBalances.get(c.id)?.[0] ?? 0) > 0)
    .map(c => c.id);
  if (revolvingCardIds.length > 0) {
    for (let m = 0; m < PROJECTION_MONTHS; m++) {
      const totalRevBal = revolvingCardIds.reduce(
        (s, id) => s + Math.max(0, simT.monthlyRevolvingBalances.get(id)?.[m] ?? 0), 0,
      );
      if (totalRevBal <= 0) {
        payoffMonth = m + 1;
        break;
      }
    }
  }

  return {
    data,
    debtPaymentTotals,
    allPaymentTotals,
    perCardPayments,
    perCardPaymentsScaled,
    monthlyRevolvingBalances: simT.monthlyRevolvingBalances,
    monthlyBalances: simT.monthlyBalances,
    perCardMinPayments: simT.perCardMinPayments,
    monthlyCyclingOwed: simT.monthlyCyclingOwed,
    monthlyCyclingInterest: simT.monthlyCyclingInterest,
    monthlyInterest: simT.monthlyInterest,
    monthlyCyclingBacklog: simT.monthlyCyclingBacklog,
    monthlyMandatoryCyclingPayment: simT.monthlyMandatoryCyclingPayment,
    forecastAdjustedRevolvingBalances: simT.monthlyRevolvingBalances,
    simRevolvingPayoffMonth: payoffMonth,
    forecastRevolvingPayoffMonth: payoffMonth,
  };
}
