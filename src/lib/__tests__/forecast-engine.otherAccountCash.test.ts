/**
 * MONEY SPENT OUT OF AN ACCOUNT THAT IS NOT THE FUNDING ACCOUNT.
 *
 * Tre, 2026-08-27: *"the net cash coming out of savings should NOT be taken out in that top section
 * and affect ending balance. that top section is a reflection of only the checking account (the
 * debt payment account). make a new section that shows the change in other accounts when there is
 * one."* His example month is **June 2027 — a $3,830 lease-break fee whose `payment_source` is his
 * Savings Account**, which the walk was subtracting from CHECKING while savings never moved.
 *
 * Two halves, and each one alone is a defect:
 *   • the cash side, built by the caller (`useForecastEngineInputs.oneTimeByMonth` +
 *     `other-account-cash.ts`) — the expense is left out of this month's cash;
 *   • the balance side, step 4b-iii here — the source account is debited, so the dollars land
 *     somewhere real instead of leaving the plan. Recurring rules paid from another account had the
 *     cash half since long before this and NEVER had the balance half, so their savings balance
 *     carried money that had already been spent for the whole horizon.
 *
 * Would-fail check: delete step 4b-iii and every "the account fell" expectation below fails while
 * the cash stays put — which is exactly the overstatement being pinned shut.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { otherAssetSourceId, assetAccountIdsOf } from '@/lib/other-account-cash';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    ...over,
  } as unknown as AccountRow);

const CHK = acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20_000 });
const SAV = acct({ id: 'sav-1', name: 'Savings Account', account_type: 'savings', balance: 10_000 });
const CARD = acct({ id: 'cc-1', name: 'Venture X', account_type: 'credit_card', balance: 0 });

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  // Zero growth everywhere, so a balance difference can only be a real movement.
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

const FEE = 3_830;
const MONTH = '2026-11';

function makeInputs(over: Partial<ForecastInputs> = {}): ForecastInputs {
  return {
    debts: [], goals: [], carFunds: [],
    accounts: [CHK, SAV, CARD],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: [],
    forecastFundingAccountId: 'chk-1',
    cashFloor: 0,
    pauseSavings: false,
    syncCutoffDate: '2026-10-15',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
    ...over,
  };
}

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

/** The month whose key is `MONTH`, one month out from the anchor. */
const M = 1;
const savOf = (r: { assetBreakdown: { id: string; balance: number }[] }) =>
  r.assetBreakdown.find(a => a.id === 'sav-1')?.balance ?? 0;

describe('otherAssetSourceId — which account did this really come out of', () => {
  const assets = assetAccountIdsOf([CHK, SAV, CARD]);

  it('names the other asset account', () => {
    expect(otherAssetSourceId('account:sav-1', 'chk-1', assets)).toBe('sav-1');
    expect(otherAssetSourceId('sav-1', 'chk-1', assets)).toBe('sav-1');
  });

  it('is null for the funding account itself, and for no source at all', () => {
    expect(otherAssetSourceId('account:chk-1', 'chk-1', assets)).toBeNull();
    expect(otherAssetSourceId(null, 'chk-1', assets)).toBeNull();
    expect(otherAssetSourceId('', 'chk-1', assets)).toBeNull();
  });

  it('is null for a CREDIT CARD — a purchase raises a liability, it does not empty an asset', () => {
    expect(assets.has('cc-1')).toBe(false);
    expect(otherAssetSourceId('account:cc-1', 'chk-1', assets)).toBeNull();
  });

  it('is null when there is no funding account to be other than', () => {
    expect(otherAssetSourceId('account:sav-1', null, assets)).toBeNull();
  });

  it('is null for an account the user does not own', () => {
    expect(otherAssetSourceId('account:someone-else', 'chk-1', assets)).toBeNull();
  });
});

describe('forecast-engine — a one-time paid from savings', () => {
  afterEach(() => vi.useRealTimers());

  const withFee = () => makeInputs({
    otherAccountOneTimeByMonth: {
      [MONTH]: [{ id: 'sav-1', name: 'Lease break fee', amount: FEE }],
    },
  });

  it('does NOT come out of the ending cash of the account above it', () => {
    anchor();
    const base = calculateForecast(makeInputs());
    anchor();
    const fee = calculateForecast(withFee());
    expect(fee.data[M].endingCash).toBeCloseTo(base.data[M].endingCash, 2);
  });

  it('DOES come out of the savings account it was paid from, and stays out', () => {
    anchor();
    const base = calculateForecast(makeInputs());
    anchor();
    const fee = calculateForecast(withFee());
    expect(savOf(fee.data[M]) - savOf(base.data[M])).toBeCloseTo(-FEE, 2);
    // Not a one-month dip: the money is spent, so every later month is lower too.
    expect(savOf(fee.data[M + 6]) - savOf(base.data[M + 6])).toBeCloseTo(-FEE, 2);
  });

  it('is named on the row, with the account it came from', () => {
    anchor();
    const fee = calculateForecast(withFee());
    expect(fee.data[M].otherAccountOneTimeItems).toEqual([
      { name: 'Lease break fee', fromAcctId: 'sav-1', fromAcctName: 'Savings Account', amount: FEE },
    ]);
    // …and only in its own month.
    expect(fee.data[M + 1].otherAccountOneTimeItems).toEqual([]);
  });

  it('is byte-identical for every user with no such transaction', () => {
    anchor();
    const absent = calculateForecast(makeInputs());
    anchor();
    const empty = calculateForecast(makeInputs({ otherAccountOneTimeByMonth: {} }));
    expect(empty.data).toEqual(absent.data);
  });

  it('cannot drive the account below empty', () => {
    anchor();
    const huge = calculateForecast(makeInputs({
      otherAccountOneTimeByMonth: { [MONTH]: [{ id: 'sav-1', name: 'Everything', amount: 999_999 }] },
    }));
    expect(savOf(huge.data[M])).toBe(0);
    expect(savOf(huge.data[M + 3])).toBe(0);
  });
});

describe('forecast-engine — a recurring expense rule paid from another account', () => {
  afterEach(() => vi.useRealTimers());

  const RULE_AMT = 200;
  const rules = [{
    id: 'r-1', name: 'Storage unit', rule_type: 'expense', amount: RULE_AMT, active: true,
    frequency: 'monthly', due_day: 5, payment_source: 'account:sav-1',
    category: 'Bills', start_date: null, end_date: null,
  }] as unknown as ForecastInputs['rules'];

  it('was ALREADY kept out of the cash walk — that half was never wrong', () => {
    anchor();
    const base = calculateForecast(makeInputs());
    anchor();
    const withRule = calculateForecast(makeInputs({ rules }));
    expect(withRule.data[M].endingCash).toBeCloseTo(base.data[M].endingCash, 2);
  });

  it('now leaves the account it is paid from, month after month', () => {
    anchor();
    const base = calculateForecast(makeInputs());
    anchor();
    const withRule = calculateForecast(makeInputs({ rules }));
    // ⚠️ THE DEFECT THIS CLOSES: before step 4b-iii the difference here was 0 — the money was
    // excluded from cash and debited from nothing, so it was spent by nobody and Net Worth carried
    // it forever.
    expect(savOf(withRule.data[M]) - savOf(base.data[M])).toBeCloseTo(-RULE_AMT * (M + 1), 2);
    expect(savOf(withRule.data[M + 2]) - savOf(base.data[M + 2])).toBeCloseTo(-RULE_AMT * (M + 3), 2);
  });

  it('carries the account id, not only its label', () => {
    anchor();
    const withRule = calculateForecast(makeInputs({ rules }));
    expect(withRule.data[M].otherAccountExpenseItems[0]).toMatchObject({
      name: 'Storage unit', fromAcctId: 'sav-1', fromAcctName: 'Savings Account',
    });
  });
});
