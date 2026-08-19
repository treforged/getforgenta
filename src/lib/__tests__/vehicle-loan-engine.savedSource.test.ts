import { describe, it, expect } from 'vitest';
import { getCarFundSaved, getCarFundEarmark, resolveCarFundEarmark } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Finding §2.10. `current_saved` is typed by the user; the account balance is reported by the bank,
// and nothing kept them consistent — §2.9 made that drift visible, this makes it impossible to
// create. `account_percent` is self-limiting: a percentage of a balance can never exceed it.
//
// The load-bearing claim of this file is the FIRST block: under 'fixed' (every pre-§2.10 row, the
// whole golden fixture, and both demo vehicles) getCarFundSaved returns exactly what each of the
// ten call sites computed inline before. §2.10 therefore moves no existing cash figure.

const makeCarFund = (o: Partial<CarFund> = {}): CarFund => ({
  id: 'car-1', user_id: 'u1', created_at: '2026-01-01', vehicle_name: 'Test Car',
  target_price: 0, tax_fees: 0, down_payment_goal: 7700, current_saved: 1084.53,
  saved_source: 'fixed', saved_percent: 0, sort_order: 0, auto_extra: false,
  monthly_insurance: 0, expected_apr: 6, loan_term_months: 60, phase: 'saving',
  loan_amount: 0, loan_start_date: null, payment_start_date: null, interest_start_date: null,
  insurance_start_date: null, actual_monthly_payment: 0, linked_account: null, linked_rule_id: null,
  loan_payment_account: null, linked_loan_account_id: null, planned_purchase_date: null, gift_contribution: 6700,
  lump_sum_payments: [], ...o,
});

describe("getCarFundSaved — 'fixed' reproduces every pre-§2.10 call site exactly", () => {
  // The nine derived sites all computed: linkedAcct(separate) ? balance : current_saved.
  const oldDerivedExpression = (cf: CarFund, fundingId: string | null, bal: number | null) =>
    cf.linked_account && cf.linked_account !== fundingId && bal != null ? bal : Number(cf.current_saved);

  const cases: Array<[string, Partial<CarFund>, string | null, number | null]> = [
    ['unlinked', { linked_account: null }, 'fund-acct', null],
    ['linked to a separate account', { linked_account: 'hys' }, 'fund-acct', 5000],
    ['linked to a separate account holding $0', { linked_account: 'hys' }, 'fund-acct', 0],
    ['linked to the funding account itself', { linked_account: 'fund-acct' }, 'fund-acct', 2800],
    ['linked but no funding account resolved', { linked_account: 'hys' }, null, 5000],
    ['linked to an account the caller could not resolve', { linked_account: 'gone' }, 'fund-acct', null],
  ];

  it.each(cases)('%s', (_label, patch, fundingId, bal) => {
    const cf = makeCarFund(patch);
    expect(getCarFundSaved(cf, fundingId, bal)).toBe(oldDerivedExpression(cf, fundingId, bal));
  });

  it('a $0 linked balance is honored, not mistaken for "unresolved"', () => {
    const cf = makeCarFund({ linked_account: 'hys' });
    expect(getCarFundSaved(cf, 'fund-acct', 0)).toBe(0);
    // ...whereas a genuinely unresolved account falls through to the typed figure.
    expect(getCarFundSaved(cf, 'fund-acct', null)).toBe(1084.53);
  });
});

describe("getCarFundSaved — 'account_percent'", () => {
  it('takes the percentage of the linked balance, ignoring current_saved', () => {
    const cf = makeCarFund({
      linked_account: 'chk', saved_source: 'account_percent', saved_percent: 40, current_saved: 99999,
    });
    expect(getCarFundSaved(cf, 'chk', 2800)).toBeCloseTo(1120, 6);
  });

  it('applies to the funding account too — the case §2.9 drift actually lives in', () => {
    const cf = makeCarFund({
      linked_account: 'chk', saved_source: 'account_percent', saved_percent: 25,
    });
    // Same account id as the funding account: the separate-account branch does NOT fire, but the
    // explicit percentage still does, because the user declared it.
    expect(getCarFundSaved(cf, 'chk', 2800)).toBeCloseTo(700, 6);
  });

  it('can never exceed the balance, so §2.9 shortfall is structurally impossible', () => {
    for (const pct of [0, 1, 33.3, 50, 99.9, 100]) {
      for (const bal of [0, 0.01, 943.44, 2800, 99999]) {
        const cf = makeCarFund({
          linked_account: 'chk', saved_source: 'account_percent', saved_percent: pct,
        });
        expect(getCarFundSaved(cf, 'chk', bal)).toBeLessThanOrEqual(bal);
      }
    }
  });

  it('clamps an out-of-range percent rather than inventing money', () => {
    const over = makeCarFund({ linked_account: 'chk', saved_source: 'account_percent', saved_percent: 150 });
    expect(getCarFundSaved(over, 'chk', 2800)).toBe(2800);
    const under = makeCarFund({ linked_account: 'chk', saved_source: 'account_percent', saved_percent: -20 });
    expect(getCarFundSaved(under, 'chk', 2800)).toBe(0);
  });

  it('treats a negative balance as zero saved, never as negative savings', () => {
    const cf = makeCarFund({ linked_account: 'chk', saved_source: 'account_percent', saved_percent: 50 });
    expect(getCarFundSaved(cf, 'chk', -500)).toBe(0);
  });

  it('falls back to current_saved when the balance is unresolved', () => {
    const cf = makeCarFund({ linked_account: 'chk', saved_source: 'account_percent', saved_percent: 50 });
    expect(getCarFundSaved(cf, 'chk', null)).toBe(1084.53);
  });
});

describe('the earmark consumes the helper', () => {
  it('earmarks the derived percentage, not the typed figure', () => {
    const cf = makeCarFund({
      linked_account: 'fund-acct', saved_source: 'account_percent', saved_percent: 50,
      down_payment_goal: 5600, gift_contribution: 0, current_saved: 3200,
    });
    // 50% of 2800 = 1400, well under the 5600 own-cash need, so the earmark is the derived figure.
    expect(getCarFundEarmark([cf], 'fund-acct', 2800)).toBeCloseTo(1400, 6);
  });

  it('produces NO shortfall in percent mode, where fixed mode produced one', () => {
    const shared = {
      linked_account: 'fund-acct', down_payment_goal: 5600, gift_contribution: 0, current_saved: 3200,
    } as const;
    // §2.9's shape: $3,200 claimed against a $2,800 balance.
    expect(resolveCarFundEarmark([makeCarFund(shared)], 'fund-acct', 2800).shortfall).toBeCloseTo(400, 6);
    // Same fund, percent mode: nothing to be short of.
    const pct = makeCarFund({ ...shared, saved_source: 'account_percent', saved_percent: 100 });
    expect(resolveCarFundEarmark([pct], 'fund-acct', 2800)).toEqual({
      requested: 2800, applied: 2800, shortfall: 0,
    });
  });

  it('still ignores funds linked to a separate account', () => {
    const cf = makeCarFund({
      linked_account: 'hys', saved_source: 'account_percent', saved_percent: 100,
      down_payment_goal: 5600, gift_contribution: 0,
    });
    expect(getCarFundEarmark([cf], 'fund-acct', 2800)).toBe(0);
  });

  it('is still phase-gated: an activated loan earmarks nothing', () => {
    const cf = makeCarFund({
      phase: 'loan', linked_account: 'fund-acct', saved_source: 'account_percent', saved_percent: 100,
    });
    expect(getCarFundEarmark([cf], 'fund-acct', 2800)).toBe(0);
  });

  it('omitting the balance argument leaves fixed-mode callers unchanged', () => {
    const cf = makeCarFund({ linked_account: 'fund-acct', down_payment_goal: 7700, gift_contribution: 6700 });
    expect(getCarFundEarmark([cf], 'fund-acct')).toBeCloseTo(1000, 6); // min(1084.53, 1000)
  });
});
