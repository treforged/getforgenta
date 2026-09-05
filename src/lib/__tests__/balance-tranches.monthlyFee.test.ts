/**
 * A 0% TRANCHE IS NOT A FREE TRANCHE — Chase Pay Over Time, and the $284.40 nobody could see.
 *
 * Every one of Tre's Prime Visa tranches is a Chase Pay Over Time plan, which charges a FIXED
 * MONTHLY FEE instead of interest. Stored with `apr: 0` and no fee field, the app reported them
 * as costing nothing at all.
 *
 * The numbers below are his three real plan-confirmation emails, and the arithmetic in them is
 * what proves the charge is a FEE rather than hidden interest: each plan's monthly payment times
 * twelve equals principal plus fees to within two cents. A rate would not divide that evenly.
 *
 *   PayPal Zettle  $1,322.50 + $166.20 fees = $1,488.70   vs  12 × $124.06 = $1,488.72
 *   Costco           $368.89 +  $55.92      =   $424.81   vs  12 ×  $35.41 =   $424.92
 *   Carnival         $410.00 +  $62.28      =   $472.28   vs  12 ×  $39.36 =   $472.32
 *
 * ⚠️ THE NO-OP CASE IS THE MOST IMPORTANT ONE. A card with no fee-bearing plan — which is most
 * cards — must be byte-identical to before this field existed, or shipping it moves every
 * interest figure in the app.
 *
 * Would-fail checks: fold the fee into `monthlyInterest` and the "reported separately" case
 * fails, which is the thing that would stop a UI explaining why a 0% tranche costs anything;
 * drop the promo-end condition in `feeAsOf` and the expired case keeps charging for a plan that
 * has finished.
 */
import { describe, it, expect } from 'vitest';
import {
  trancheInterestBreakdown, parseTranches, feeAsOf, trancheMinimumAsOf,
  type BalanceTranche,
} from '@/lib/balance-tranches';

const STANDARD_APR = 27.49;

/** One of his Pay Over Time plans: 0% stated, a real monthly fee, ending twelve months out. */
const plan = (over: Partial<BalanceTranche> = {}): BalanceTranche => ({
  id: 't1', label: 'Pay Over Time — PayPal Zettle', balance: 1322.50, apr: 0,
  promo_end_date: '2027-09-07', min_payment: 110.21, monthly_fee: 13.85,
  ...over,
});

describe('a flat monthly fee on a tranche', () => {
  it('costs real money on a 0% plan, where interest reports zero', () => {
    const { lines, totalMonthlyInterest, totalMonthlyFees, totalMonthlyCost } =
      trancheInterestBreakdown(1322.50, [plan()], STANDARD_APR, '2026-09-05');

    expect(lines).toHaveLength(1);
    // The old answer, and it is still true — this plan accrues no interest.
    expect(totalMonthlyInterest).toBe(0);
    // The new answer, and it is the one a user must be shown.
    expect(totalMonthlyFees).toBeCloseTo(13.85, 2);
    expect(totalMonthlyCost).toBeCloseTo(13.85, 2);
  });

  it('reports the fee SEPARATELY from interest, not folded into it', () => {
    // Interest shrinks as a balance does; a plan fee does not. A UI that added them could not
    // explain why a 0% tranche costs anything at all.
    const { lines } = trancheInterestBreakdown(1322.50, [plan()], STANDARD_APR, '2026-09-05');
    expect(lines[0].monthlyInterest).toBe(0);
    expect(lines[0].monthlyFee).toBeCloseTo(13.85, 2);
    expect(lines[0].monthlyCost).toBeCloseTo(13.85, 2);
  });

  it('adds the fee ON TOP of interest when a tranche has both', () => {
    const interestBearing = plan({ apr: 12, monthly_fee: 5 });
    const { lines, totalMonthlyCost } =
      trancheInterestBreakdown(1322.50, [interestBearing], STANDARD_APR, '2026-09-05');

    const expectedInterest = 1322.50 * 0.12 / 12;
    expect(lines[0].monthlyInterest).toBeCloseTo(expectedInterest, 2);
    expect(totalMonthlyCost).toBeCloseTo(expectedInterest + 5, 2);
  });

  it('sums his three real plans to the fees the emails state', () => {
    // The three that are MISSING from his stored tranches, priced as they actually are.
    const tranches: BalanceTranche[] = [
      plan({ id: 'z', label: 'PayPal Zettle', balance: 1322.50, monthly_fee: 166.20 / 12 }),
      plan({ id: 'c', label: 'Costco', balance: 368.89, monthly_fee: 55.92 / 12 }),
      plan({ id: 'v', label: 'Carnival', balance: 410.00, monthly_fee: 62.28 / 12 }),
    ];
    const total = 1322.50 + 368.89 + 410.00;
    const { totalMonthlyFees, totalMonthlyInterest } =
      trancheInterestBreakdown(total, tranches, STANDARD_APR, '2026-09-05');

    expect(totalMonthlyInterest).toBe(0);
    // $284.40 a year, which is what the forecast could not see.
    expect(totalMonthlyFees * 12).toBeCloseTo(284.40, 2);
  });

  it('stops charging once the plan has ended, exactly when the instalment does', () => {
    const expired = plan({ promo_end_date: '2026-01-07' });
    // The two must agree: a card charged for a plan with no schedule left, or given a schedule
    // it is not paying for, is a card whose payoff maths has drifted from its cost maths.
    expect(feeAsOf(expired, '2026-09-05')).toBe(0);
    expect(trancheMinimumAsOf(expired, '2026-09-05')).toBe(0);

    // Still running, on the last day.
    expect(feeAsOf(plan({ promo_end_date: '2026-09-05' }), '2026-09-05')).toBeCloseTo(13.85, 2);
  });
});

describe('no fee means nothing changes — the case that lets this ship', () => {
  it('is byte-identical for an ordinary interest-bearing tranche', () => {
    const ordinary: BalanceTranche = {
      id: 'bt', label: 'Balance transfer', balance: 2417, apr: 0,
      promo_end_date: '2027-05-11', min_payment: null,
    };
    const { totalMonthlyInterest, totalMonthlyFees, totalMonthlyCost } =
      trancheInterestBreakdown(4318, [ordinary], STANDARD_APR, '2026-09-05');

    // The untranched remainder still carries the standard rate, and nothing else moved.
    const expectedRemainderInterest = (4318 - 2417) * (STANDARD_APR / 100) / 12;
    expect(totalMonthlyInterest).toBeCloseTo(expectedRemainderInterest, 2);
    expect(totalMonthlyFees).toBe(0);
    expect(totalMonthlyCost).toBeCloseTo(totalMonthlyInterest, 2);
  });

  it('treats zero, negative and unparseable fees as absent rather than correcting them', () => {
    const parsed = parseTranches([
      { id: 'a', label: 'A', balance: 100, apr: 0, monthly_fee: 0 },
      { id: 'b', label: 'B', balance: 100, apr: 0, monthly_fee: -5 },
      { id: 'c', label: 'C', balance: 100, apr: 0, monthly_fee: 'not a number' },
      { id: 'd', label: 'D', balance: 100, apr: 0 },
    ]);
    expect(parsed.map(t => t.monthly_fee)).toEqual([null, null, null, null]);
  });

  it('parses a real fee off a stored row, including a numeric string from Postgres', () => {
    const parsed = parseTranches([
      { id: 'a', label: 'A', balance: 100, apr: 0, monthly_fee: '13.85' },
    ]);
    expect(parsed[0].monthly_fee).toBeCloseTo(13.85, 2);
  });
});

// ── A FIXED-TERM PLAN CANNOT BE PREPAID, AND THAT MOVES THE PAYOFF DATE ───────────────────────
//
// The fee is the cheaper half of the Pay Over Time problem. This is the half that changes the
// projection: Chase applies a payment by ALLOCATION RULES — the minimum to the LOWEST APR
// balance, any surplus to the HIGHEST. So a cardholder carrying 27.49% revolving debt CANNOT
// choose to prepay a 0% plan; the expensive balance takes every extra dollar whether they want
// that or not, and the plan runs its full term.
//
// Without the flag the engine treats a 0% tranche as accelerable and projects a payoff date the
// card will not honour. Tre's four Prime Visa tranches are all of this kind.
//
// Would-fail check: drop the `!b.fixedTerm` filter from pass 2 and the first case below fails —
// the surplus lands on the 0% plan instead of the 27.49% remainder, which is the projection the
// card refuses to produce.
import { splitPaymentAcrossTranches, type TranchePayable } from '@/lib/balance-tranches';

describe('a fixed-term tranche takes its instalment and not one dollar more', () => {
  /** His shape: a 0% plan on its schedule, alongside expensive revolving money. */
  const planBucket: TranchePayable = {
    id: 'pay-over-time', apr: 0, balance: 3561.65,
    minPayment: 323.79, promoEndDate: '2027-07-07', fixedTerm: true,
  };
  const revolving: TranchePayable = {
    id: 'remainder', apr: 27.49, balance: 3123.46, minPayment: 0, promoEndDate: null,
  };

  it('routes the surplus PAST the 0% plan to the 27.49% balance', () => {
    // $1,000 against a $323.79 instalment leaves $676.21 of surplus.
    const split = splitPaymentAcrossTranches(1000, [planBucket, revolving]);

    expect(split.get('pay-over-time')).toBeCloseTo(323.79, 2);
    expect(split.get('remainder')).toBeCloseTo(676.21, 2);
    // Every dollar is placed; nothing is lost between the passes.
    expect((split.get('pay-over-time') ?? 0) + (split.get('remainder') ?? 0)).toBeCloseTo(1000, 2);
  });

  it('still pays the instalment in full when there is nothing spare', () => {
    const split = splitPaymentAcrossTranches(323.79, [planBucket, revolving]);
    expect(split.get('pay-over-time')).toBeCloseTo(323.79, 2);
    expect(split.get('remainder') ?? 0).toBeCloseTo(0, 2);
  });

  it('leaves an ACCELERABLE tranche accelerable — the flag only ever removes', () => {
    // Same bucket without the flag: once the expensive balance is clear the surplus may land on
    // it, which is correct for an ordinary promo balance with no allocation rule attached.
    const accelerable: TranchePayable = { ...planBucket, fixedTerm: false };
    const split = splitPaymentAcrossTranches(5000, [accelerable, revolving]);

    expect(split.get('remainder')).toBeCloseTo(3123.46, 2);
    // $5,000 - $3,123.46 = $1,876.54, all of which the plan can absorb.
    expect(split.get('pay-over-time')).toBeCloseTo(1876.54, 2);
  });

  it('caps a fixed-term tranche at its instalment even with money to burn', () => {
    // $9,000 covers both balances entirely. The plan still takes only its $323.79 -- the rest
    // has nowhere to go but the revolving balance, and then stops.
    const split = splitPaymentAcrossTranches(9000, [planBucket, revolving]);
    expect(split.get('pay-over-time')).toBeCloseTo(323.79, 2);
    expect(split.get('remainder')).toBeCloseTo(3123.46, 2);
  });
});
