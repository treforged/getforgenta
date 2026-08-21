// What happens if there is no loan at all.
//
// WHY THIS FILE EXISTS. `consolidation.ts` answers "how big a loan do I need and is it worth it".
// On 2026-08-20 that question stopped being the live one: the loan was declined, and the plan
// became to pay the cards down out of cash flow and reapply later. `simulateStatusQuo` in
// `consolidation.ts` is the right shape for a BASELINE — one flat payment, avalanche order — but it
// is the wrong tool for a PLAN, for three reasons this module exists to fix:
//
//  1. **Capacity is not flat.** Free cash swings from $447/mo to $927/mo to $11.93/mo across the
//     next two years as income and obligations start and stop, with a bonus landing in one single
//     month. A simulation that averages that away answers a question nobody asked.
//  2. **Avalanche is not always the goal.** Avalanche minimises interest. It does not minimise the
//     thing a declined applicant is actually being judged on, which is per-card utilization. When
//     the top denial reason is one card at 94.7%, paying the cheaper card first is the correct move
//     and the interest-optimal one is not. This module takes the priority as an INPUT and reports
//     the interest cost of the choice rather than making it.
//  3. **The finish line is a percentage, not zero.** "When am I under 30% on that card" is the
//     question that decides when to reapply, and it is answered many months before payoff.
//
// ⚠️ SCHEDULED CHARGES ARE ADDED BACK. A `monthly_charge` plan still landing on a card fights the
// paydown every month it runs. Leaving them out would date every milestone early, in the direction
// that flatters the plan. `consolidation-adapter.ts` supplies them from `payment_plans`.
//
// ⚠️ AND SO IS ORDINARY SPEND — see `chargesByMonth`. `payment_plans` instalments are the small
// half of what lands on these cards; the recurring purchases are the big half.
//
// ⚠️ BUT `chargesByMonth` IS FOR A CALLER WHOSE `capacity` IS A TRUE SURPLUS. It is NOT the fix for
// a caller sourcing capacity from a projection's per-card PAYMENT ledger, which is what
// `CreditCardEngine` does. Those payments are endogenous to that projection's own balance path:
// they shrink as its balances shrink. Add spend on top and the simulation's balances stay high
// while its capacity still collapses on the projection's schedule, and the plan never converges.
// Measured 2026-08-20 on the real cards: gross capacity alone dated payoff Aug 2027 against the
// engine's own Jun 2028 ETA; gross capacity plus this array dated it "never" at $97,543 of
// interest. The number such a caller wants is the NET paydown (payment minus that card's purchases
// for the month), with nothing added back here. See `handoff.md`.

import { trancheAprAsOf } from './balance-tranches';
import { addMonthsToDate } from './car-maintenance';
import { summarizeUtilization, type UtilizationCard } from './credit-utilization';
import { cardStartMonthOffset } from './card-start-date';
import { buildPayoffBuckets, type ConsolidationCard, type ScheduledCardCharge } from './consolidation';

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Cash available for card payments, month by month from `asOf`.
 *
 * A single number is flat forever. An array is indexed by month offset and **the last entry carries
 * forward**, which is what makes a two-year schedule expressible in a handful of numbers and, more
 * importantly, makes the terminal value explicit: the last number in the array is the one the plan
 * lives on once every temporary income has stopped.
 */
export type CapacitySchedule = number | readonly number[];

/** A single non-recurring payment — a bonus, a refund, a tax return. */
export interface CapacityOneOff {
  label: string;
  /** Month offset from `asOf`. 0 is the current month. */
  month: number;
  amount: number;
}

export function capacityAt(schedule: CapacitySchedule, month: number): number {
  if (typeof schedule === 'number') return schedule;
  if (schedule.length === 0) return 0;
  return schedule[Math.min(month, schedule.length - 1)];
}

/**
 * The per-card spend landing in `month`, with the last entry carrying forward.
 *
 * Same carry-forward rule as `capacityAt`, and for the same reason: the arrays a caller can supply
 * are as long as its projection horizon, while the simulation runs to `maxMonths`. Letting spend
 * fall to zero past the horizon while capacity carries forward would make the tail of every plan
 * silently optimistic.
 */
export function chargesByMonthAt(
  schedule: readonly Readonly<Record<string, number>>[] | undefined,
  month: number,
): Readonly<Record<string, number>> | null {
  if (!schedule || schedule.length === 0) return null;
  return schedule[Math.min(month, schedule.length - 1)] ?? null;
}

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export interface PaydownInput {
  cards: readonly ConsolidationCard[];
  charges?: readonly ScheduledCardCharge[];
  /**
   * New spend landing on each card, per month, indexed from `asOf` — `[{ cardId: amount }]`.
   *
   * ⚠️ THIS IS NOT OPTIONAL POLISH, IT IS WHAT MAKES `capacity` MEAN ANYTHING. A caller sourcing
   * `capacity` from a projection's per-card PAYMENT ledger is handing over a GROSS number: the
   * engine's $687 payment on a card that also took $448 of purchases reduces the balance by $239,
   * not $687. Feeding the gross payment as capacity while modelling only `charges` (which covers
   * `payment_plans` instalments and nothing else) credits the plan with every ordinary purchase it
   * was actually funding, and dates every milestone early by exactly that much.
   *
   * Like `capacity`, **the last entry carries forward** — the array runs out at the projection
   * horizon and spending does not. Months past the end of the array reuse the final month rather
   * than assuming the cards suddenly go unused.
   *
   * Charges supplied here land alongside `charges`, so a caller whose per-month array already
   * includes its `payment_plans` instalments (the engine's `augmentedCCPurchases` does) must not
   * also pass them as `charges`.
   */
  chargesByMonth?: readonly Readonly<Record<string, number>>[];
  /** `YYYY-MM-DD`. */
  asOf: string;
  capacity: CapacitySchedule;
  /**
   * The cash actually LEAVING the bank for the cards each month, when that differs from `capacity`.
   *
   * ⚠️ THIS EXISTS FOR EXACTLY ONE REASON: `shortfallMonths`. A caller may legitimately hand over a
   * NET `capacity` — payment minus that month's new spend — because net is what moves a balance,
   * and it is the only way to reproduce a projection that charges purchases to the same cards (see
   * `chargesByMonth` above for the measurement). But minimums are paid out of the GROSS payment.
   * Testing a net number against gross minimums invents shortfall months that will not happen, and
   * "you will miss a payment" is the single most damaging thing this simulation can say wrongly.
   *
   * So: `capacity` pays balances down, `grossCapacity` is what the minimum test is allowed to see.
   * Omit it and the two are the same number, which is correct for every caller whose capacity is a
   * true surplus. `oneOffs` count toward both — a bonus is real cash either way.
   */
  grossCapacity?: CapacitySchedule;
  oneOffs?: readonly CapacityOneOff[];
  /**
   * Card ids in the order surplus should attack them, most urgent first. Any card not named falls
   * back to avalanche order behind the named ones. Omit for pure avalanche.
   *
   * ⚠️ MINIMUMS ARE PAID ON EVERY CARD FIRST regardless of priority. Redirecting a minimum is a
   * missed payment, which costs more score than any utilization gain gives back.
   */
  priorityCardIds?: readonly string[];
  /** Per-card and aggregate utilization thresholds to date, e.g. `[50, 30]`. */
  milestonesPct?: readonly number[];
  maxMonths?: number;
}

export interface PaydownMonth {
  month: number;
  /** `YYYY-MM-DD` of this month, same day-of-month as `asOf`. */
  date: string;
  /** Cash applied to cards this month, including any one-off. */
  paid: number;
  /** Interest accrued across every card this month. */
  interest: number;
  /** Committed plan instalments that landed on cards this month. */
  chargesAdded: number;
  totalBalance: number;
  /** Across OPEN cards only, from `summarizeUtilization`. Null when no card is open yet. */
  aggregateUtilizationPct: number | null;
  perCard: { cardId: string; name: string; balance: number; utilizationPct: number | null; isOpen: boolean }[];
}

export interface PaydownMilestone {
  /** A card id, or `'aggregate'` for the across-all-open-cards figure. */
  target: string;
  label: string;
  pct: number;
  /** Month offset it is first met, or null if never within `maxMonths`. */
  month: number | null;
  date: string | null;
}

export interface PaydownResult {
  /** Month offset every card reaches zero, or null if the plan never clears them. */
  payoffMonth: number | null;
  payoffDate: string | null;
  totalInterest: number;
  /** Cash actually applied. Less than total capacity when the cards clear before the money stops. */
  totalPaid: number;
  timeline: PaydownMonth[];
  milestones: PaydownMilestone[];
  /** Months where capacity could not even cover every card's minimum. The plan is broken in these. */
  shortfallMonths: { month: number; date: string; minimumsDue: number; capacity: number }[];
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

interface Bucket {
  cardId: string;
  trancheId: string;
  balance: number;
}

function isOpen(card: ConsolidationCard, monthISO: string): boolean {
  return cardStartMonthOffset(card.startDate, new Date(`${monthISO}T00:00:00`)) === 0;
}

function snapshotCards(
  cards: readonly ConsolidationCard[],
  balanceOf: (cardId: string) => number,
  monthISO: string,
) {
  const utilCards: UtilizationCard[] = cards.map(c => ({
    id: c.id,
    name: c.name,
    balance: balanceOf(c.id),
    creditLimit: c.creditLimit,
    startDate: c.startDate ?? undefined,
  }));
  const overall = summarizeUtilization(utilCards, new Date(`${monthISO}T00:00:00Z`));
  const perCard = cards.map(c => {
    const open = isOpen(c, monthISO);
    const balance = balanceOf(c.id);
    return {
      cardId: c.id,
      name: c.name,
      balance,
      utilizationPct: open && c.creditLimit > 0 ? (balance / c.creditLimit) * 100 : null,
      isOpen: open,
    };
  });
  return { aggregatePct: overall.utilizationPct, perCard };
}

/**
 * Walk the cards forward on cash flow alone.
 *
 * Order within a month: accrue interest, land committed charges, pay every minimum, then throw
 * whatever is left at the priority order. That sequence is the pessimistic one at every step —
 * interest is charged on the pre-payment balance and a plan instalment posts before the payment
 * does — which is the direction an honest plan should err in.
 */
export function simulateSelfFundedPaydown(input: PaydownInput): PaydownResult {
  const { cards, charges = [], asOf } = input;
  const maxMonths = input.maxMonths ?? 240;
  const milestonesPct = input.milestonesPct ?? [];
  const priority = input.priorityCardIds ?? [];

  // Per-card, per-tranche ledger. `buildPayoffBuckets` already splits the remainder out at the
  // standard rate and clamps stale tranches against the balance, so this inherits both.
  const ledger = new Map<string, Map<string, number>>();
  for (const card of cards) {
    const inner = new Map<string, number>();
    for (const b of buildPayoffBuckets([card], asOf)) inner.set(b.trancheId, b.balance);
    // A card with a zero balance has no buckets; it still needs an entry so charges can land on it.
    if (inner.size === 0) inner.set('remainder', 0);
    ledger.set(card.id, inner);
  }

  const balanceOf = (cardId: string): number => {
    const inner = ledger.get(cardId);
    if (!inner) return 0;
    let sum = 0;
    for (const v of inner.values()) sum += Math.max(0, v);
    return sum;
  };

  const priorityRank = (cardId: string): number => {
    const i = priority.indexOf(cardId);
    return i === -1 ? priority.length : i;
  };

  const timeline: PaydownMonth[] = [];
  const shortfallMonths: PaydownResult['shortfallMonths'] = [];
  const milestoneHits = new Map<string, PaydownMilestone>();
  let totalInterest = 0;
  let totalPaid = 0;
  let payoffMonth: number | null = null;

  const recordMilestones = (
    month: number,
    monthISO: string,
    aggregatePct: number | null,
    perCard: PaydownMonth['perCard'],
  ) => {
    for (const pct of milestonesPct) {
      const aggKey = `aggregate@${pct}`;
      if (!milestoneHits.has(aggKey) && aggregatePct !== null && aggregatePct <= pct) {
        milestoneHits.set(aggKey, {
          target: 'aggregate',
          label: 'All open cards',
          pct,
          month,
          date: monthISO,
        });
      }
      for (const c of perCard) {
        if (!c.isOpen) continue;
        const key = `${c.cardId}@${pct}`;
        if (milestoneHits.has(key)) continue;
        if (c.utilizationPct !== null && c.utilizationPct <= pct) {
          milestoneHits.set(key, { target: c.cardId, label: c.name, pct, month, date: monthISO });
        }
      }
    }
  };

  for (let m = 0; m < maxMonths; m++) {
    const monthISO = addMonthsToDate(asOf, m);

    // 1. Interest, at each bucket's rate for THIS month so a promo cliff arrives on schedule.
    let monthInterest = 0;
    for (const card of cards) {
      const inner = ledger.get(card.id)!;
      for (const [trancheId, bal] of inner) {
        if (bal <= 0.005) continue;
        const t = (card.tranches ?? []).find(x => (x.id || x.label) === trancheId);
        const apr = t ? trancheAprAsOf(t, card.apr, monthISO) : card.apr;
        const interest = (bal * (apr / 100)) / 12;
        monthInterest += interest;
        inner.set(trancheId, bal + interest);
      }
    }
    totalInterest += monthInterest;

    // 2. Committed charges land. They post at the card's STANDARD rate, not a promo one — a new
    //    purchase never joins an existing promo tranche.
    let chargesAdded = 0;
    for (const ch of charges) {
      if (ch.landsOnCard === false) continue;
      if (m >= ch.monthsRemaining) continue;
      const inner = ledger.get(ch.cardId);
      if (!inner) continue;
      inner.set('remainder', (inner.get('remainder') ?? 0) + ch.amountPerMonth);
      chargesAdded += ch.amountPerMonth;
    }

    // 2b. Per-month spend, same posting rule. Last entry carries forward, matching `capacityAt`,
    //     so a 60-month array does not quietly turn into "no purchases from year 6 onward" while
    //     the capacity it was paired with keeps paying.
    const monthCharges = chargesByMonthAt(input.chargesByMonth, m);
    if (monthCharges) {
      for (const cardId of Object.keys(monthCharges)) {
        const amount = monthCharges[cardId];
        if (!(amount > 0)) continue;
        const inner = ledger.get(cardId);
        if (!inner) continue;
        inner.set('remainder', (inner.get('remainder') ?? 0) + amount);
        chargesAdded += amount;
      }
    }

    // 3. Minimums on every card that still owes anything, before any priority spending.
    const owing = cards.filter(c => balanceOf(c.id) > 0.005);
    const minimumsDue = owing.reduce(
      (s, c) => s + Math.min(c.minPayment ?? 0, balanceOf(c.id)),
      0,
    );
    const oneOffCash = (input.oneOffs ?? [])
      .filter(o => o.month === m)
      .reduce((s, o) => s + o.amount, 0);
    const cash = capacityAt(input.capacity, m) + oneOffCash;

    // The minimum test reads GROSS cash — the money that actually leaves the bank — because that
    // is what a minimum is paid out of. When `capacity` is net of new spend the two differ, and
    // comparing net against gross minimums manufactures shortfalls. See `grossCapacity`.
    const grossCash = capacityAt(input.grossCapacity ?? input.capacity, m) + oneOffCash;

    if (owing.length > 0 && grossCash < minimumsDue - 0.005) {
      shortfallMonths.push({ month: m, date: monthISO, minimumsDue, capacity: grossCash });
    }

    let left = cash;
    let paid = 0;
    const payCard = (cardId: string, amount: number) => {
      if (amount <= 0) return 0;
      const inner = ledger.get(cardId)!;
      // CARD Act: anything above the minimum goes to the highest rate first. Applying the whole
      // payment that way is the standard simplification and matches `simulateStatusQuo`.
      const ordered = [...inner.entries()]
        .filter(([, bal]) => bal > 0.005)
        .map(([trancheId, bal]) => {
          const card = cards.find(c => c.id === cardId)!;
          const t = (card.tranches ?? []).find(x => (x.id || x.label) === trancheId);
          return { trancheId, bal, apr: t ? trancheAprAsOf(t, card.apr, monthISO) : card.apr };
        })
        .sort((a, b) => b.apr - a.apr);
      let remaining = amount;
      let applied = 0;
      for (const b of ordered) {
        if (remaining <= 0) break;
        const hit = Math.min(remaining, b.bal);
        inner.set(b.trancheId, b.bal - hit);
        remaining -= hit;
        applied += hit;
      }
      return applied;
    };

    for (const card of owing) {
      const due = Math.min(card.minPayment ?? 0, balanceOf(card.id), Math.max(0, left));
      const applied = payCard(card.id, due);
      left -= applied;
      paid += applied;
    }

    // 4. Everything left, in priority order, then avalanche behind it.
    const surplusOrder = [...cards]
      .filter(c => balanceOf(c.id) > 0.005)
      .sort((a, b) => {
        const pr = priorityRank(a.id) - priorityRank(b.id);
        if (pr !== 0) return pr;
        return highestRate(b, monthISO) - highestRate(a, monthISO);
      });
    for (const card of surplusOrder) {
      if (left <= 0.005) break;
      const applied = payCard(card.id, Math.min(left, balanceOf(card.id)));
      left -= applied;
      paid += applied;
    }
    totalPaid += paid;

    const snap = snapshotCards(cards, balanceOf, monthISO);
    const totalBalance = cards.reduce((s, c) => s + balanceOf(c.id), 0);
    timeline.push({
      month: m,
      date: monthISO,
      paid,
      interest: monthInterest,
      chargesAdded,
      totalBalance,
      aggregateUtilizationPct: snap.aggregatePct,
      perCard: snap.perCard,
    });
    recordMilestones(m, monthISO, snap.aggregatePct, snap.perCard);

    if (totalBalance <= 0.01) {
      payoffMonth = m;
      break;
    }
  }

  const milestones: PaydownMilestone[] = [];
  for (const pct of milestonesPct) {
    const agg = milestoneHits.get(`aggregate@${pct}`);
    milestones.push(agg ?? { target: 'aggregate', label: 'All open cards', pct, month: null, date: null });
    for (const card of cards) {
      const hit = milestoneHits.get(`${card.id}@${pct}`);
      milestones.push(hit ?? { target: card.id, label: card.name, pct, month: null, date: null });
    }
  }

  return {
    payoffMonth,
    payoffDate: payoffMonth === null ? null : addMonthsToDate(asOf, payoffMonth),
    totalInterest,
    totalPaid,
    timeline,
    milestones,
    shortfallMonths,
  };
}

function highestRate(card: ConsolidationCard, monthISO: string): number {
  const rates = (card.tranches ?? []).map(t => trancheAprAsOf(t, card.apr, monthISO));
  return rates.length ? Math.max(card.apr, ...rates) : card.apr;
}

// ---------------------------------------------------------------------------
// Credit-application collisions
// ---------------------------------------------------------------------------

export type CreditEventKind = 'card-opening' | 'loan-application';

export interface PlannedCreditEvent {
  id: string;
  label: string;
  /** `YYYY-MM-DD`. For a card this is `accounts.card_start_date`. */
  date: string;
  kind: CreditEventKind;
}

export interface CreditCollision {
  applicationId: string;
  applicationLabel: string;
  applicationDate: string;
  openingId: string;
  openingLabel: string;
  openingDate: string;
  /** Negative = the card opens BEFORE the application. */
  monthsFromApplication: number;
  reason: string;
  /** The earliest date the card opening could move to and stop colliding. */
  suggestedOpeningDate: string;
}

export interface CollisionOptions {
  /**
   * How long a newly opened account keeps counting as "recently opened" against an application.
   * Six is the conservative end of the 6-12 month range lenders use, and Discover's own decline
   * cited an auto loan opened two months prior.
   */
  lookbackMonths?: number;
  /**
   * How long after applying a new account is still dangerous. One month covers underwriting: an
   * inquiry landing mid-decision can move the answer on a file that is already marginal.
   */
  underwritingMonths?: number;
}

function monthsBetweenISO(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm);
}

/**
 * Planned card openings that sit too close to a planned credit application.
 *
 * ⚠️ THIS IS THE MISTAKE THE APP ALMOST MADE FOR HIM. On 2026-08-20 the Venture X `card_start_date`
 * was moved to 2027-04-20 to start ageing a new tradeline — and April 2027 is also the month the
 * declined loan would be reapplied for. Opening a card weeks before reapplying feeds reason code 2
 * ("too many recently opened trades"), which is the exact reason that got him declined. Nothing in
 * the app noticed, because the two dates live in different tables.
 *
 * Reported, never auto-resolved: which one moves is the user's call, and the app does not know
 * whether the card or the loan is the thing they actually want.
 */
export function creditApplicationCollisions(
  events: readonly PlannedCreditEvent[],
  opts: CollisionOptions = {},
): CreditCollision[] {
  const lookback = opts.lookbackMonths ?? 6;
  const underwriting = opts.underwritingMonths ?? 1;
  const applications = events.filter(e => e.kind === 'loan-application');
  const openings = events.filter(e => e.kind === 'card-opening');
  const out: CreditCollision[] = [];

  for (const app of applications) {
    for (const open of openings) {
      const delta = monthsBetweenISO(app.date, open.date);
      if (delta < -lookback || delta > underwriting) continue;
      out.push({
        applicationId: app.id,
        applicationLabel: app.label,
        applicationDate: app.date,
        openingId: open.id,
        openingLabel: open.label,
        openingDate: open.date,
        monthsFromApplication: delta,
        reason:
          delta === 0
            // Not "0 months before" — a distance of zero is not a distance, and the sentence has to
            // read like something a person would say out loud.
            ? `${open.label} opens the same month as ${app.label}, so it still reads as a recently opened trade.`
            : delta < 0
              ? `${open.label} opens ${Math.abs(delta)} month${Math.abs(delta) === 1 ? '' : 's'} before ${app.label}, so it still reads as a recently opened trade.`
              : `${open.label} opens while ${app.label} is still being underwritten, so its inquiry can land mid-decision.`,
        suggestedOpeningDate: addMonthsToDate(app.date, underwriting + 1),
      });
    }
  }

  return out.sort((a, b) => (a.openingDate < b.openingDate ? -1 : 1));
}
