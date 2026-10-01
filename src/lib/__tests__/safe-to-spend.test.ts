import { describe, it, expect } from 'vitest';
import {
  computeSafeToSpend, assembleSafeToSpendInput, inferRulePayday,
  type SafeToSpendAssembly, type SafeToSpendMonth0, type SafeToSpendRule,
} from '@/lib/safe-to-spend';
import type { ScheduledEvent } from '@/lib/scheduling';

const base = { cutoffDate: '2026-10-01', payday: '2026-10-15', startBalance: 2000, undatedReserve: 0, events: [], floor: 0 };

describe('computeSafeToSpend - the low-point walk', () => {
  it('takes the LOW point before an income refill, not the end point', () => {
    const r = computeSafeToSpend({ ...base, events: [
      { date: '2026-10-03', amount: 1500, direction: 'out', label: 'Rent' },
      { date: '2026-10-05', amount: 800, direction: 'in', label: 'Side job' },
    ] });
    // End point would be 1300; the low point on the 3rd is 500.
    expect(r).toEqual({ kind: 'figure', amount: 500, lowPoint: 500, lowDate: '2026-10-03', payday: '2026-10-15', floor: 0 });
  });

  it('applies a same-day bill before same-day income', () => {
    const r = computeSafeToSpend({ ...base, events: [
      { date: '2026-10-04', amount: 300, direction: 'in', label: 'Refund' },
      { date: '2026-10-04', amount: 1800, direction: 'out', label: 'Rent' },
    ] });
    expect(r.kind === 'figure' && r.amount).toBe(200);
  });

  it('reserves a bill due ON payday and ignores one after it', () => {
    const r = computeSafeToSpend({ ...base, events: [
      { date: '2026-10-15', amount: 400, direction: 'out', label: 'Phone' },
      { date: '2026-10-16', amount: 999, direction: 'out', label: 'After payday' },
    ] });
    expect(r.kind === 'figure' && r.amount).toBe(1600);
  });

  it('ignores events on or before the cutoff (already in the balance)', () => {
    const r = computeSafeToSpend({ ...base, events: [{ date: '2026-10-01', amount: 900, direction: 'out', label: 'Paid' }] });
    expect(r.kind === 'figure' && r.amount).toBe(2000);
  });

  it('subtracts the undated reserve on day one and the floor at the end, never below 0', () => {
    const r = computeSafeToSpend({ ...base, undatedReserve: 250.5, floor: 500 });
    expect(r.kind === 'figure' && r.amount).toBe(1249.5);
    const short = computeSafeToSpend({ ...base, undatedReserve: 1900, floor: 500 });
    expect(short).toMatchObject({ kind: 'figure', amount: 0, lowPoint: 100 });
  });

  it('wraps into next month when payday is early next month', () => {
    const r = computeSafeToSpend({ ...base, cutoffDate: '2026-10-28', payday: '2026-11-02', events: [
      { date: '2026-11-01', amount: 1200, direction: 'out', label: 'Rent' },
    ] });
    expect(r).toMatchObject({ kind: 'figure', amount: 800, lowDate: '2026-11-01', payday: '2026-11-02' });
  });

  it('returns the empty state, never a guess, when an input is missing', () => {
    expect(computeSafeToSpend(null)).toEqual({ kind: 'empty', missing: 'no-projection' });
    expect(computeSafeToSpend({ ...base, startBalance: null })).toEqual({ kind: 'empty', missing: 'no-funding-account' });
    expect(computeSafeToSpend({ ...base, payday: null })).toEqual({ kind: 'empty', missing: 'no-payday' });
    expect(computeSafeToSpend({ ...base, payday: '2026-10-01' })).toEqual({ kind: 'empty', missing: 'no-payday' });
  });
});

const zeroM0: SafeToSpendMonth0 = {
  fundingBalance: 3000, carSavedEarmark: 0, goalContributions: 0, autoExtraReserve: 0, carReserve: 0,
  carLoanPayment: 0, vehicleInsurance: 0, otherDebtPayment: 0, transfers: 0, planExpenses: 0, oneTimeNet: 0,
  cyclingPayment: 0,
};
const rule = (id: string, rule_type: string, extra: Partial<SafeToSpendRule> = {}): SafeToSpendRule =>
  ({ id, active: true, rule_type, category: 'Housing', payment_source: null, deposit_account: null, tax_rate: null, ...extra });
const ev = (ruleId: string, date: string, amount: number, type: 'income' | 'expense'): ScheduledEvent =>
  ({ ruleId, date, amount, type, name: ruleId });

function assembly(over: Partial<SafeToSpendAssembly> = {}): SafeToSpendAssembly {
  return {
    month0: zeroM0, fundingAccountId: 'chk', liquidAccountIds: new Set(['chk']), creditCardIds: new Set(['cc1']),
    paycheckRuleIds: new Set(), cardMinimumReserve: 0, rules: [], scheduledEvents: [], confirmed: new Set(),
    pauseSavings: false, cutoffDate: '2026-10-01', profilePayday: '2026-10-15', floor: 0, ...over,
  };
}
const run = (a: SafeToSpendAssembly) => computeSafeToSpend(assembleSafeToSpendInput(a));

describe('assembleSafeToSpendInput - engine data to dated walk', () => {
  it('reserves a cash bill, ignores a card-charged purchase and a card-default category', () => {
    const r = run(assembly({
      rules: [rule('rent', 'expense'), rule('food', 'expense', { payment_source: 'account:cc1' }), rule('dine', 'expense', { category: 'Dining' })],
      scheduledEvents: [ev('rent', '2026-10-05', 1200, 'expense'), ev('food', '2026-10-06', 400, 'expense'), ev('dine', '2026-10-07', 90, 'expense')],
    }));
    expect(r.kind === 'figure' && r.amount).toBe(1800);
  });

  it('does not reserve a bill the user confirmed already paid', () => {
    const r = run(assembly({
      rules: [rule('rent', 'expense')], scheduledEvents: [ev('rent', '2026-10-05', 1200, 'expense')],
      confirmed: new Set(['rent|2026-10-05']),
    }));
    expect(r.kind === 'figure' && r.amount).toBe(3000);
  });

  it('auto floor is not double-counted: the caller passes 0 and the bill is reserved once', () => {
    const r = run(assembly({ rules: [rule('rent', 'expense')], scheduledEvents: [ev('rent', '2026-10-05', 1200, 'expense')], floor: 0 }));
    expect(r.kind === 'figure' && r.amount).toBe(1800);
  });

  it('reserves every undated month-0 term plus card statements and minimums, and nets the car earmark', () => {
    const r = run(assembly({
      month0: { ...zeroM0, carSavedEarmark: 100, goalContributions: 50, autoExtraReserve: 10, carReserve: 20,
        carLoanPayment: 300, vehicleInsurance: 90, otherDebtPayment: 200, transfers: 40, planExpenses: 30,
        oneTimeNet: -60, cyclingPayment: 500 },
      cardMinimumReserve: 35,
    }));
    // 3000 - 100 - (50+10+20+300+90+200+40+30+60+500+35 = 1335) = 1565
    expect(r.kind === 'figure' && r.amount).toBe(1565);
  });

  it('counts non-paycheck income net of its tax rate, but never a paycheck rule', () => {
    const r = run(assembly({
      rules: [rule('side', 'income', { tax_rate: 25 }), rule('pay', 'income'), rule('rent', 'expense')],
      paycheckRuleIds: new Set(['pay']),
      scheduledEvents: [ev('side', '2026-10-03', 400, 'income'), ev('pay', '2026-10-04', 2000, 'income'), ev('rent', '2026-10-10', 3200, 'expense')],
    }));
    // 3000 + 300 (side net) - 3200 = 100; the 2000 paycheck rule is not counted.
    expect(r.kind === 'figure' && r.amount).toBe(100);
  });

  it('ignores a bill paid from another bank account', () => {
    const r = run(assembly({ rules: [rule('x', 'expense', { payment_source: 'account:sav' })], scheduledEvents: [ev('x', '2026-10-05', 700, 'expense')] }));
    expect(r.kind === 'figure' && r.amount).toBe(3000);
  });

  it('infers payday from the largest income rule when no salary is set, and excludes it', () => {
    const a = assembly({
      profilePayday: null,
      rules: [rule('side', 'income'), rule('job', 'income'), rule('rent', 'expense')],
      scheduledEvents: [ev('side', '2026-10-03', 50, 'income'), ev('job', '2026-10-09', 1800, 'income'), ev('rent', '2026-10-08', 1000, 'expense')],
    });
    expect(inferRulePayday(a)).toBe('2026-10-09');
    // 3000 + 50 - 1000 = 2050, low point 2050 on the 8th (the side income came first).
    expect(run(a)).toMatchObject({ kind: 'figure', amount: 2050, payday: '2026-10-09' });
  });

  it('shows the empty state for a new account: no engine, no funding account, or no income', () => {
    expect(run(assembly({ month0: null }))).toEqual({ kind: 'empty', missing: 'no-projection' });
    expect(run(assembly({ fundingAccountId: null, liquidAccountIds: new Set() }))).toEqual({ kind: 'empty', missing: 'no-funding-account' });
    // No CHOSEN funding account but a cash account exists: the engine uses total liquid cash, so a figure shows.
    expect(run(assembly({ fundingAccountId: null }))).toMatchObject({ kind: 'figure', amount: 3000 });
    expect(run(assembly({ profilePayday: null }))).toEqual({ kind: 'empty', missing: 'no-payday' });
  });
});
