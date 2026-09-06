// A 0% TRANCHE IS NOT A FREE TRANCHE, AND THE ENGINE USED TO SAY IT WAS.
//
// ⚠️ WHERE THE DEFECT ACTUALLY WAS, which is not where the queue said. `monthly_fee` has existed on
// `BalanceTranche` for a while, is parsed, is normalised, has its own test file, and
// `trancheInterestBreakdown` computes a per-tranche `monthlyFee`, a `monthlyCost` and a
// `totalMonthlyCost`. All of it was correct. `credit-card-engine.ts` then read `monthlyInterest`
// and `totalMonthlyInterest` and THREW THE FEE AWAY at the boundary — computed, tested, discarded.
//
// ⚠️ AND THE 2026-09-05 CALLER SWEEP MISSED IT BECAUSE IT GREPPED THE WRONG WORD. It searched for
// `payOverTime` / `pay_over_time`, found nothing, and recorded the item as "not started". The
// feature is called `monthly_fee`. A caller-grep is only as good as the symbol you grep for.
//
// THE REAL NUMBERS, from three Chase Pay Over Time confirmation emails (2026-09-05):
//   PayPal Zettle  $1,322.50 principal + $166.20 fees, 12 × $124.06
//   Costco           $368.89 principal +  $55.92 fees
//   Carnival         $410.00 principal +  $62.28 fees
// $284.40 across three plans — 13.5% of principal — invisible to the forecast, because `apr: 0`
// reads as costless.

import { describe, it, expect } from 'vitest';
import { trancheInterestFor } from '@/lib/credit-card-engine';
import type { BalanceTranche } from '@/lib/balance-tranches';

const card = (tranches: BalanceTranche[], apr = 27.49) =>
  ({ id: 'prime-visa', apr, tranches } as Parameters<typeof trancheInterestFor>[0]);

const plan = (over: Partial<BalanceTranche>): BalanceTranche => ({
  id: 'p', label: 'Plan', balance: 1000, apr: 0,
  promo_end_date: '2027-09-07', min_payment: null, monthly_fee: null, fixed_term: true,
  ...over,
});

const ASOF = '2026-09-06';

describe('the engine charges a Pay Over Time fee', () => {
  it('⚠️ a 0% plan with a fee is NOT free — the whole defect, in one number', () => {
    // $166.20 over twelve months is $13.85 a month. Before 2026-09-06 this returned 0.00.
    const t = plan({ balance: 1322.50, monthly_fee: 166.20 / 12 });
    const { total, lineInterest } = trancheInterestFor(card([t]), [1322.50], 1322.50, ASOF);
    expect(total).toBeCloseTo(13.85, 2);
    expect(lineInterest[0]).toBeCloseTo(13.85, 2);
  });

  it('⚠️ all three of his real plans, to the cent', () => {
    const tranches = [
      plan({ id: 'z', label: 'PayPal Zettle', balance: 1322.50, monthly_fee: 166.20 / 12 }),
      plan({ id: 'c', label: 'Costco', balance: 368.89, monthly_fee: 55.92 / 12 }),
      plan({ id: 'v', label: 'Carnival', balance: 410.00, monthly_fee: 62.28 / 12 }),
    ];
    const bal = 1322.50 + 368.89 + 410.00;
    const { total } = trancheInterestFor(card(tranches), [1322.50, 368.89, 410.00], bal, ASOF);
    // $284.40 a year is $23.70 a month, and none of it was visible before.
    expect(total).toBeCloseTo(284.40 / 12, 2);
  });

  it('adds the fee ON TOP of interest when a tranche has both', () => {
    // A fee is not a rate and never replaces one — a plan can charge both.
    const t = plan({ balance: 1200, apr: 12, monthly_fee: 5 });
    const { total } = trancheInterestFor(card([t]), [1200], 1200, ASOF);
    expect(total).toBeCloseTo(1200 * 0.12 / 12 + 5, 2);
  });

  it('⚠️ PARITY: a tranche with NO fee returns exactly what it always did', () => {
    // The rule at the top of balance-tranches.ts. `monthlyCost` equals `monthlyInterest` when the
    // fee is absent, so nothing without a fee may move by a cent.
    const t = plan({ balance: 1000, apr: 7.99, monthly_fee: null, promo_end_date: null });
    const { total, lineInterest } = trancheInterestFor(card([t]), [1000], 1000, ASOF);
    expect(total).toBeCloseTo(1000 * 0.0799 / 12, 2);
    expect(lineInterest[0]).toBeCloseTo(1000 * 0.0799 / 12, 2);
  });

  it('⚠️ PARITY: a card with NO tranches is untouched', () => {
    const { total } = trancheInterestFor(card([]), [], 5000, ASOF);
    expect(total).toBeCloseTo(5000 * 0.2749 / 12, 2);
  });

  it('⚠️ the fee STOPS when the plan does, exactly as the minimum does', () => {
    // Past promo_end_date the balance is ordinary money at the standard rate with no plan left to
    // charge for. Charging a fee for a finished plan would be inventing a cost.
    const t = plan({ balance: 1000, monthly_fee: 20, promo_end_date: '2026-01-01' });
    const { total } = trancheInterestFor(card([t]), [1000], 1000, ASOF);
    expect(total).toBeCloseTo(1000 * 0.2749 / 12, 2);
  });

  it('charges nothing at all on a cleared card', () => {
    const t = plan({ balance: 1000, monthly_fee: 20 });
    expect(trancheInterestFor(card([t]), [0], 0, ASOF).total).toBe(0);
  });
});
