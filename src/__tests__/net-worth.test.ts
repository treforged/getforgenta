import { describe, it, expect } from 'vitest';
import {
  aggregateNetWorth,
  buildNetWorthBreakdown,
  isLiabilityAccountType,
  nonCardLiabilityTotal,
  sharesDistinctiveToken,
  totalsFromBreakdown,
  type NetWorthAccount,
} from '@/lib/net-worth';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import type { CarFund } from '@/lib/types';

const account = (over: Partial<NetWorthAccount> = {}): NetWorthAccount => ({
  name: 'Checking',
  account_type: 'checking',
  balance: 1000,
  active: true,
  ...over,
});

describe('isLiabilityAccountType', () => {
  it('covers every liability account type the app can create', () => {
    for (const type of ['credit_card', 'mortgage', 'student_loan', 'auto_loan', 'other_liability']) {
      expect(isLiabilityAccountType(type)).toBe(true);
    }
  });

  it('treats asset and unmapped types as non-liabilities', () => {
    for (const type of ['checking', 'hsa', 'ira', 'other_asset', 'something_new']) {
      expect(isLiabilityAccountType(type)).toBe(false);
    }
  });
});

describe('aggregateNetWorth', () => {
  it('subtracts loan accounts instead of counting them as assets', () => {
    // The old snapshot rule counted only credit cards, so this auto loan was
    // *added* to net worth: 2000 + 12000 = 14000 instead of 2000 - 12000.
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 2000 }),
        account({ name: 'Chevy Loan', account_type: 'auto_loan', balance: 12000 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 2000, totalLiabilities: 12000, netWorth: -10000 });
  });

  it('counts a mortgage, which the Dashboard tile used to omit', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 5000 }),
        account({ name: 'Home Loan', account_type: 'mortgage', balance: 250000 }),
      ],
      [],
      [],
    );
    expect(totals.totalLiabilities).toBe(250000);
    expect(totals.netWorth).toBe(-245000);
  });

  it('treats credit cards as liabilities and every other type as an asset', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', account_type: 'checking', balance: 2000 }),
        account({ name: 'Brokerage', account_type: 'investment', balance: 5000 }),
        account({ name: 'Amex', account_type: 'credit_card', balance: 1500 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 7000, totalLiabilities: 1500, netWorth: 5500 });
  });

  it('ignores inactive accounts on both sides', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Old Savings', balance: 900, active: false }),
        account({ name: 'Closed Card', account_type: 'credit_card', balance: 400, active: false }),
        account({ name: 'Checking', balance: 100 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 100, totalLiabilities: 0, netWorth: 100 });
  });

  it('adds manual assets and liabilities to the live totals', () => {
    const totals = aggregateNetWorth(
      [account({ name: 'Checking', balance: 1000 })],
      [{ name: 'Car', value: 12000 }],
      [{ name: 'Student Loan', balance: 8000 }],
    );
    expect(totals).toEqual({ totalAssets: 13000, totalLiabilities: 8000, netWorth: 5000 });
  });

  it('drops manual rows whose name duplicates a live account, case-insensitively', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 1000 }),
        account({ name: 'Amex', account_type: 'credit_card', balance: 500 }),
      ],
      [{ name: 'CHECKING', value: 999999 }],
      [{ name: 'amex', balance: 999999 }],
    );
    expect(totals).toEqual({ totalAssets: 1000, totalLiabilities: 500, netWorth: 500 });
  });

  it('coerces string balances coming back from Postgres numerics', () => {
    const totals = aggregateNetWorth(
      [account({ name: 'Checking', balance: '1500.50' })],
      [{ name: 'Car', value: '2000.25' }],
      [{ name: 'Loan', balance: '500.75' }],
    );
    expect(totals.totalAssets).toBeCloseTo(3500.75, 6);
    expect(totals.totalLiabilities).toBeCloseTo(500.75, 6);
    expect(totals.netWorth).toBeCloseTo(3000, 6);
  });

  it('returns zeroes when there is nothing to aggregate', () => {
    expect(aggregateNetWorth([], [], [])).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
  });
});

describe('buildNetWorthBreakdown', () => {
  const accounts = [
    account({ id: 'a1', name: 'Checking', balance: 2000 }),
    account({ id: 'a2', name: 'HSA', account_type: 'hsa', balance: 500 }),
    account({ id: 'a3', name: 'Discover', account_type: 'credit_card', balance: 4000 }),
    account({ id: 'a4', name: 'Chevy Loan', account_type: 'auto_loan', balance: 12000 }),
    account({ id: 'a5', name: 'Closed', balance: 99, active: false }),
  ];
  const manualAssets = [{ id: 'm1', name: 'Coin Collection', type: 'Other', value: 300 }];
  const manualLiabilities = [{ id: 'm2', name: 'Family Loan', type: 'Personal Loan', balance: 700 }];

  it('itemises exactly the rows the totals are made of', () => {
    const breakdown = buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities);
    expect(breakdown.assets.map(a => a.name)).toEqual(['Checking', 'HSA', 'Coin Collection']);
    expect(breakdown.liabilities.map(l => l.name)).toEqual(['Discover', 'Chevy Loan', 'Family Loan']);
    expect(totalsFromBreakdown(breakdown)).toEqual(
      aggregateNetWorth(accounts, manualAssets, manualLiabilities),
    );
  });

  it('labels rows by account-type group and namespaces ids by source', () => {
    const { assets, liabilities } = buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities);
    expect(assets[1]).toMatchObject({ id: 'live:a2', type: 'Retirement', isLive: true });
    expect(assets[2]).toMatchObject({ id: 'manual:m1', type: 'Other', isLive: false });
    expect(liabilities[1]).toMatchObject({ id: 'live:a4', type: 'Auto Loan', isLive: true });
    expect(liabilities[2]).toMatchObject({ id: 'manual:m2', type: 'Personal Loan', isLive: false });
  });
});

describe('sharesDistinctiveToken', () => {
  it('matches the account and car-fund names for the same vehicle', () => {
    expect(sharesDistinctiveToken('Auto Loan — RAV4', 'Toyota RAV4 (Owned)')).toBe(true);
    expect(sharesDistinctiveToken('Chevy Loan', '2026 Chevy Silverado')).toBe(true);
  });

  it('does not match two different vehicles', () => {
    expect(sharesDistinctiveToken('Auto Loan — RAV4', '2024 Honda Civic')).toBe(false);
  });

  it('never matches on filler words alone', () => {
    // Both reduce to no distinctive tokens but for the model names.
    expect(sharesDistinctiveToken('Auto Loan', 'Car Loan Payment')).toBe(false);
  });

  it('never matches on a shared model year alone', () => {
    // "2024" carries no identity — these are different cars.
    expect(sharesDistinctiveToken('Auto Loan — 2024 Toyota', '2024 Honda Civic')).toBe(false);
  });
});

describe('buildNetWorthBreakdown — vehicle loans', () => {
  const vehicle = {
    carFundId: 'cf1', vehicleName: 'Toyota RAV4 (Owned)', remainingBalance: 27110,
    linkedLoanAccountId: null,
  };

  it('counts a financed car that has no account row', () => {
    // Tre's real case: the loan lives only in car_funds, so net worth used to
    // omit it entirely.
    const breakdown = buildNetWorthBreakdown(
      [account({ id: 'a1', name: 'Checking', balance: 2000 })],
      [],
      [],
      [vehicle],
    );
    expect(breakdown.liabilities).toEqual([
      { id: 'vehicle:cf1', name: 'Toyota RAV4 (Owned)', type: 'Auto Loan', balance: 27110, isLive: true },
    ]);
    expect(totalsFromBreakdown(breakdown).netWorth).toBe(2000 - 27110);
  });

  it('lets the account row win so one vehicle is never counted twice', () => {
    // The demo RAV4 exists as both a $26,500 auto_loan account and a $27,110
    // amortized car fund. Summing them would report $53,610 of debt for one car.
    const breakdown = buildNetWorthBreakdown(
      [
        account({ id: 'a1', name: 'Checking', balance: 2000 }),
        account({ id: 'a2', name: 'Auto Loan — RAV4', account_type: 'auto_loan', balance: 26500 }),
      ],
      [],
      [],
      [vehicle],
    );
    expect(breakdown.liabilities.map(l => l.name)).toEqual(['Auto Loan — RAV4']);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBe(26500);
  });

  it('keeps an unrelated vehicle when a different car has an account row', () => {
    const breakdown = buildNetWorthBreakdown(
      [account({ id: 'a2', name: 'Auto Loan — Civic', account_type: 'auto_loan', balance: 9000 })],
      [],
      [],
      [vehicle],
    );
    expect(breakdown.liabilities.map(l => l.name)).toEqual(['Auto Loan — Civic', 'Toyota RAV4 (Owned)']);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBe(9000 + 27110);
  });

  it('drops a settled loan', () => {
    const breakdown = buildNetWorthBreakdown([], [], [], [{ ...vehicle, remainingBalance: 0 }]);
    expect(breakdown.liabilities).toEqual([]);
  });

  it('lets a manual liability row win too, not just an account row', () => {
    // Regression: the demo's "Auto Loan — RAV4" is a manual liability, not an
    // auto_loan account. Scoping the dedupe to accounts double-counted the car
    // and dropped demo net worth to -$49,710.
    const breakdown = buildNetWorthBreakdown(
      [account({ id: 'a1', name: 'Checking', balance: 2000 })],
      [],
      [{ id: 'm1', name: 'Auto Loan — RAV4', type: 'Auto Loan', balance: 26500 }],
      [vehicle],
    );
    expect(breakdown.liabilities.map(l => l.id)).toEqual(['manual:m1']);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBe(26500);
  });

  it('stays identical to the old behavior when there are no vehicle loans', () => {
    const accts = [
      account({ id: 'a1', name: 'Checking', balance: 2000 }),
      account({ id: 'a2', name: 'Auto Loan — RAV4', account_type: 'auto_loan', balance: 26500 }),
    ];
    const assets = [{ id: 'm1', name: 'Coin Collection', type: 'Other', value: 300 }];
    const liabs = [{ id: 'm2', name: 'Family Loan', type: 'Personal Loan', balance: 700 }];
    expect(buildNetWorthBreakdown(accts, assets, liabs, [])).toEqual(
      buildNetWorthBreakdown(accts, assets, liabs),
    );
  });
});

describe('buildNetWorthBreakdown — explicit link vs. name matching', () => {
  // Tre's real data (2026-08-13): 'FIXED RATE LOAN' reduces to distinctive tokens
  // {fixed, rate} and '2004 Chevorlet C5' reduces to {chevorlet} — "loan" is a
  // stopword, "2004" has no letters, and "c5" is under the 3-char floor. No
  // shared token, so sharesDistinctiveToken alone left this double-counted:
  // net worth read -42,337 instead of -25,807.
  const fixedRateLoanAccount = account({
    id: 'acc-loan', name: 'FIXED RATE LOAN', account_type: 'auto_loan', balance: 16254.49,
  });
  const c5Vehicle = {
    carFundId: 'cf-c5', vehicleName: '2004 Chevorlet C5', remainingBalance: 16530,
    linkedLoanAccountId: null,
  };

  it('does NOT dedupe this real pair by name alone — the gap the explicit link exists to close', () => {
    expect(sharesDistinctiveToken('FIXED RATE LOAN', '2004 Chevorlet C5')).toBe(false);
    const breakdown = buildNetWorthBreakdown([fixedRateLoanAccount], [], [], [c5Vehicle]);
    expect(breakdown.liabilities.map(l => l.name)).toEqual(['FIXED RATE LOAN', '2004 Chevorlet C5']);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBeCloseTo(16254.49 + 16530, 6);
  });

  it('dedupes the same pair once linkedLoanAccountId points at the account, despite sharing no token', () => {
    const breakdown = buildNetWorthBreakdown(
      [fixedRateLoanAccount], [], [], [{ ...c5Vehicle, linkedLoanAccountId: 'acc-loan' }],
    );
    expect(breakdown.liabilities).toEqual([
      { id: 'live:acc-loan', name: 'FIXED RATE LOAN', type: 'Auto Loan', balance: 16254.49, isLive: true },
    ]);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBeCloseTo(16254.49, 6);
  });

  it('trusts the link even when the names would ALSO have token-matched', () => {
    const rav4Account = account({ id: 'acc-rav4', name: 'Auto Loan — RAV4', account_type: 'auto_loan', balance: 26500 });
    const rav4Vehicle = { carFundId: 'cf-rav4', vehicleName: 'Toyota RAV4 (Owned)', remainingBalance: 27110, linkedLoanAccountId: 'acc-rav4' };
    const breakdown = buildNetWorthBreakdown([rav4Account], [], [], [rav4Vehicle]);
    expect(breakdown.liabilities.map(l => l.id)).toEqual(['live:acc-rav4']);
  });

  it('falls back to name matching for a second, unlinked vehicle loan in the same breakdown', () => {
    const rav4Account = account({ id: 'acc-rav4', name: 'Auto Loan — RAV4', account_type: 'auto_loan', balance: 26500 });
    const linkedC5 = { ...c5Vehicle, linkedLoanAccountId: 'acc-loan' };
    const unlinkedRav4 = { carFundId: 'cf-rav4', vehicleName: 'Toyota RAV4 (Owned)', remainingBalance: 27110, linkedLoanAccountId: null };
    const breakdown = buildNetWorthBreakdown(
      [fixedRateLoanAccount, rav4Account], [], [], [linkedC5, unlinkedRav4],
    );
    // The linked C5 is dropped by id; the unlinked RAV4 is dropped by the RAV4 account's name —
    // neither car fund double-counts, and neither dedupe path had to touch the other's data.
    expect(breakdown.liabilities.map(l => l.id)).toEqual(['live:acc-loan', 'live:acc-rav4']);
  });

  it('does not silently drop the loan when its linked account goes inactive', () => {
    // Inactive accounts count on neither side (module rule) — a stale link must not make the
    // car_funds balance vanish along with the account, or a closed loan overstates net worth.
    const inactiveLoanAccount = account({ ...fixedRateLoanAccount, active: false });
    const breakdown = buildNetWorthBreakdown(
      [inactiveLoanAccount], [], [], [{ ...c5Vehicle, linkedLoanAccountId: 'acc-loan' }],
    );
    expect(breakdown.liabilities.map(l => l.id)).toEqual(['vehicle:cf-c5']);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBeCloseTo(16530, 6);
  });
});

describe('buildNetWorthBreakdown — end to end from a real car_funds row', () => {
  // Every test above hand-builds the NetWorthVehicleLoan literal, which is exactly why they all
  // passed while the shipped feature did nothing: `NetWorthVehicleLoan` called the field
  // `linkedAccountId` while `getActiveCarLoanPayments` emits `linkedLoanAccountId`, and because the
  // field was OPTIONAL, `CarLoanPaymentInfo` still satisfied the interface, tsc stayed green, and
  // the value read `undefined` at runtime. So this one goes through the real producer — the same
  // call every page makes — and asserts on the pair from Tre's own data.
  const c5Fund: CarFund = {
    id: 'cf-c5', user_id: 'u1', vehicle_name: '2004 Chevorlet C5',
    target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0, saved_source: 'fixed',
    saved_percent: 0, sort_order: 0, auto_extra: false, monthly_insurance: 0, expected_apr: 10, loan_term_months: 48,
    phase: 'loan', loan_amount: 16000,
    loan_start_date: '2026-06-22', payment_start_date: '2026-08-07', interest_start_date: '2026-08-07',
    actual_monthly_payment: 0, linked_account: null, linked_rule_id: null, loan_payment_account: null,
    linked_loan_account_id: 'acc-loan',
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [],
    insurance_start_date: null, created_at: '2026-01-01',
  };
  const fixedRateLoanAccount = account({
    id: 'acc-loan', name: 'FIXED RATE LOAN', account_type: 'auto_loan', balance: 16254.49,
  });
  const asOf = new Date(2026, 7, 13); // 2026-08-13, the day this was found live

  it('counts a linked loan ONCE when the loans come from getActiveCarLoanPayments', () => {
    const vehicleLoans = getActiveCarLoanPayments([c5Fund], asOf);
    expect(vehicleLoans).toHaveLength(1);
    expect(vehicleLoans[0].remainingBalance).toBeGreaterThan(0);

    const breakdown = buildNetWorthBreakdown([fixedRateLoanAccount], [], [], vehicleLoans);
    expect(breakdown.liabilities).toEqual([
      { id: 'live:acc-loan', name: 'FIXED RATE LOAN', type: 'Auto Loan', balance: 16254.49, isLive: true },
    ]);
    expect(totalsFromBreakdown(breakdown).totalLiabilities).toBeCloseTo(16254.49, 6);
  });

  it('still counts it twice when the user has not linked the account — the names share no token', () => {
    // The control for the test above: without the link there is nothing to dedupe on, and that is
    // the documented behavior, not a second bug. If this one ever starts passing with ONE row, the
    // name heuristic has been loosened and needs its own review.
    const vehicleLoans = getActiveCarLoanPayments(
      [{ ...c5Fund, linked_loan_account_id: null }], asOf,
    );
    const breakdown = buildNetWorthBreakdown([fixedRateLoanAccount], [], [], vehicleLoans);
    expect(breakdown.liabilities.map(l => l.name)).toEqual(['FIXED RATE LOAN', '2004 Chevorlet C5']);
  });
});


describe('nonCardLiabilityTotal', () => {
  // The Dashboard hero leads with a CREDIT-CARD payoff date. This is the predicate that stops
  // it calling a user with a car loan "debt free" — it must count every liability that is not
  // a card, including one the app has never heard of.
  const cards = account({ id: 'cc', name: 'Prime Visa', account_type: 'credit_card', balance: 6976.94 });

  it('is zero when the only debt is on cards', () => {
    const breakdown = buildNetWorthBreakdown([cards], [], []);
    expect(nonCardLiabilityTotal(breakdown)).toBe(0);
  });

  it('counts an auto loan, a mortgage and a student loan alongside a card', () => {
    const breakdown = buildNetWorthBreakdown([
      cards,
      account({ id: 'l1', name: 'Auto', account_type: 'auto_loan', balance: 24310 }),
      account({ id: 'l2', name: 'House', account_type: 'mortgage', balance: 180000 }),
      account({ id: 'l3', name: 'School', account_type: 'student_loan', balance: 5200 }),
    ], [], []);
    expect(nonCardLiabilityTotal(breakdown)).toBe(24310 + 180000 + 5200);
  });

  it('counts a MANUAL liability, which has no account type at all', () => {
    const breakdown = buildNetWorthBreakdown([cards], [], [
      { id: 'm1', name: 'Loan from Dad', type: 'Other Liability', balance: 1500 },
    ]);
    expect(nonCardLiabilityTotal(breakdown)).toBe(1500);
  });

  it('ignores an account that is not active — it counts on neither side of net worth', () => {
    const breakdown = buildNetWorthBreakdown([
      cards,
      account({ id: 'l1', name: 'Old Auto', account_type: 'auto_loan', balance: 24310, active: false }),
    ], [], []);
    expect(nonCardLiabilityTotal(breakdown)).toBe(0);
  });
});

describe('buildNetWorthBreakdown — a card the user has not opened yet', () => {
  // `card_start_date` in the FUTURE means planned, not opened: the two real cases are
  // Venture X (2026-12-20) and Apple Card (2028-02-28), both `active = true` with a $0
  // balance. They were rendering as $0 liability rows for cards that do not exist.
  const ASOF = new Date(2026, 7, 18); // 2026-08-18

  const planned = account({
    name: 'Venture X', account_type: 'credit_card', balance: 0, card_start_date: '2026-12-20',
  });
  const open = account({
    name: 'Discover', account_type: 'credit_card', balance: 1500, card_start_date: '2024-01-05',
  });

  it('leaves an unopened card out of the liabilities list entirely', () => {
    const { liabilities } = buildNetWorthBreakdown([planned, open], [], [], [], ASOF);
    expect(liabilities.map(l => l.name)).toEqual(['Discover']);
  });

  it('counts the same card once its start date has arrived', () => {
    const { liabilities } = buildNetWorthBreakdown(
      [{ ...planned, balance: 400 }, open], [], [], [], new Date(2027, 0, 5),
    );
    expect(liabilities.map(l => l.name).sort()).toEqual(['Discover', 'Venture X']);
  });

  it('never changes the totals — an unopened card owes $0 either way', () => {
    const withPlanned = totalsFromBreakdown(buildNetWorthBreakdown([planned, open], [], [], [], ASOF));
    const withoutPlanned = totalsFromBreakdown(buildNetWorthBreakdown([open], [], [], [], ASOF));
    expect(withPlanned).toEqual(withoutPlanned);
  });

  it('passes every non-card account through untouched', () => {
    // The predicate must not become a general "hide accounts" filter: only credit cards
    // have a start date, and a checking account with one set is still an asset.
    const { assets } = buildNetWorthBreakdown(
      [account({ name: 'Checking', card_start_date: '2030-01-01' })], [], [], [], ASOF,
    );
    expect(assets.map(a => a.name)).toEqual(['Checking']);
  });
});
