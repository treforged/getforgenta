// @vitest-environment jsdom
//
// A PAYMENT PINNED TO NEXT MONTH HAS TO BE SAVED FOR THIS MONTH. Ask 5810a568.
//
// f077f9bb taught both floor look-aheads that a user pin (`withPaymentOverrides`) is a fixed
// obligation. But month 0 is decided by useCardProjection's own look-ahead, and
// `withPaymentOverrides` only replayed the finished sim with the pins: it never re-ran that
// look-ahead, so month 0 could not save for a pin in month 1, and the engine (which governs months
// 1+ only) had no earlier month left to save in.
//
// SYNTHETIC DATA ONLY: the committed demo persona with a heavier card, a $1,500 cash bill in
// October (month 1), and the user pinning $1,500 to that card in the same October.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
const PIN_CARD = 'd7';
/** October is month 1 at NOW. */
const PIN_MONTH = 1;
const PIN = 1500;
const BILL = 1500;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

function run(pinned: boolean) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = demoAccounts.map(a => a.id !== PIN_CARD ? a : { ...a, balance: 11000, balance_tranches: [], min_payment: 400 });
  const rules = [
    ...demoRecurringRules,
    rule({ id: 'synthetic-annual-bill', name: 'Annual Bill', amount: BILL, rule_type: 'expense', frequency: 'yearly', due_day: 20, due_month: 10, category: 'Insurance', payment_source: 'account:d1' }),
  ];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts }) as unknown as CardProjectionResult;
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  const forecastMonthEvents = base.forecastMonthEvents.map((e, i) =>
    i === PIN_MONTH ? { ...e, expenses: e.expenses + BILL } : e);
  // The production shape (CreditCardEngine's overrideData).
  const withPins = pinned ? cp.withPaymentOverrides!({ [PIN_CARD]: { [PIN_MONTH]: PIN } }) : cp;
  const inputs = { ...base, accounts, forecastMonthEvents, cardProjectionData: withPins } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(withPins, inputs);
  vi.useRealTimers();
  return { out, withPins, cp };
}

const shortMonths = (out: ReturnType<typeof run>['out']) =>
  out.projections.data
    .filter(r => r.rawEndingCash < r.rawMonthMinSafe - 0.005)
    .map(r => `${r.month} short ${(r.rawMonthMinSafe - r.rawEndingCash).toFixed(2)}`);

describe('a user pin in month 1 makes month 0 save', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('control: with no pin the same persona never ends a month below its floor', () => {
    const { out } = run(false);
    expect(out.converged).toBe(true);
    expect(shortMonths(out)).toEqual([]);
  }, 120_000);

  it('withPaymentOverrides re-runs the month-0 look-ahead, and no month ends below its floor', () => {
    const { out, withPins, cp } = run(true);
    expect(out.converged).toBe(true);
    // The pin really fires in October.
    const pinCardPayments = out.cardProjection.perCardPayments.find(p => p.id === PIN_CARD)!.payments;
    expect(pinCardPayments[PIN_MONTH]).toBeCloseTo(PIN, 2);
    // The look-ahead re-ran: month 0 now holds cash back for the pin, so it pays the cards less
    // than the unpinned plan does. Before the fix both read the same month 0.
    expect(withPins.month0!.safeToPayTotal, `months short: ${shortMonths(out).join(', ') || 'none'}`)
      .toBeLessThan(cp.month0!.safeToPayTotal - 1);
    expect(shortMonths(out)).toEqual([]);
    for (const r of out.projections.data) {
      expect(r.rawEndingCash, r.month).toBeGreaterThanOrEqual(r.rawMonthMinSafe - 0.005);
    }
  }, 120_000);
});
