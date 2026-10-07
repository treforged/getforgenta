import { describe, it, expect } from 'vitest';
import { month0DrawerChainLines } from '../month0-drawer-lines';
import type { Month0Result } from '@/lib/debt-model-types';

// Hand-built 2026-10-07 (af3e9a3d): the free tier failed this twice (type errors, then a timeout).
// Only the fields month0DrawerChainLines reads are filled; the cast is the fixture boundary.
const ZERO_CHAIN = {
  fundingBalance: 0, income: 0, expenses: 0, planExpenses: 0, goalContributions: 0,
  autoExtraReserve: 0, carSavedEarmark: 0, carReserve: 0, carLoanPayment: 0, vehicleInsurance: 0,
  otherDebtPayment: 0, transfers: 0, unfundedAccountOutflow: 0, nonCashIntoFunding: 0,
  oneTimeNet: 0, cashPreDebt: 0,
};

function make(chain: Partial<typeof ZERO_CHAIN>, rest: { safeToPayTotal?: number; carReserveHeld?: number } = {}): Month0Result {
  return {
    chain: { ...ZERO_CHAIN, ...chain },
    safeToPayTotal: rest.safeToPayTotal ?? 0,
    carReserveHeld: rest.carReserveHeld ?? 0,
  } as unknown as Month0Result;
}

const keys = (lines: { key: string }[]) => lines.map((l) => l.key);

describe('month0DrawerChainLines', () => {
  it('an all-zero month prints only the opening row and the two checkpoints', () => {
    expect(month0DrawerChainLines(make({}), 0)).toEqual([
      { key: 'fundingBalance', label: 'Balance on hand', amount: 0 },
      { key: 'cashPreDebt', label: 'Cash before debt payments', amount: 0, op: '=' },
      { key: 'monthEndCash', label: 'Projected Month-End Cash', amount: 0, op: '=' },
    ]);
  });

  it('drops a term under half a cent and keeps one at exactly half a cent', () => {
    const lines = month0DrawerChainLines(make({ income: 0.004, expenses: 0.005 }), 0);
    expect(keys(lines)).toEqual(['fundingBalance', 'expenses', 'cashPreDebt', 'monthEndCash']);
  });

  it('prints a negative term as its absolute value with the sign flipped', () => {
    const lines = month0DrawerChainLines(make({ expenses: -25, oneTimeNet: -40 }), 0);
    expect(lines.find((l) => l.key === 'expenses')).toEqual({ key: 'expenses', label: 'Bills still coming', amount: 25, op: '+' });
    expect(lines.find((l) => l.key === 'oneTimeNet')).toEqual({ key: 'oneTimeNet', label: 'One-time transactions', amount: 40, op: '−' });
  });

  it('splits transfers so the transfers row and the unfunded row sum back to transfers', () => {
    const lines = month0DrawerChainLines(make({ transfers: 300, unfundedAccountOutflow: 120 }), 0);
    const t = lines.find((l) => l.key === 'transfers');
    const u = lines.find((l) => l.key === 'unfundedAccountOutflow');
    expect(t).toEqual({ key: 'transfers', label: 'Transfers & lump sums', amount: 180, op: '−' });
    expect(u).toEqual({ key: 'unfundedAccountOutflow', label: "Other accounts' bills paid from checking", amount: 120, op: '−' });
    expect(t!.amount + u!.amount).toBe(300);
  });

  it('treats a missing unfundedAccountOutflow and nonCashIntoFunding as zero', () => {
    const m0 = make({ transfers: 50 });
    const chain = (m0 as unknown as { chain: Record<string, unknown> }).chain;
    delete chain.unfundedAccountOutflow;
    delete chain.nonCashIntoFunding;
    const lines = month0DrawerChainLines(m0, 0);
    expect(lines.find((l) => l.key === 'transfers')!.amount).toBe(50);
    expect(keys(lines)).not.toContain('unfundedAccountOutflow');
    expect(keys(lines)).not.toContain('nonCashIntoFunding');
  });

  it('a full month adds up: opening +/- every term equals cashPreDebt, then month-end cash', () => {
    const chain = {
      fundingBalance: 2000, income: 1500, expenses: 900, planExpenses: 100, goalContributions: 50,
      autoExtraReserve: 25, carSavedEarmark: 200, carReserve: 75, carLoanPayment: 423, vehicleInsurance: 173,
      otherDebtPayment: 60, transfers: 300, unfundedAccountOutflow: 120, nonCashIntoFunding: 80, oneTimeNet: -40,
      cashPreDebt: 0,
    };
    chain.cashPreDebt = 2000 + 1500 - 900 - 100 - 50 - 25 - 200 - 75 - 423 - 173 - 60 - 300 + 80 - 40; // 1234
    const lines = month0DrawerChainLines(make(chain, { safeToPayTotal: 1000, carReserveHeld: 75 }), 309);
    let running = 0;
    for (const l of lines) {
      if (l.op === undefined) running = l.amount;
      else if (l.op === '+') running += l.amount;
      else if (l.op === '−') running -= l.amount;
      else expect(running).toBeCloseTo(l.amount, 6); // every '=' checkpoint matches the column above it
    }
    expect(keys(lines)).toEqual([
      'fundingBalance', 'income', 'expenses', 'planExpenses', 'goalContributions', 'autoExtraReserve',
      'carSavedEarmark', 'carReserve', 'carLoanPayment', 'vehicleInsurance', 'otherDebtPayment', 'transfers',
      'unfundedAccountOutflow', 'nonCashIntoFunding', 'oneTimeNet', 'cashPreDebt', 'safeToPayTotal',
      'carReserveHeld', 'monthEndCash',
    ]);
  });
});
