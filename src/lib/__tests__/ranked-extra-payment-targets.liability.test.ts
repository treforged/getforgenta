// Liability targets: extra principal on a student loan / mortgage, as the allocator sees it.
//
// The gate is the point. `includeLiabilityTargets` is a SIBLING of `includeLoanTargets`, not the
// same flag, because a caller that can credit a vehicle loan has said nothing about whether it can
// credit anything else — and a target handed to a caller that cannot credit it takes cash out of
// checking and puts it nowhere.
//
// Would-fail check: default `includeLiabilityTargets` to true and case 1 hands liability targets
// to a caller that never asked; drop the `surplus_sort_order != null` filter and case 3 diverts
// surplus to a debt nobody ranked.

import { describe, it, expect } from 'vitest';
import {
  buildRankableLiabilities, buildRankedTargets, liabilityRemainingNeed,
  type RankableLiability,
} from '@/lib/ranked-extra-payment-targets';
import type { CarFund } from '@/lib/types';

const liability = (over: Partial<RankableLiability> = {}): RankableLiability => ({
  id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12000,
  surplus_sort_order: 2, surplus_share: null, created_at: '2026-01-01', ...over,
});

const base = {
  cards: [], carFunds: [] as CarFund[], goals: [],
  strategy: 'avalanche' as const, asOf: '2026-08-24',
};

const liabilityTargets = (t: ReturnType<typeof buildRankedTargets>) =>
  t.filter(x => x.kind === 'liability');

describe('buildRankedTargets — liability targets', () => {
  it('gives a caller that has not said it can credit one NOTHING', () => {
    expect(liabilityTargets(buildRankedTargets({ ...base, liabilities: [liability()] }))).toEqual([]);
    // Not even when the caller can credit a VEHICLE loan: that is a different projection.
    expect(liabilityTargets(buildRankedTargets({
      ...base, liabilities: [liability()], includeLoanTargets: true,
    }))).toEqual([]);
  });

  it('builds one when the caller opts in: rank from the column, capacity from the balance', () => {
    const t = liabilityTargets(buildRankedTargets({
      ...base, liabilities: [liability()], includeLiabilityTargets: true,
    }));
    expect(t).toEqual([{
      id: 'sl-1', kind: 'liability', sortOrder: 2,
      // Zero, like a goal: the scheduled payment is already a bill by the time surplus is computed.
      minimum: 0,
      capacity: 12000,
      autoExtra: true,
    }]);
  });

  it('skips a liability the user has not ranked, even with the flag on', () => {
    expect(liabilityTargets(buildRankedTargets({
      ...base, liabilities: [liability({ surplus_sort_order: null })], includeLiabilityTargets: true,
    }))).toEqual([]);
  });

  it('passes a positive split weight through and drops a useless one', () => {
    const withShare = liabilityTargets(buildRankedTargets({
      ...base, liabilities: [liability({ surplus_share: 30 })], includeLiabilityTargets: true,
    }));
    expect(withShare[0].share).toBe(30);
    const withZero = liabilityTargets(buildRankedTargets({
      ...base, liabilities: [liability({ surplus_share: 0 })], includeLiabilityTargets: true,
    }));
    expect(withZero[0].share).toBeUndefined();
  });
});

describe('liabilityRemainingNeed', () => {
  it('is the balance, and never negative or NaN capacity', () => {
    expect(liabilityRemainingNeed(liability({ balance: 250000 }))).toBe(250000);
    expect(liabilityRemainingNeed(liability({ balance: -5 }))).toBe(0);
    expect(liabilityRemainingNeed(liability({ balance: 0.001 }))).toBe(0);
    expect(liabilityRemainingNeed(liability({ balance: Number.NaN }))).toBe(0);
  });
});

describe('buildRankableLiabilities', () => {
  const accounts = [
    { id: 'sl', name: 'Student Loan', account_type: 'student_loan', balance: 12000, active: true, surplus_sort_order: 3, surplus_share: 40 },
    { id: 'mtg', name: 'Home Loan', account_type: 'mortgage', balance: 250000, active: true },
    { id: 'lonely', name: 'Unpaired Loan', account_type: 'student_loan', balance: 500, active: true },
    { id: 'closed', name: 'Old Loan', account_type: 'student_loan', balance: 900, active: false },
    { id: 'cc', name: 'Visa', account_type: 'credit_card', balance: 800, active: true },
    { id: 'auto', name: 'Car Loan', account_type: 'auto_loan', balance: 20000, active: true },
  ];
  const debts = [
    { name: 'Student Loan', balance: 1, apr: 6, target_payment: 300 },
    { name: 'Home Loan', balance: 1, apr: 6, target_payment: 1800 },
    { name: 'Old Loan', balance: 1, apr: 6, target_payment: 50 },
    { name: 'Visa', balance: 1, apr: 22, target_payment: 100 },
    { name: 'Car Loan', balance: 1, apr: 5, target_payment: 450 },
  ];

  it('keeps only paired, active, debt-serviced accounts and attaches their stored rank', () => {
    const rows = buildRankableLiabilities({ accounts, debts, rules: [] });
    // `auto` is here since 2026-08-27: an `auto_loan` NO car fund claims is an ordinary debt on
    // this side — its payment leaves cash here, so extra principal can be ranked against it here
    // too. A claimed one is dropped by `excludedAccountIds`, the case below.
    expect(rows.map(r => r.id)).toEqual(['sl', 'mtg', 'auto']);
    expect(rows[0]).toMatchObject({ balance: 12000, surplus_sort_order: 3, surplus_share: 40 });
    // Never ranked ⇒ null, which is what keeps it out of the target list entirely.
    expect(rows[1].surplus_sort_order).toBeNull();
  });

  it('drops an account a vehicle loan is linked to — the car fund carries that one', () => {
    const rows = buildRankableLiabilities({
      accounts, debts, rules: [], excludedAccountIds: new Set(['auto']),
    });
    expect(rows.map(r => r.id)).toEqual(['sl', 'mtg']);
  });

  it('still lists a debt an expense rule pays: the rule is the cash side, not the debt going away', () => {
    const rows = buildRankableLiabilities({
      accounts, debts, rules: [{ name: 'student loan', rule_type: 'expense', active: true }],
    });
    expect(rows.map(r => r.id)).toEqual(['sl', 'mtg', 'auto']);
  });
});
