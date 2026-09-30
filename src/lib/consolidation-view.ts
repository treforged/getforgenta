// The numbers the Debt Payoff "Would a consolidation loan help?" panel shows (ask fee53760).
//
// The interest delta and the utilization delta are reported SEPARATELY, because consolidation.ts
// forbids blending them: at a loan rate near the cards' rate the move is interest-neutral and all
// of its return is utilization, and a single score would hide which one the user is buying.
// "After" utilization is the WORST point once committed payment plans land, not funding day.

import {
  consolidationCards,
  scheduledCardCharges,
  totalScheduledCharges,
  type ConsolidationAccountRow,
  type ConsolidationPlanRow,
} from './consolidation-adapter';
import {
  solveMinimumPrincipal,
  evaluateConsolidation,
  type ConsolidationResult,
} from './consolidation';

export const UTILIZATION_TARGET_PCT = 30;

export interface ConsolidationOffer {
  aprPct: number;
  termMonths: number;
  originationFeePct: number;
  principal: number | null;
}

export interface ConsolidationView {
  hasCardDebt: boolean;
  totalCardDebt: number;
  blendedCardApr: number;
  suggestedPrincipal: number;
  principalUsed: number;
  committedPlanCharges: number;
  monthlyPayment: number;
  interest: {
    loanTotal: number;
    cardsTotal: number | null;
    delta: number | null;
    cardsMonths: number | null;
  };
  utilization: {
    beforeWorstPct: number | null;
    afterWorstPct: number | null;
    beforeOverallPct: number | null;
    afterOverallPct: number | null;
  };
  shortfall: number;
  notes: string[];
}

/**
 * Builds a ConsolidationView from account rows, plan rows, an offer, and a date.
 */
export function buildConsolidationView(
  accounts: readonly ConsolidationAccountRow[],
  plans: readonly ConsolidationPlanRow[],
  offer: ConsolidationOffer,
  asOf: string, // YYYY-MM-DD
): ConsolidationView {
  const cards = consolidationCards(accounts);
  const charges = scheduledCardCharges(plans, cards, { asOf });

  const totalCardDebt = cards.reduce((sum, c) => sum + Math.max(0, c.balance), 0);
  const hasCardDebt = totalCardDebt > 0;

  if (!hasCardDebt) {
    return {
      hasCardDebt: false,
      totalCardDebt: 0,
      blendedCardApr: 0,
      suggestedPrincipal: 0,
      principalUsed: 0,
      committedPlanCharges: 0,
      monthlyPayment: 0,
      interest: { loanTotal: 0, cardsTotal: null, delta: null, cardsMonths: null },
      utilization: {
        beforeWorstPct: null,
        afterWorstPct: null,
        beforeOverallPct: null,
        afterOverallPct: null,
      },
      shortfall: 0,
      notes: [],
    };
  }

  const constraints = {
    maxCardUtilizationPct: UTILIZATION_TARGET_PCT,
    holdThroughScheduledCharges: true,
  } as const;

  const solverResult = solveMinimumPrincipal({
    cards,
    charges,
    constraints,
    asOf,
    originationFeePct: offer.originationFeePct,
  });

  const rawSuggested = solverResult.principalRequired ?? 0;
  const suggestedPrincipal =
    rawSuggested <= 0 ? 0 : Math.ceil(rawSuggested / 100) * 100;

  const principalUsed =
    offer.principal != null && Number.isFinite(offer.principal) && offer.principal > 0
      ? offer.principal
      : suggestedPrincipal > 0
      ? suggestedPrincipal
      : totalCardDebt;

  const evaluation: ConsolidationResult = evaluateConsolidation({
    cards,
    terms: {
      principal: principalUsed,
      aprPct: offer.aprPct,
      termMonths: offer.termMonths,
      originationFeePct: offer.originationFeePct,
    },
    charges,
    constraints,
    asOf,
  });

  const committedPlanCharges = totalScheduledCharges(charges);

  return {
    hasCardDebt: true,
    totalCardDebt,
    blendedCardApr: evaluation.interest.blendedCardApr,
    suggestedPrincipal,
    principalUsed,
    committedPlanCharges,
    monthlyPayment: evaluation.monthlyPayment,
    interest: {
      loanTotal: evaluation.interest.loanTotal,
      cardsTotal: evaluation.interest.statusQuoTotal,
      delta: evaluation.interest.delta,
      cardsMonths: evaluation.interest.statusQuoMonths,
    },
    utilization: {
      beforeWorstPct: evaluation.before.worstCardPct,
      afterWorstPct: evaluation.afterScheduledCharges.worstCardPct,
      beforeOverallPct: evaluation.before.aggregatePct,
      afterOverallPct: evaluation.afterScheduledCharges.aggregatePct,
    },
    shortfall: evaluation.shortfall,
    notes: solverResult.notes,
  };
}
