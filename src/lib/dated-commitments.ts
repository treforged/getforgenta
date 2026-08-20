import { monthsUntil } from '@/lib/balance-tranches';

/**
 * Every obligation that has a DATE attached, and what each one actually requires per month.
 *
 * ── The problem this solves ──────────────────────────────────────────────────────────────────
 *
 * The app already lets a user RANK where spare money goes (`surplus-ranking.ts`), and it already
 * lets them set a monthly contribution by hand. Neither knows about deadlines. So a goal that has
 * to be fully funded by a fixed date sits at a hand-typed number nobody recalculates, and the user
 * is left doing the one piece of arithmetic a computer should never have handed back: "how much do
 * I have to put in each month, and can I still pay the card down with the rest?"
 *
 * A rank alone cannot answer that, because a rank says WHICH FIRST and the real question is
 * HOW MUCH EACH. Those are different questions and only the second one has a deadline in it.
 *
 * ── The idea ─────────────────────────────────────────────────────────────────────────────────
 *
 * A dated obligation is `remaining ÷ months left` — a FLOOR, not a preference. Fund exactly that
 * much and not a dollar more, because every dollar above the floor sits in a savings account at
 * roughly nothing while a card charges 27%. Everything above the floors then flows down the
 * existing ranked list, to the highest-cost debt first.
 *
 * ── The part that makes it judgement rather than division ────────────────────────────────────
 *
 * NOT EVERY DEADLINE IS WORTH MEETING. Missing one has a price, and sometimes that price is lower
 * than the return on the money you would spend meeting it. Two genuinely different shapes, and
 * conflating them is what makes a naive sort-by-date allocator give bad advice:
 *
 *   • `hard` — missing it has no dollar price because it is not a financial event. The deposit is
 *     due or the move does not happen. There is no rate to compare it against, so the floor is
 *     absolute and is funded before anything is optimised.
 *
 *   • `priced` — missing it costs a computable rate on a balance. A promo tranche that reprices at
 *     the cliff is this shape. Here the floor is worth honouring only if the repriced rate is
 *     WORSE than the best thing the money could otherwise do. A promo repricing to 16.6% is not
 *     worth clearing early when the same dollar could kill a 27.5% balance instead — the correct
 *     move is to let the cliff happen, and the app should say so out loud rather than dutifully
 *     reserving cash for a deadline that does not deserve it.
 *
 * ── What this module refuses to do ───────────────────────────────────────────────────────────
 *
 * It never silently under-funds. If the floors do not fit in the money available, that is a plan
 * that does not work, and `feasible` says so — the caller must show the shortfall rather than
 * quietly funding four commitments out of five and rendering a page that looks fine.
 *
 * Pure and date-injected: `asOf` is always passed, never read off the clock, so the same inputs
 * give the same answer in a test, in the forecast engine and in the advisor.
 */

/** What it costs to miss the date. See the header — this distinction is the whole design. */
export type CommitmentConsequence =
  /** Not a financial event. No rate, no trade-off, the floor is absolute. */
  | { kind: 'hard' }
  /** Missing it reprices the balance at `missedApr`, so the floor is worth only that much. */
  | { kind: 'priced'; missedApr: number };

export interface DatedCommitment {
  id: string;
  source: 'savings_goal' | 'car_fund' | 'promo_tranche';
  label: string;
  /** Still to fund, or still to clear. Already net of what is saved or paid. */
  remaining: number;
  /** YYYY-MM-DD. The date the money has to be there by. */
  dueDate: string;
  /** What the user already sends toward this every month, from their own settings. */
  committedMonthly: number;
  consequence: CommitmentConsequence;
}

export type CommitmentStatus =
  /** The standing contribution already covers the floor. Nothing to do. */
  | 'on_track'
  /** Contributing, but not enough to land on time. */
  | 'behind'
  /** Nothing at all is going in, and the date is real. */
  | 'unfunded'
  /** Already funded — nothing remains. */
  | 'met';

export interface CommitmentPlan extends DatedCommitment {
  monthsRemaining: number;
  /** `remaining ÷ monthsRemaining`. The floor. Zero once the commitment is met. */
  requiredMonthly: number;
  /** What is still missing each month over and above what is already committed. Never negative. */
  shortfallMonthly: number;
  status: CommitmentStatus;
  /**
   * Whether this floor should actually be reserved.
   *
   * Always true for `hard`. For `priced`, only when missing it costs more than the best
   * alternative use of the money earns.
   */
  binding: boolean;
  /** Why a `priced` floor was NOT reserved, for the UI to show. `null` when it binds. */
  notBindingReason: string | null;
}

export interface CommitmentPlanOptions {
  /** YYYY-MM-DD. Injected, never read off the clock. */
  asOf: string;
  /**
   * The best return available to a dollar that is NOT reserved against a deadline — in practice
   * the highest APR being carried, because paying that down is the risk-free return to beat.
   *
   * This is what a `priced` deadline is measured against. Pass 0 when there is no debt at all;
   * then every priced deadline binds, which is the right answer — with nothing better to do with
   * the money, avoiding any repricing at all is worth it.
   */
  bestAlternativeApr: number;
}

/**
 * Work out what each dated obligation requires per month, and whether that requirement is worth
 * honouring. Sorted by due date, soonest first — the order a person reads their own calendar in.
 */
export function planDatedCommitments(
  commitments: readonly DatedCommitment[],
  { asOf, bestAlternativeApr }: CommitmentPlanOptions,
): CommitmentPlan[] {
  return commitments
    .map<CommitmentPlan>(c => {
      const monthsRemaining = monthsUntil(asOf, c.dueDate);
      const remaining = Math.max(0, c.remaining);
      const met = remaining === 0;
      const requiredMonthly = met ? 0 : remaining / monthsRemaining;
      const shortfallMonthly = Math.max(0, requiredMonthly - Math.max(0, c.committedMonthly));

      let binding = true;
      let notBindingReason: string | null = null;
      if (c.consequence.kind === 'priced' && c.consequence.missedApr <= bestAlternativeApr) {
        binding = false;
        notBindingReason =
          `Missing this costs ${c.consequence.missedApr}%, and the same dollar is worth `
          + `${bestAlternativeApr}% against your most expensive balance. Paying that down first `
          + `beats clearing this before the date.`;
      }
      if (met) binding = false;

      const status: CommitmentStatus =
        met ? 'met'
        : shortfallMonthly === 0 ? 'on_track'
        : c.committedMonthly > 0 ? 'behind'
        : 'unfunded';

      return {
        ...c, remaining, monthsRemaining, requiredMonthly, shortfallMonthly,
        status, binding, notBindingReason,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label));
}

export interface CommitmentAllocation {
  /** Dollars per commitment id, this month. Only binding, under-funded floors appear. */
  reserved: Map<string, number>;
  totalReserved: number;
  /** What is left for the ranked surplus — the card paydown, in practice. */
  surplusRemaining: number;
  /**
   * FALSE when the binding floors do not fit in the money available.
   *
   * A caller must surface this. Under-funding quietly is the failure mode this module exists to
   * prevent: a plan that misses a deadline and a plan that meets it look identical on a dashboard
   * right up until the date.
   */
  feasible: boolean;
  /** How much more per month is needed for every binding floor to be met. */
  monthlyShortfall: number;
}

/**
 * Split this month's spare cash into "reserved against a date" and "free to attack debt".
 *
 * Binding floors are honoured in DUE-DATE order, soonest first: when the money does not stretch,
 * the deadline that cannot move is the one that gets paid. A non-binding floor is skipped
 * entirely — that is the point of having decided it was not worth honouring.
 *
 * Only the SHORTFALL is reserved, never the whole floor, because what the user already
 * contributes by standing order is already leaving their account. Reserving it twice would
 * double-count it and hide surplus that genuinely exists.
 */
export function allocateAgainstCommitments(
  surplus: number,
  plans: readonly CommitmentPlan[],
): CommitmentAllocation {
  const reserved = new Map<string, number>();
  let left = Math.max(0, surplus);
  let totalReserved = 0;
  let monthlyShortfall = 0;

  for (const p of plans) {
    if (!p.binding || p.shortfallMonthly <= 0) continue;
    const take = Math.min(left, p.shortfallMonthly);
    if (take > 0) {
      reserved.set(p.id, take);
      totalReserved += take;
      left -= take;
    }
    monthlyShortfall += p.shortfallMonthly - take;
  }

  return {
    reserved,
    totalReserved,
    surplusRemaining: left,
    feasible: monthlyShortfall === 0,
    monthlyShortfall,
  };
}
