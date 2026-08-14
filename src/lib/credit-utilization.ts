import { cardStartMonthOffset } from './card-start-date';

/**
 * Card shape this module needs. A subset of CardData (credit-card-engine.ts) — kept
 * narrow so this file has no dependency on the engine and can be unit tested in
 * isolation, the same convention card-start-date.ts uses.
 */
export interface UtilizationCard {
  id: string;
  name: string;
  balance: number;
  creditLimit: number;
  /** Remaining 0%-interest installment/upfront-plan balance (plan_type='upfront').
   * Utilization-only: it counts toward the card's balance and utilization ratio but
   * accrues no interest. See payment-plan-generator.ts:deriveUpfrontPlanFields. */
  installmentBalance?: number;
  startDate?: string;
}

export interface CardUtilizationBreakdown {
  id: string;
  name: string;
  isOpen: boolean;
  /** 0 if already open. Same month-granularity rule as cardStartMonthOffset. */
  opensInMonths: number;
  creditLimit: number;
  balance: number;
  interestBearingBalance: number;
  utilizationOnlyBalance: number;
  /** null when the card isn't open yet or has no limit — there is no meaningful ratio. */
  utilizationPct: number | null;
}

export function breakdownCardUtilization(card: UtilizationCard, now: Date): CardUtilizationBreakdown {
  const opensInMonths = cardStartMonthOffset(card.startDate, now);
  const isOpen = opensInMonths === 0;
  const utilizationOnlyBalance = Math.min(card.balance, Math.max(0, card.installmentBalance ?? 0));
  const interestBearingBalance = Math.max(0, card.balance - utilizationOnlyBalance);
  const utilizationPct = isOpen && card.creditLimit > 0 ? (card.balance / card.creditLimit) * 100 : null;
  return {
    id: card.id, name: card.name, isOpen, opensInMonths,
    creditLimit: card.creditLimit, balance: card.balance,
    interestBearingBalance, utilizationOnlyBalance, utilizationPct,
  };
}

export interface OverallUtilization {
  totalBalance: number;
  totalLimit: number;
  utilizationPct: number | null;
  interestBearingBalance: number;
  utilizationOnlyBalance: number;
  /** Cards excluded from the totals above because card_start_date hasn't arrived yet —
   * their limit isn't credit the user can draw on, so including it would understate
   * utilization (same rule openCreditLimitAtMonth applies to the projection). */
  futureCards: { id: string; name: string; creditLimit: number; opensInMonths: number }[];
}

export function summarizeUtilization(cards: UtilizationCard[], now: Date): OverallUtilization {
  const breakdowns = cards.map(c => breakdownCardUtilization(c, now));
  const open = breakdowns.filter(b => b.isOpen);
  const totalBalance = open.reduce((s, b) => s + b.balance, 0);
  const totalLimit = open.reduce((s, b) => s + b.creditLimit, 0);
  const interestBearingBalance = open.reduce((s, b) => s + b.interestBearingBalance, 0);
  const utilizationOnlyBalance = open.reduce((s, b) => s + b.utilizationOnlyBalance, 0);
  const futureCards = breakdowns
    .filter(b => !b.isOpen)
    .map(b => ({ id: b.id, name: b.name, creditLimit: b.creditLimit, opensInMonths: b.opensInMonths }));
  return {
    totalBalance, totalLimit,
    utilizationPct: totalLimit > 0 ? (totalBalance / totalLimit) * 100 : null,
    interestBearingBalance, utilizationOnlyBalance, futureCards,
  };
}

/**
 * Percentage points a card's OWN utilization ratio moves per dollar paid toward it,
 * scaled to a $100 increment for display. Depends only on the card's limit, not its
 * balance or APR — $100 off a $1,100-limit card moves that card's ratio ~10x further
 * than the same $100 off an $11,000-limit card.
 *
 * This is the "lowest utilization per dollar" metric the ticket asked for: a DISPLAY-ONLY
 * alternative ranking to the avalanche order (which sorts by APR, for interest cost).
 * It must never feed generateRecommendations' payment allocator — avalanche stays the
 * one strategy that decides real dollars; this is a second lens on the same cards, not
 * a second allocator.
 */
export function utilizationPointsPerHundredDollars(creditLimit: number): number {
  return creditLimit > 0 ? 10000 / creditLimit : 0;
}

export interface UtilizationRankRow {
  id: string;
  name: string;
  creditLimit: number;
  balance: number;
  utilizationPct: number | null;
  pointsPerHundredDollars: number;
}

/**
 * Open cards that still carry a balance, ranked by fastest-moving own-utilization per
 * dollar (smallest limit first). A future card or a $0 balance has no utilization to
 * move, so both are excluded rather than sorted in at an arbitrary position.
 */
export function rankByUtilizationImpact(cards: UtilizationCard[], now: Date): UtilizationRankRow[] {
  return cards
    .map(c => breakdownCardUtilization(c, now))
    .filter(b => b.isOpen && b.balance > 0 && b.creditLimit > 0)
    .map(b => ({
      id: b.id, name: b.name, creditLimit: b.creditLimit, balance: b.balance,
      utilizationPct: b.utilizationPct,
      pointsPerHundredDollars: utilizationPointsPerHundredDollars(b.creditLimit),
    }))
    .sort((a, b) => b.pointsPerHundredDollars - a.pointsPerHundredDollars);
}

export interface PaymentImpactPreview {
  beforePct: number | null;
  afterPct: number | null;
  /** Positive = utilization improved (went down). */
  deltaPoints: number | null;
}

/**
 * What a candidate payment would do to a single card's own utilization, holding its
 * limit fixed. Payment is capped at the card's balance — you cannot pay a card below $0,
 * and paying past $0 has no further utilization effect.
 */
export function previewCardPaymentImpact(
  card: UtilizationCard, paymentAmount: number, now: Date,
): PaymentImpactPreview {
  const before = breakdownCardUtilization(card, now);
  if (!before.isOpen || before.creditLimit <= 0) {
    return { beforePct: null, afterPct: null, deltaPoints: null };
  }
  const applied = Math.max(0, Math.min(paymentAmount, before.balance));
  const afterBalance = before.balance - applied;
  const afterPct = (afterBalance / before.creditLimit) * 100;
  return {
    beforePct: before.utilizationPct,
    afterPct,
    deltaPoints: (before.utilizationPct ?? 0) - afterPct,
  };
}
