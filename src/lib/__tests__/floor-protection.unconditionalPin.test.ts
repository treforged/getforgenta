// @vitest-environment jsdom
//
// AN "ALWAYS PAY THIS" CARD IS A FIXED OBLIGATION, SO THE FLOOR RESERVE MUST PLAN FOR IT.
//
// The setting registers a PIN in the card sim (credit-card-engine.ts, "ALWAYS PAY THIS, NO MATTER
// WHAT IS A PIN, IN EVERY MONTH"): the card's whole balance is paid every month and the save-up cap
// does not stop it. Both floor look-aheads (forecast-engine.ts PASS 2 and useCardProjection's
// runLookAhead) modelled that card at its CONTRACT minimum, so an earlier month spent the cash the
// pin needed and the pin month ended below its floor. Measured 2026-10-04 on Tre's capture: Nov
// 2026 ended $83.39 under its floor, and turning the setting off removed the breach.
//
// SYNTHETIC DATA ONLY: the committed demo persona, reshaped so the pin lands where the reserve has
// to see it coming. The Summit card is shaped like the real one: a $2,000 balance whose last
// statement was only $400, the "statement" preference, $250/mo of card spend and a LOW rate, so the
// avalanche order would never pay it early on its own. Month 0 pays the $400 statement; in month 1
// the pin pays the rest (~$1,600). An October cash bill makes October the tight month, so the
// look-ahead caps it and month 0 has to bank the difference. Without the pin in the reserve, month 0
// sends the cash to the other card and October ends below its floor.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
const PIN_CARD = 'd8';
/** October is month 1 at NOW. */
const BILL_MONTH_INDEX = 1;
const BILL = 1500;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

function run(unconditional: boolean) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = demoAccounts.map(a => a.id !== PIN_CARD ? a : {
    ...a, balance: 2000, statement_balance: 400, statement_balance_phase: true,
    payment_preference: 'statement', payment_unconditional: unconditional, apr: 9.99, payment_due_day: 12,
  });
  const rules = [
    ...demoRecurringRules,
    rule({ id: 'synthetic-card-spend', name: 'Card Spend', amount: 250, rule_type: 'expense', frequency: 'monthly', due_day: 6, category: 'Shopping', payment_source: `account:${PIN_CARD}` }),
    rule({ id: 'synthetic-annual-bill', name: 'Annual Bill', amount: BILL, rule_type: 'expense', frequency: 'yearly', due_day: 20, due_month: 10, category: 'Insurance', payment_source: 'account:d1' }),
  ];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts });
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  // The harness builds the engine's month events from the committed fixture's rules, so the
  // synthetic cash bill is added to its month here - the same dollars the card sim already sees
  // through the persona's scheduled events.
  const forecastMonthEvents = base.forecastMonthEvents.map((e, i) =>
    i === BILL_MONTH_INDEX ? { ...e, expenses: e.expenses + BILL } : e);
  const inputs = { ...base, accounts, forecastMonthEvents } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(cp as unknown as CardProjectionResult, inputs);
  vi.useRealTimers();
  return out;
}

const shortMonths = (out: ReturnType<typeof run>) =>
  out.projections.data
    .filter(r => r.rawEndingCash < r.rawMonthMinSafe - 0.005)
    .map(r => `${r.month} short ${(r.rawMonthMinSafe - r.rawEndingCash).toFixed(2)}`);

describe('floor reserve plans for an always-pay card', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('control: with the setting OFF the same persona never ends a month below its floor', () => {
    const out = run(false);
    expect(out.converged).toBe(true);
    expect(shortMonths(out)).toEqual([]);
  }, 120_000);

  it('with the setting ON every month still ends at or above its own floor', () => {
    const out = run(true);
    expect(out.converged).toBe(true);
    // The pin really fires: October pays the card its whole remaining balance, far above its
    // contract minimum. Without this the green below could come from a pin that did nothing.
    const pinCardPayments = out.cardProjection.perCardPayments.find(p => p.id === PIN_CARD)!.payments;
    expect(pinCardPayments[1]).toBeGreaterThan(1500);
    expect(shortMonths(out)).toEqual([]);
    for (const r of out.projections.data) {
      expect(r.rawEndingCash, r.month).toBeGreaterThanOrEqual(r.rawMonthMinSafe - 0.005);
    }
  }, 120_000);
});
