// "What if I moved the cards onto one fixed-rate installment loan?" — priced, not guessed. Pure, no I/O.
//
// THE REAL CASE THIS EXISTS FOR (Tre, 2026-08-20): a preapproved Discover personal loan, $2,500 to
// $40,000, 36-84 months, $0 origination, no prepayment penalty. Two cards carrying $18,818.93 against
// $25,400 of OPEN limit — 74.1%, not the 41.5% a naive total suggests, because Venture X and Apple Card
// have `card_start_date` in the future and their $20,000 is not credit anyone can draw on yet. The
// stated goal was "all cards under 30% and interest free", which is a CONSTRAINT problem, not a
// preference: there is a smallest principal that satisfies it and every smaller one silently fails.
//
// THE TRAP THIS MODULE EXISTS TO CLOSE. A consolidation that zeroes every card on the day it funds is
// not the same as a consolidation that HOLDS. Tre has three PayPal Pay-in-4 plans whose funding source
// is the Discover card: $479.88/month still to land through November. Pay the card to $0 and, left
// alone, it is back to ~$1,440 (13.1%) by December — and if the loan had been sized to leave the card
// at 29%, it would be over 30% in a single month. So `ScheduledCardCharge` is a first-class input, the
// constraint is checked at its WORST future point rather than at funding, and `landsOnCard: false`
// models the free fix (repoint the plan's funding source at checking) instead of borrowing to cover it.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not decide. Consolidating $18.8k at 18% against a 19.16%
// blended card rate is nearly interest-neutral — the whole return is utilization and a fixed payment —
// while the same move at 12% is worth thousands. Those two answers point opposite ways, so
// `ConsolidationResult` reports the interest delta and the utilization delta SEPARATELY and never
// blends them into a single score. A UI that shows one and hides the other gives bad advice.
//
// Ordering is CARD Act §164 (highest APR first) applied ACROSS cards, not within one — a lump payoff
// is not a monthly payment and is not bound to a single issuer. Promo tranches are priced at their
// rate as of the month they are touched, via `trancheAprAsOf`, so a 7.99% balance that reprices to
// 16.6% in January 2028 is cheap money now and ordinary money later, and the ranking says so.

import { type BalanceTranche, trancheAprAsOf, monthsUntil } from './balance-tranches';
import { summarizeUtilization, type UtilizationCard } from './credit-utilization';
import { cardStartMonthOffset } from './card-start-date';

/** Local shim: this module speaks ISO strings, `cardStartMonthOffset` speaks Date. */
function cardOpenAsOf(startDate: string | null | undefined, asOf: string): boolean {
  return cardStartMonthOffset(startDate, new Date(`${asOf}T00:00:00`)) === 0;
}

/** A card as this module needs it. Narrow on purpose — no dependency on the engine. */
export interface ConsolidationCard {
  id: string;
  name: string;
  balance: number;
  creditLimit: number;
  /** The STANDARD rate: what an expired tranche reprices to, and what the untranched remainder pays. */
  apr: number;
  tranches?: readonly BalanceTranche[];
  /** `accounts.card_start_date`. A future date means the limit is not usable credit yet. */
  startDate?: string | null;
  minPayment?: number;
}

/**
 * A charge already committed to land on a card in a future month — a payment plan whose
 * `payment_source` is that card. These are the reason a clean payoff does not stay clean.
 */
export interface ScheduledCardCharge {
  label: string;
  cardId: string;
  amountPerMonth: number;
  monthsRemaining: number;
  /** Set false to model repointing the plan's funding source at cash. Defaults to true. */
  landsOnCard?: boolean;
}

export interface ConsolidationConstraints {
  /** Every OPEN card must sit at or under this, now and at its worst future point. */
  maxCardUtilizationPct?: number;
  /** No card may carry an interest-bearing balance. A 0% promo still counts as interest-bearing
   *  once its `promo_end_date` passes, so this is evaluated at `asOf`, not at face value. */
  requireInterestFree?: boolean;
  /** Check the constraint against scheduled charges too, not just the funding-day balance. */
  holdThroughScheduledCharges?: boolean;
}

export interface LoanTerms {
  principal: number;
  aprPct: number;
  termMonths: number;
  /** Deducted from proceeds at funding. Discover's preapproval is 0. */
  originationFeePct?: number;
}

/** One (card, tranche) pair at the rate it actually costs as of a date. */
export interface PayoffBucket {
  cardId: string;
  cardName: string;
  trancheId: string;
  label: string;
  balance: number;
  /** Rate as of `asOf` — a promo already past its end date competes at the standard rate. */
  effectiveApr: number;
  promoEndDate: string | null;
  /** The rate this becomes once the promo lapses, or null if it never does. */
  aprAfterPromo: number | null;
}

// ---------------------------------------------------------------------------
// Loan arithmetic
// ---------------------------------------------------------------------------

/** Standard amortized payment. A 0% loan is straight-line, not a divide-by-zero. */
export function amortizedPayment(principal: number, aprPct: number, termMonths: number): number {
  if (termMonths <= 0 || principal <= 0) return 0;
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

/** Total interest over the full term, assuming every payment is made on schedule and none early. */
export function loanTotalInterest(principal: number, aprPct: number, termMonths: number): number {
  return Math.max(0, amortizedPayment(principal, aprPct, termMonths) * termMonths - principal);
}

/**
 * Months to clear `principal` at `aprPct` while paying `monthlyPayment`. Returns null when the
 * payment does not cover the first month's interest — the balance grows and there is no payoff
 * date, which must be reported as "never", never as a large number.
 */
export function monthsToPayOff(principal: number, aprPct: number, monthlyPayment: number): number | null {
  if (principal <= 0) return 0;
  if (monthlyPayment <= 0) return null;
  const r = aprPct / 100 / 12;
  if (r === 0) return Math.ceil(principal / monthlyPayment);
  if (monthlyPayment <= principal * r) return null;
  return Math.ceil(-Math.log(1 - (principal * r) / monthlyPayment) / Math.log(1 + r));
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

function addMonthsISO(asOf: string, months: number): string {
  const [y, m, d] = asOf.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Every sub-balance across every card, priced as of `asOf` and ranked most expensive first.
 *
 * The remainder (balance minus all tranches) is emitted as its own bucket at the standard rate,
 * mirroring `trancheInterestBreakdown`. Tranches are clamped against the card's balance in listed
 * order for the same reason it does: inconsistent data means the later entries are stale.
 */
export function buildPayoffBuckets(cards: readonly ConsolidationCard[], asOf: string): PayoffBucket[] {
  const out: PayoffBucket[] = [];
  for (const card of cards) {
    let covered = 0;
    for (const t of card.tranches ?? []) {
      const usable = Math.max(0, Math.min(t.balance, card.balance - covered));
      if (usable <= 0) continue;
      covered += usable;
      const effectiveApr = trancheAprAsOf(t, card.apr, asOf);
      const stillPromo = effectiveApr === t.apr && t.promo_end_date !== null;
      out.push({
        cardId: card.id,
        cardName: card.name,
        trancheId: t.id || t.label,
        label: t.label,
        balance: usable,
        effectiveApr,
        promoEndDate: stillPromo ? t.promo_end_date : null,
        aprAfterPromo: stillPromo ? card.apr : null,
      });
    }
    const remainder = Math.max(0, card.balance - covered);
    if (remainder > 0) {
      out.push({
        cardId: card.id,
        cardName: card.name,
        trancheId: 'remainder',
        label: 'Standard balance',
        balance: remainder,
        effectiveApr: card.apr,
        promoEndDate: null,
        aprAfterPromo: null,
      });
    }
  }
  // CARD Act ordering, applied across cards: a lump payoff is not bound to one issuer.
  return out.sort((a, b) => b.effectiveApr - a.effectiveApr);
}

// ---------------------------------------------------------------------------
// Sizing: the smallest loan that satisfies the constraints
// ---------------------------------------------------------------------------

export interface SizingInput {
  cards: readonly ConsolidationCard[];
  charges?: readonly ScheduledCardCharge[];
  constraints: ConsolidationConstraints;
  asOf: string;
  originationFeePct?: number;
  /** Lender bounds, for reporting whether the answer is even offerable. */
  minPrincipal?: number;
  maxPrincipal?: number;
}

export interface CardSizingLine {
  cardId: string;
  cardName: string;
  balanceBefore: number;
  /** Balance the card must be left at for the constraints to hold. */
  targetBalance: number;
  paydownRequired: number;
  /** Committed future charges still landing on this card. */
  scheduledCharges: number;
  /** Which constraint set the target. */
  bindingConstraint: 'interest-free' | 'utilization' | 'none';
}

export interface SizingResult {
  /** What must reach the creditors. */
  netProceedsRequired: number;
  /** Cash the loan must also deliver so committed charges never touch a card again. */
  cashReserveRequired: number;
  /** Grossed up for origination. Equals net + reserve when the fee is 0. */
  principalRequired: number;
  perCard: CardSizingLine[];
  withinLenderRange: boolean;
  notes: string[];
}

/**
 * The headline question: how much do I actually need?
 *
 * Works backwards from the constraints rather than forwards from a round number. Each card gets a
 * target balance — $0 if interest-free is required, otherwise the utilization ceiling — and when
 * `holdThroughScheduledCharges` is set the ceiling is tightened by whatever is still committed to
 * land on that card, so the answer is the principal that keeps the promise for the whole run, not
 * just on funding day. Charges marked `landsOnCard: false` cost nothing here; that is the point of
 * modelling them, because repointing a Pay-in-4 at checking is free and borrowing to cover it is not.
 */
export function solveMinimumPrincipal(input: SizingInput): SizingResult {
  const { cards, charges = [], constraints, asOf } = input;
  const feePct = input.originationFeePct ?? 0;
  const maxPct = constraints.maxCardUtilizationPct;
  const notes: string[] = [];
  const perCard: CardSizingLine[] = [];

  let netProceeds = 0;
  let cashReserve = 0;

  for (const card of cards) {
    const open = cardOpenAsOf(card.startDate, asOf);
    const landing = charges
      .filter(c => c.cardId === card.id && (c.landsOnCard ?? true))
      .reduce((s, c) => s + c.amountPerMonth * c.monthsRemaining, 0);

    let target = Number.POSITIVE_INFINITY;
    let binding: CardSizingLine['bindingConstraint'] = 'none';

    if (open && maxPct !== undefined && card.creditLimit > 0) {
      const ceiling = (maxPct / 100) * card.creditLimit;
      // The ceiling has to absorb the charges still coming, or it is breached later.
      const headroomNeeded = constraints.holdThroughScheduledCharges ? landing : 0;
      target = Math.max(0, ceiling - headroomNeeded);
      binding = 'utilization';
    }

    if (constraints.requireInterestFree) {
      // Interest-bearing means "costs anything as of today". A live 0% promo does not.
      const interestBearing = buildPayoffBuckets([card], asOf)
        .filter(b => b.effectiveApr > 0)
        .reduce((s, b) => s + b.balance, 0);
      const freeBalance = Math.max(0, card.balance - interestBearing);
      if (freeBalance < target) {
        target = freeBalance;
        binding = 'interest-free';
      }
      // Charges landing on a card that must stay interest-free have to be met in cash.
      if (constraints.holdThroughScheduledCharges) cashReserve += landing;
    }

    const paydown = Math.max(0, card.balance - Math.min(target, card.balance));
    if (paydown > 0) netProceeds += paydown;

    perCard.push({
      cardId: card.id,
      cardName: card.name,
      balanceBefore: card.balance,
      targetBalance: Number.isFinite(target) ? Math.min(target, card.balance) : card.balance,
      paydownRequired: paydown,
      scheduledCharges: landing,
      bindingConstraint: paydown > 0 ? binding : 'none',
    });

    if (!open && card.balance > 0) {
      notes.push(`${card.name} is not open until ${card.startDate}; its limit is excluded from utilization.`);
    }
  }

  const beforeFee = netProceeds + cashReserve;
  const principal = feePct > 0 ? beforeFee / (1 - feePct / 100) : beforeFee;
  const min = input.minPrincipal ?? 0;
  const max = input.maxPrincipal ?? Number.POSITIVE_INFINITY;
  const withinRange = principal >= min && principal <= max;
  if (!withinRange && principal > max) {
    notes.push(`Requires $${principal.toFixed(2)}, above the $${max.toFixed(0)} lender maximum.`);
  }
  if (cashReserve > 0) {
    notes.push(
      `$${cashReserve.toFixed(2)} of the principal is a cash reserve for committed charges still landing on cards. ` +
      `Repointing those plans at checking removes it from the loan entirely.`,
    );
  }

  return {
    netProceedsRequired: netProceeds,
    cashReserveRequired: cashReserve,
    principalRequired: principal,
    perCard,
    withinLenderRange: withinRange,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Evaluating a concrete offer
// ---------------------------------------------------------------------------

export interface UtilizationSnapshot {
  aggregatePct: number | null;
  totalBalance: number;
  totalLimit: number;
  perCard: { cardId: string; name: string; balance: number; utilizationPct: number | null; isOpen: boolean }[];
  worstCardPct: number | null;
}

export interface ConsolidationResult {
  terms: LoanTerms;
  monthlyPayment: number;
  netProceeds: number;
  applied: { cardId: string; cardName: string; label: string; amount: number; apr: number }[];
  /** Proceeds left after every bucket the loan could reach was retired. */
  leftoverCash: number;
  /** Proceeds fell short of the requested payoff by this much. */
  shortfall: number;
  before: UtilizationSnapshot;
  /** On funding day. */
  after: UtilizationSnapshot;
  /** At the worst point once every committed charge has landed. This is the one that matters. */
  afterScheduledCharges: UtilizationSnapshot;
  interest: {
    loanTotal: number;
    /** Carrying the same balances on the cards instead, paying `comparisonMonthlyPayment`. */
    statusQuoTotal: number | null;
    statusQuoMonths: number | null;
    /** Positive = the loan costs MORE interest than staying put. */
    delta: number | null;
    blendedCardApr: number;
  };
  constraints: {
    allCardsUnderMax: boolean;
    interestFree: boolean;
    violations: string[];
  };
  affordability: {
    monthlyCapacity: number | null;
    /** Negative = the payment does not fit. */
    headroom: number | null;
    fits: boolean | null;
  };
}

function snapshot(
  cards: readonly ConsolidationCard[],
  balances: Map<string, number>,
  asOf: string,
): UtilizationSnapshot {
  const utilCards: UtilizationCard[] = cards.map(c => ({
    id: c.id,
    name: c.name,
    balance: balances.get(c.id) ?? c.balance,
    creditLimit: c.creditLimit,
    startDate: c.startDate ?? undefined,
  }));
  const now = new Date(`${asOf}T00:00:00Z`);
  const overall = summarizeUtilization(utilCards, now);
  const perCard = utilCards.map(c => {
    const open = cardOpenAsOf(c.startDate, asOf);
    return {
      cardId: c.id,
      name: c.name,
      balance: c.balance,
      utilizationPct: open && c.creditLimit > 0 ? (c.balance / c.creditLimit) * 100 : null,
      isOpen: open,
    };
  });
  const openPcts = perCard.filter(c => c.isOpen && c.utilizationPct !== null).map(c => c.utilizationPct!);
  return {
    aggregatePct: overall.utilizationPct,
    totalBalance: overall.totalBalance,
    totalLimit: overall.totalLimit,
    perCard,
    worstCardPct: openPcts.length ? Math.max(...openPcts) : null,
  };
}

/**
 * Interest cost of NOT consolidating: carry the cards and pay `monthlyPayment` against them,
 * avalanche order, tranches repriced as each promo lapses.
 *
 * Returns null months when the payment cannot cover accruing interest — a balance that grows has
 * no payoff date, and reporting one would be a lie in the direction that flatters the status quo.
 */
export function simulateStatusQuo(
  cards: readonly ConsolidationCard[],
  monthlyPayment: number,
  asOf: string,
  maxMonths = 600,
): { totalInterest: number; months: number | null } {
  const balances = new Map<string, Map<string, number>>();
  for (const card of cards) {
    const inner = new Map<string, number>();
    for (const b of buildPayoffBuckets([card], asOf)) inner.set(b.trancheId, b.balance);
    balances.set(card.id, inner);
  }

  let totalInterest = 0;
  for (let m = 0; m < maxMonths; m++) {
    const monthISO = addMonthsISO(asOf, m);
    // Accrue at each bucket's rate for THIS month, so a promo cliff shows up on time.
    const buckets: { cardId: string; trancheId: string; apr: number; balance: number }[] = [];
    for (const card of cards) {
      const inner = balances.get(card.id)!;
      for (const [trancheId, bal] of inner) {
        if (bal <= 0.005) continue;
        const t = (card.tranches ?? []).find(x => (x.id || x.label) === trancheId);
        const apr = t ? trancheAprAsOf(t, card.apr, monthISO) : card.apr;
        const interest = (bal * (apr / 100)) / 12;
        totalInterest += interest;
        inner.set(trancheId, bal + interest);
        buckets.push({ cardId: card.id, trancheId, apr, balance: bal + interest });
      }
    }
    const outstanding = buckets.reduce((s, b) => s + b.balance, 0);
    if (outstanding <= 0.01) return { totalInterest, months: m };

    // CARD Act ordering across everything still owed.
    buckets.sort((a, b) => b.apr - a.apr);
    let left = monthlyPayment;
    for (const b of buckets) {
      if (left <= 0) break;
      const applied = Math.min(left, b.balance);
      balances.get(b.cardId)!.set(b.trancheId, b.balance - applied);
      left -= applied;
    }
    const after = cards.reduce(
      (s, c) => s + [...balances.get(c.id)!.values()].reduce((a, v) => a + Math.max(0, v), 0), 0,
    );
    if (after <= 0.01) return { totalInterest, months: m + 1 };
    if (after >= outstanding - 0.005) return { totalInterest, months: null }; // not shrinking
  }
  return { totalInterest, months: null };
}

export interface EvaluateInput {
  cards: readonly ConsolidationCard[];
  terms: LoanTerms;
  charges?: readonly ScheduledCardCharge[];
  constraints?: ConsolidationConstraints;
  asOf: string;
  /** Cash per month available for debt service, for the affordability check. */
  monthlyCapacity?: number;
  /** What the user would otherwise pay the cards each month, for the interest comparison. */
  comparisonMonthlyPayment?: number;
}

/** Price a specific offer against the cards, the constraints, and the charges still coming. */
export function evaluateConsolidation(input: EvaluateInput): ConsolidationResult {
  const { cards, terms, charges = [], constraints = {}, asOf } = input;
  const feePct = terms.originationFeePct ?? 0;
  const netProceeds = terms.principal * (1 - feePct / 100);
  const monthlyPayment = amortizedPayment(terms.principal, terms.aprPct, terms.termMonths);

  const before = snapshot(cards, new Map(), asOf);

  // Retire buckets most-expensive-first until the money runs out.
  const buckets = buildPayoffBuckets(cards, asOf);
  const applied: ConsolidationResult['applied'] = [];
  const afterBalances = new Map<string, number>(cards.map(c => [c.id, c.balance]));
  let left = netProceeds;
  for (const b of buckets) {
    if (left <= 0.005) break;
    const amount = Math.min(left, b.balance);
    left -= amount;
    afterBalances.set(b.cardId, (afterBalances.get(b.cardId) ?? 0) - amount);
    applied.push({ cardId: b.cardId, cardName: b.cardName, label: b.label, amount, apr: b.effectiveApr });
  }
  const totalOwed = buckets.reduce((s, b) => s + b.balance, 0);
  const shortfall = Math.max(0, totalOwed - netProceeds);
  const leftoverCash = Math.max(0, left);

  const after = snapshot(cards, afterBalances, asOf);

  // Worst future point: every committed charge that still lands, added back.
  const withCharges = new Map(afterBalances);
  for (const c of charges) {
    if (!(c.landsOnCard ?? true)) continue;
    const total = c.amountPerMonth * c.monthsRemaining;
    // Leftover cash absorbs charges before they touch a card.
    withCharges.set(c.cardId, (withCharges.get(c.cardId) ?? 0) + total);
  }
  let absorb = leftoverCash;
  for (const [id, bal] of withCharges) {
    if (absorb <= 0) break;
    const used = Math.min(absorb, Math.max(0, bal - (afterBalances.get(id) ?? 0)));
    withCharges.set(id, bal - used);
    absorb -= used;
  }
  const afterScheduledCharges = snapshot(cards, withCharges, asOf);

  // Interest comparison. Baseline payment defaults to the loan payment so the two are like-for-like.
  const comparisonPayment = input.comparisonMonthlyPayment ?? monthlyPayment;
  const sq = simulateStatusQuo(cards, comparisonPayment, asOf);
  const loanInterest = loanTotalInterest(terms.principal, terms.aprPct, terms.termMonths);
  const blendedCardApr = totalOwed > 0
    ? buckets.reduce((s, b) => s + b.balance * b.effectiveApr, 0) / totalOwed
    : 0;

  // Constraints, checked at the WORST point, not on funding day.
  const violations: string[] = [];
  const checkSnap = constraints.holdThroughScheduledCharges ? afterScheduledCharges : after;
  const maxPct = constraints.maxCardUtilizationPct;
  let allUnder = true;
  if (maxPct !== undefined) {
    for (const c of checkSnap.perCard) {
      if (!c.isOpen || c.utilizationPct === null) continue;
      if (c.utilizationPct > maxPct + 1e-9) {
        allUnder = false;
        violations.push(`${c.name} at ${c.utilizationPct.toFixed(1)}% exceeds the ${maxPct}% ceiling.`);
      }
    }
  }
  let interestFree = true;
  if (constraints.requireInterestFree) {
    const remaining = buildPayoffBuckets(
      cards.map(c => ({ ...c, balance: checkSnap.perCard.find(p => p.cardId === c.id)?.balance ?? 0 })),
      asOf,
    ).filter(b => b.effectiveApr > 0 && b.balance > 0.01);
    if (remaining.length > 0) {
      interestFree = false;
      for (const r of remaining) {
        violations.push(`${r.cardName} still carries $${r.balance.toFixed(2)} at ${r.effectiveApr}%.`);
      }
    }
  }

  const capacity = input.monthlyCapacity ?? null;
  const headroom = capacity === null ? null : capacity - monthlyPayment;

  return {
    terms,
    monthlyPayment,
    netProceeds,
    applied,
    leftoverCash,
    shortfall,
    before,
    after,
    afterScheduledCharges,
    interest: {
      loanTotal: loanInterest,
      statusQuoTotal: sq.months === null ? null : sq.totalInterest,
      statusQuoMonths: sq.months,
      delta: sq.months === null ? null : loanInterest - sq.totalInterest,
      blendedCardApr,
    },
    constraints: { allCardsUnderMax: allUnder, interestFree, violations },
    affordability: { monthlyCapacity: capacity, headroom, fits: headroom === null ? null : headroom >= 0 },
  };
}

/**
 * The rate at which a loan stops being worth it on interest alone, for a given term.
 *
 * Found by bisection against `simulateStatusQuo`, because the honest baseline is not "minimum
 * payments forever" — it is the user paying what they already pay, which retires the cards on its
 * own schedule. Comparing a 72-month loan against a 25-month self-payoff is how consolidation gets
 * oversold, and this returns the number that makes the trade visible.
 */
export function breakEvenApr(
  cards: readonly ConsolidationCard[],
  termMonths: number,
  comparisonMonthlyPayment: number,
  asOf: string,
  principalOverride?: number,
): number | null {
  const buckets = buildPayoffBuckets(cards, asOf);
  const principal = principalOverride ?? buckets.reduce((s, b) => s + b.balance, 0);
  if (principal <= 0) return null;
  const sq = simulateStatusQuo(cards, comparisonMonthlyPayment, asOf);
  if (sq.months === null) return null;

  let lo = 0, hi = 60;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (loanTotalInterest(principal, mid, termMonths) > sq.totalInterest) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Months until a promo tranche reprices, for surfacing the cliff alongside the decision. */
export function promoCliffMonths(card: ConsolidationCard, asOf: string): number | null {
  const next = (card.tranches ?? [])
    .filter(t => t.promo_end_date && asOf < t.promo_end_date)
    .sort((a, b) => (a.promo_end_date! < b.promo_end_date! ? -1 : 1))[0];
  return next ? monthsUntil(asOf, next.promo_end_date!) : null;
}
