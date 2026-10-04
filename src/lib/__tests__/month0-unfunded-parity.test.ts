// @vitest-environment jsdom
//
// DASHBOARD AND FORECAST MUST AGREE ON MONTH 0 WHEN CHECKING PAYS A BILL ANOTHER ACCOUNT CANNOT.
// Asks 5810a568 and d651b7b5.
//
// Step 4b-iii (forecast-engine.ts) charges the part of an account-paid bill its own account cannot
// cover to checking (`unfundedAccountOutflow`). Month 0's cash is decided by useCardProjection's
// month-0 chain, which had no model of another account's balance, so in month 0 the Forecast row
// paid the bill and the Dashboard did not. Measured on this persona before the fix: Dashboard
// month-end cash $1,604 against Forecast's $1,304 - the $300 bill, exactly.
//
// The second case is the other half of d651b7b5: a TRANSFER whose source is a second checking
// account was charged to the funding account's cash walk, on both surfaces, as if checking had
// sent it.
//
// SYNTHETIC DATA ONLY: the committed demo persona plus a second, EMPTY checking account that pays
// $300 a month of bills from September on (nothing refills it, so all $300 reaches checking).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
const OPS_BILLS = 300;
/** A $250 transfer out of the empty account into savings, after the sync date. */
const OPS_TRANSFER = 250;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

interface Scenario {
  opsBills: boolean;
  opsTransfer: boolean;
  /** Operations' synced balance (default $0). */
  opsBalance?: number;
  /** Extra rules, for the mixed-movement case. */
  extraRules?: Record<string, unknown>[];
}

function run({ opsBills, opsTransfer, opsBalance = 0, extraRules = [] }: Scenario) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = [
    ...demoAccounts,
    {
      id: 'ops', user_id: 'demo', name: 'Operations', account_type: 'checking', institution: 'Synthetic',
      balance: opsBalance, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '',
    },
  ];
  const rules = [
    ...demoRecurringRules,
    // Due the 15th: after the 2026-09-10 sync date, so it is still to come in month 0.
    ...(opsBills ? [rule({ id: 'synthetic-ops-bills', name: 'Ops Bills', amount: OPS_BILLS, rule_type: 'expense', frequency: 'monthly', due_day: 15, category: 'Software', payment_source: 'account:ops', start_date: '2026-09-01' })] : []),
    ...(opsTransfer ? [rule({ id: 'synthetic-ops-transfer', name: 'Ops to Savings', amount: OPS_TRANSFER, rule_type: 'transfer', frequency: 'monthly', due_day: 20, category: 'Savings', payment_source: 'ops', deposit_account: 'd3', start_date: '2026-09-01' })] : []),
    ...extraRules.map(rule),
  ];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts });
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  const inputs = { ...base, accounts } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(cp as unknown as CardProjectionResult, inputs);
  vi.useRealTimers();
  return out;
}

describe('month 0: Dashboard == Forecast with an outflow checking pays for another account', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('control: without the empty account bills the two surfaces agree and nothing is unfunded', () => {
    const out = run({ opsBills: false, opsTransfer: false });
    expect(out.projections.data[0].unfundedAccountOutflow ?? 0).toBe(0);
    expect(Math.abs(out.cardProjection.month0!.endCash - out.projections.data[0].rawEndingCash)).toBeLessThanOrEqual(0.01);
  }, 120_000);

  it('a $300 month-0 bill from an empty account: Dashboard month-end cash equals Forecast end cash', () => {
    const out = run({ opsBills: true, opsTransfer: false });
    const row = out.projections.data[0];
    // Positive control: the engine really charges the bill to checking in month 0. Without this the
    // equality below could come from a bill neither surface counted.
    expect(row.unfundedAccountOutflow).toBeCloseTo(OPS_BILLS, 2);
    const m0 = out.cardProjection.month0!;
    expect(
      Math.abs(m0.endCash - row.rawEndingCash),
      `Dashboard $${m0.endCash.toFixed(2)} vs Forecast $${row.rawEndingCash.toFixed(2)}`,
    ).toBeLessThanOrEqual(0.01);
    // The hook names the dollars it charged, and the drawer's equation still balances.
    expect(m0.chain.unfundedAccountOutflow).toBeCloseTo(OPS_BILLS, 2);
    expect(Math.abs(m0.endCash - (m0.chain.cashPreDebt - m0.safeToPayTotal + m0.carReserveHeld))).toBeLessThan(0.01);
  }, 120_000);

  it('every kind of month-0 movement into and out of the other accounts: still equal to the cent', () => {
    // Operations holds $100, gets $120 from checking on the 20th and $40 from savings on the 18th,
    // and pays $300 of bills on the 15th: the engine charges checking 300 - 260 = $40. A $500
    // savings bill on the 25th against a $5,812 balance less the $40 is fully covered, so it adds 0.
    const out = run({
      opsBills: true, opsTransfer: false, opsBalance: 100,
      extraRules: [
        { id: 'synthetic-fund-ops', name: 'Fund Ops', amount: 120, rule_type: 'transfer', frequency: 'monthly', due_day: 20, category: 'Transfer', payment_source: 'd1', deposit_account: 'ops', start_date: '2026-09-01' },
        { id: 'synthetic-sav-ops', name: 'Savings to Ops', amount: 40, rule_type: 'transfer', frequency: 'monthly', due_day: 18, category: 'Transfer', payment_source: 'd3', deposit_account: 'ops', start_date: '2026-09-01' },
        { id: 'synthetic-sav-bill', name: 'Savings Bill', amount: 500, rule_type: 'expense', frequency: 'monthly', due_day: 25, category: 'Insurance', payment_source: 'account:d3', start_date: '2026-09-01' },
      ],
    });
    const row = out.projections.data[0];
    expect(row.unfundedAccountOutflow).toBeCloseTo(40, 2);
    expect(out.cardProjection.month0!.chain.unfundedAccountOutflow).toBeCloseTo(40, 2);
    expect(Math.abs(out.cardProjection.month0!.endCash - row.rawEndingCash)).toBeLessThanOrEqual(0.01);
  }, 120_000);

  it('a transfer out of a second checking account is not charged to the funding account', () => {
    const without = run({ opsBills: true, opsTransfer: false });
    const withTransfer = run({ opsBills: true, opsTransfer: true });
    // Positive control: the transfer is in month 0 and moves out of Operations, not out of checking.
    const moved = withTransfer.projections.data[0].nonCashTransferItems.filter(t => t.fromAcctId === 'ops');
    expect(moved.map(t => t.amount)).toEqual([OPS_TRANSFER]);
    // The funding account's month-0 cash does not move: the transfer left Operations, not checking.
    expect(withTransfer.projections.data[0].rawEndingCash).toBeCloseTo(without.projections.data[0].rawEndingCash, 2);
    expect(withTransfer.cardProjection.month0!.chain.cashPreDebt).toBeCloseTo(without.cardProjection.month0!.chain.cashPreDebt, 2);
    // And the two surfaces still agree.
    expect(Math.abs(withTransfer.cardProjection.month0!.endCash - withTransfer.projections.data[0].rawEndingCash)).toBeLessThanOrEqual(0.01);
  }, 120_000);
});
