// @vitest-environment jsdom
//
// THE DEMO PERSONA CAN BE HELPED: ITS CARDS CLEAR INSIDE FIVE YEARS AND MONTH 0 ENDS ABOVE THE FLOOR.
//
// Ask 43591a28, 2026-09-23. /demo is a prospect's first screen and the only source for store images.
// It opened on "YOUR CARD PAYOFF DATE: Not within 5 years" and "Cash below safe minimum", while
// `demo-marketing-lines.engine.test.ts` stayed green and quoted "clears in Dec 2027".
//
// ⚠️ WHY THAT GREEN WAS BLIND, AND WHY THIS FILE DOES NOT USE THE SAME HARNESS. The marketing harness
// calls `useCardProjection` with `debts: []`, `goals: []`, `carFunds: []` and `transactions: []`. The
// app passes all four (`useSupabaseData` returns the demo arrays in demo mode). Car funds alone were
// enough to stop the cards clearing. So this file passes the SAME inputs the app passes, mapped the
// way `useSupabaseData` maps them.
//
// ⚠️ AND IT RE-IMPORTS THE FIXTURE PER DATE. demo-data.ts computes every date at IMPORT time from the
// wall clock (`d(day, monthOffset)`), so setting a fake clock after import leaves the fixture on the
// real date. The app always imports on the day it runs, so each date here resets the module registry
// after setting the clock. That is what makes a two-year sweep mean what /demo would show that day.
//
// It covers the card simulation's month 0 and its revolving payoff month, which are the two numbers
// the Dashboard's payoff card and Safe to Pay read. It does NOT cover the Forecast page's milestone
// list, the Garage, or any rendered frame.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '@/hooks/useCardProjection';
import { generateScheduledEvents, PROJECTION_MONTHS, toLocalDateStr } from '@/lib/scheduling';
import { DEMO_ASSUMPTIONS, DEMO_FUNDING_ACCOUNT_ID } from './fixtures/demo-forecast-harness';

/** "Within 5 years" is the Dashboard's own horizon: `aggregatePayoffEta` reads a 60-month sim. */
const MAX_PAYOFF_MONTHS = 60;

/** Two dates in each of the next twelve months: the 2nd (before most bills) and the 23rd (after). */
function sweepDates(): Date[] {
  const out: Date[] = [];
  for (let k = 0; k < 12; k++) {
    for (const day of [2, 23]) out.push(new Date(2026, 8 + k, day, 12));
  }
  return out;
}

const asRows = <T,>(arr: readonly T[]) =>
  arr.map((x, i) => ({ ...(x as object), id: (x as { id?: string }).id ?? String(i), user_id: 'demo', created_at: '', updated_at: '' }));

/** The demo's card simulation for one date, on the app's own inputs. */
async function demoAsTheAppRunsIt(now: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetModules();
  const D = await import('@/lib/demo-data');
  const accounts = D.demoAccounts as never[];
  const rules = D.demoRecurringRules as never[];
  const projection = renderHook(() => useCardProjection({
    accounts,
    rules,
    transactions: asRows(D.demoTransactions).map(t => ({ ...t, payment_source: (t as { payment_source?: string }).payment_source || 'bank_account' })),
    debts: asRows(D.demoDebts).map(d => ({ ...d, credit_limit: (d as { credit_limit?: number }).credit_limit || 0 })),
    goals: asRows(D.demoSavingsGoals),
    carFunds: asRows(D.demoCarFunds),
    profile: { ...D.demoProfile, paycheck_deductions: [] },
    debtPayoffOptions: { cashFloor: D.demoProfile.cash_floor },
    payConfig: {
      weeklyGross: D.demoProfile.weekly_gross_income,
      taxRate: D.demoProfile.tax_rate,
      paycheckDay: D.demoProfile.paycheck_day,
      frequency: 'weekly',
    },
    scheduledEvents: generateScheduledEvents(rules, accounts, PROJECTION_MONTHS, now),
    pauseSavings: false,
    forecastFundingAccountId: DEMO_FUNDING_ACCOUNT_ID,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEMO_ASSUMPTIONS,
    syncCutoffDate: toLocalDateStr(now),
    paymentPlans: [],
  } as unknown as UseCardProjectionParams)).result.current as unknown as {
    simRevolvingPayoffMonth: number | null;
    month0?: { endCash: number };
  };
  return { projection, floor: D.demoProfile.cash_floor, carFunds: D.demoCarFunds.length };
}

describe('the demo persona is someone the app can help', () => {
  afterEach(() => vi.useRealTimers());

  it('control: the sweep reads the fixture the app reads (car funds are present)', async () => {
    // Every absence below is only evidence if the inputs that caused the defect are in the run.
    const { carFunds } = await demoAsTheAppRunsIt(new Date(2026, 8, 23, 12));
    expect(carFunds).toBeGreaterThan(0);
  });

  it(`clears the cards inside ${MAX_PAYOFF_MONTHS} months, and month 0 ends at or above the floor, on every date`, async () => {
    const failures: string[] = [];
    const payoffs: number[] = [];
    for (const now of sweepDates()) {
      const { projection, floor } = await demoAsTheAppRunsIt(now);
      const day = toLocalDateStr(now);
      const payoff = projection.simRevolvingPayoffMonth;
      if (payoff == null || payoff > MAX_PAYOFF_MONTHS) failures.push(`${day}: payoff ${payoff ?? 'never'}`);
      else payoffs.push(payoff);
      const endCash = projection.month0?.endCash;
      if (endCash == null) failures.push(`${day}: no month 0`);
      else if (endCash < floor) failures.push(`${day}: month 0 ends at ${endCash.toFixed(2)}, below the ${floor} floor`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
    // All 24 dates were measured, so a silent skip cannot pass.
    expect(payoffs.length).toBe(24);
  }, 120_000);
});
