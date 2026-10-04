// @vitest-environment jsdom
//
// A PAYMENT THE USER PINS TO A MONTH IS A FIXED OBLIGATION, SO THE FLOOR RESERVE MUST PLAN FOR IT.
// Ask f077f9bb (the residue c879c73f named and left).
//
// A user pin on /debt (CreditCardEngine's per-month override -> `withPaymentOverrides` ->
// `paymentOverridesByMonth`) makes the sim pay exactly that amount, outside the save-up cap. The
// floor look-ahead modelled the card at its contract minimum, so the months before the pin spent
// the cash it needed and the pin month ended below its floor - the same defect the always-pay
// setting had before c879c73f.
//
// SYNTHETIC DATA ONLY: the committed demo persona with a heavier card, a yearly cash bill in
// December, and the user pinning $1,500 to that card in the same December. Measured before the
// fix: December ended $1,284.88 under its floor; with no pin, no month was short.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
const PIN_CARD = 'd7';
/** December is month 3 at NOW. */
const PIN_MONTH = 3;
const PIN = 1500;
const BILL = 1500;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

function run(pinned: boolean) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // A balance the cards cannot clear before December, so the pin pays real revolving debt rather
  // than clamping to a small cycling statement.
  const accounts = demoAccounts.map(a => a.id !== PIN_CARD ? a : { ...a, balance: 11000, balance_tranches: [] });
  const rules = [
    ...demoRecurringRules,
    rule({ id: 'synthetic-annual-bill', name: 'Annual Bill', amount: BILL, rule_type: 'expense', frequency: 'yearly', due_day: 20, due_month: 12, category: 'Insurance', payment_source: 'account:d1' }),
  ];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts }) as unknown as CardProjectionResult;
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  const forecastMonthEvents = base.forecastMonthEvents.map((e, i) =>
    i === PIN_MONTH ? { ...e, expenses: e.expenses + BILL } : e);
  // The production shape (CreditCardEngine's overrideData): the pins baked into the base sim and
  // its resim closure, then the same convergence loop the unpinned view runs.
  const withPins = cp.withPaymentOverrides!(pinned ? { [PIN_CARD]: { [PIN_MONTH]: PIN } } : {});
  const inputs = { ...base, accounts, forecastMonthEvents, cardProjectionData: withPins } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(withPins, inputs);
  vi.useRealTimers();
  return out;
}

const shortMonths = (out: ReturnType<typeof run>) =>
  out.projections.data
    .filter(r => r.rawEndingCash < r.rawMonthMinSafe - 0.005)
    .map(r => `${r.month} short ${(r.rawMonthMinSafe - r.rawEndingCash).toFixed(2)}`);

describe('floor reserve plans for a user-pinned payment', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('control: with no pin the same persona never ends a month below its floor', () => {
    const out = run(false);
    expect(out.converged).toBe(true);
    expect(shortMonths(out)).toEqual([]);
  }, 120_000);

  it('with $1,500 pinned to December every month still ends at or above its own floor', () => {
    const out = run(true);
    expect(out.converged).toBe(true);
    // The pin really fires: December pays the card exactly the pinned $1,500. Without this the
    // green below could come from a pin the convergence loop dropped.
    const pinCardPayments = out.cardProjection.perCardPayments.find(p => p.id === PIN_CARD)!.payments;
    expect(pinCardPayments[PIN_MONTH]).toBeCloseTo(PIN, 2);
    expect(shortMonths(out)).toEqual([]);
    for (const r of out.projections.data) {
      expect(r.rawEndingCash, r.month).toBeGreaterThanOrEqual(r.rawMonthMinSafe - 0.005);
    }
  }, 120_000);
});
