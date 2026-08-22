// The automatic cash floor, per month.
//
// The defect this replaces: automatic resolved the floor to 0, so the engine drained to bare
// pre-paycheck bills while the forecast judged the result against bills PLUS card minimums PLUS
// vehicle-loan payments. A plan that spends down to one line and is measured against a higher one
// breaches by construction — on Tre's real data it projected cash going NEGATIVE in Apr 2028.
//
// Would-fail check: make `automaticFloorComponents` return 0 unconditionally and every test in the
// first block below fails while the manual-mode tests stay green.

import { describe, it, expect } from 'vitest';
import { automaticFloorComponents, committedMonthlyOutflows, type FloorCard } from '../auto-cash-floor';
import { getMinSafeCash } from '../pay-schedule';
import type { CarFund } from '../types';
import type { PayScheduleConfig } from '../pay-schedule';

const AUG = new Date(2026, 7, 15);

const card = (over: Partial<FloorCard> = {}): FloorCard =>
  ({ account_type: 'credit_card', active: true, min_payment: 250, ...over });

const loanFund = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'c5', vehicle_name: 'C5', phase: 'loan', loan_amount: 16_530, expected_apr: 10.18,
  loan_term_months: 48, actual_monthly_payment: 422.89, payment_start_date: '2026-08-07',
  loan_start_date: '2026-08-07', interest_start_date: '2026-08-07', lump_sum_payments: [],
  ...over,
} as unknown as CarFund);

describe('committedMonthlyOutflows — every term traces to a row', () => {
  it('sums the contractual minimums of active credit cards', () => {
    expect(committedMonthlyOutflows([card({ min_payment: 559.4 }), card({ min_payment: 249 })], [], AUG))
      .toBeCloseTo(808.4, 2);
  });

  it('ignores a closed card, a non-card account, and a card with no stored minimum', () => {
    expect(committedMonthlyOutflows([
      card({ active: false, min_payment: 999 }),
      card({ account_type: 'checking', min_payment: 999 }),
      card({ min_payment: null }),
      card({ min_payment: 0 }),
    ], [], AUG)).toBe(0);
  });

  it('guesses nothing for a card whose minimum is unusable', () => {
    expect(committedMonthlyOutflows([card({ min_payment: 'abc' })], [], AUG)).toBe(0);
  });

  it('does NOT add the vehicle-loan payment — it is already out of cash before the floor is read', () => {
    // Including it made a car fund's ACTIVATION raise the floor by one payment, which
    // `useCardProjection.carLoanActivationDiscontinuity` exists to forbid: activation must be a
    // cash no-op. `getAugmentedMinSafeCash` counts loans only behind `isCapturedInBalance`, and
    // re-deriving that gating here would be a second copy of a rule already unified once.
    expect(committedMonthlyOutflows([], [loanFund()], AUG)).toBe(0);
    expect(committedMonthlyOutflows([card({ min_payment: 300 })], [loanFund()], AUG)).toBe(300);
  });

  it('is zero for a user with no cards and no loans', () => {
    expect(committedMonthlyOutflows([], [], AUG)).toBe(0);
  });
});

describe('automaticFloorComponents — BOTH modes get the committed outflows', () => {
  // Tre, 2026-08-21: "i want manual users to get the same fix". A month owes its minimums and its
  // loan payment whoever chose the floor; leaving them out for manual users left them with the same
  // drain-vs-yardstick asymmetry that made automatic project negative cash.
  it('is the same figure in manual and automatic mode', () => {
    const expected = committedMonthlyOutflows([card()], [], AUG);
    expect(automaticFloorComponents(true, [card()], [], AUG)).toBeCloseTo(expected, 2);
    expect(automaticFloorComponents(false, [card()], [], AUG)).toBeCloseTo(expected, 2);
  });

  it('leaves the MODES differing only on the floor itself, not on these components', () => {
    // manual  => max(their number, bills + committed)
    // automatic => bills + committed
    // Pinned in getMinSafeCash below; here we only assert the components are mode-blind.
    expect(automaticFloorComponents(true, [], [], AUG)).toBe(automaticFloorComponents(false, [], [], AUG));
  });
});

describe('getMinSafeCash — the committed term is ADDED, never maxed', () => {
  const config = { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' } as PayScheduleConfig;
  const rules: Parameters<typeof getMinSafeCash>[0] = [];

  it('is unchanged when the caller passes nothing — every pre-existing call site', () => {
    expect(getMinSafeCash(rules, config, 2_500, null, AUG))
      .toBe(getMinSafeCash(rules, config, 2_500, null, AUG, 0));
  });

  it('adds the committed outflows on top of the bills rather than taking the larger', () => {
    // A month owes its bills AND its minimums. Maxing would under-reserve by the smaller of the two,
    // which is precisely how the engine drained below the line it was judged against.
    const floor = getMinSafeCash(rules, config, 0, null, AUG, 800);
    expect(floor).toBe(800);
  });

  it('still honours a manual floor that exceeds the sum', () => {
    expect(getMinSafeCash(rules, config, 2_500, null, AUG, 800)).toBe(2_500);
  });

  it('never lets a negative committed figure lower the floor', () => {
    expect(getMinSafeCash(rules, config, 0, null, AUG, -5_000)).toBe(0);
  });
});
