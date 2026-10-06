import { describe, it, expect } from 'vitest';
import type { ForecastInputs, ForecastResult } from '@/lib/forecast-engine';
import { payMoreReport, withExtraMonthly } from '@/lib/pay-more-payoff';

const fakeRun = (inputs: ForecastInputs): ForecastResult => {
  const extra = inputs.forecastMonthEvents[1].nonPaycheckIncome;
  const baseIdx = 2029 * 12 + 7;
  const adjustedIdx = baseIdx - Math.floor(extra / 100);
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${monthLabels[adjustedIdx % 12]} ${Math.floor(adjustedIdx / 12)}`;
  return {
    data: [],
    milestones: [{ month: label, event: 'CC Debt Free 🎉' }]
  } as unknown as ForecastResult;
};

const inputsFixture = {
  forecastMonthEvents: [
    { income: 0, nonPaycheckIncome: 0, expenses: 0 },
    { income: 0, nonPaycheckIncome: 0, expenses: 0 },
    { income: 0, nonPaycheckIncome: 0, expenses: 0 }
  ]
} as unknown as ForecastInputs;

describe('payMoreReport', () => {
  it('default amounts -> basePayoff and options', () => {
    const result = payMoreReport(inputsFixture, fakeRun);
    expect(result.basePayoff).toBe('Aug 2029');
    expect(result.options).toEqual([
      { extraMonthly: 100, payoffMonth: 'Jul 2029', monthsSooner: 1 },
      { extraMonthly: 250, payoffMonth: 'Jun 2029', monthsSooner: 2 },
      { extraMonthly: 500, payoffMonth: 'Mar 2029', monthsSooner: 5 }
    ]);
  });

  it('withExtraMonthly modifies future months only', () => {
    const modified = withExtraMonthly(inputsFixture, 100);
    expect(modified.forecastMonthEvents[0]).toBe(inputsFixture.forecastMonthEvents[0]);
    expect(modified.forecastMonthEvents[1].nonPaycheckIncome).toBe(100);
    expect(modified.forecastMonthEvents[2].nonPaycheckIncome).toBe(100);
    // Never mutates the caller's inputs.
    expect(inputsFixture.forecastMonthEvents[1].nonPaycheckIncome).toBe(0);
  });

  it('withExtraMonthly returns same reference for 0', () => {
    expect(withExtraMonthly(inputsFixture, 0)).toBe(inputsFixture);
  });

  it('amount 50 excluded from options', () => {
    const result = payMoreReport(inputsFixture, fakeRun, [50]);
    expect(result.options).toEqual([]);
  });

  it('run with no milestones at any amount returns no options', () => {
    let calls = 0;
    const noMilestonesRun = (): ForecastResult => { calls++; return { data: [], milestones: [] } as unknown as ForecastResult; };
    const result = payMoreReport(inputsFixture, noMilestonesRun);
    expect(result.basePayoff).toBeUndefined();
    expect(result.options).toEqual([]);
    // No base date, so every amount is still tried (1 base + 3 options), and none pays off either.
    expect(calls).toBe(4);
  });

  it('a base that never pays off still reports the extras that CREATE a debt-free month', () => {
    // Never paid off at +$0; from +$250 the fake engine pays off in Dec 2030.
    const run = (i: ForecastInputs): ForecastResult => {
      const extra = i.forecastMonthEvents[1].nonPaycheckIncome;
      return { data: [], milestones: extra >= 250 ? [{ month: 'Dec 2030', event: 'CC Debt Free 🎉' }] : [] } as unknown as ForecastResult;
    };
    expect(payMoreReport(inputsFixture, run)).toEqual({
      basePayoff: undefined,
      options: [
        { extraMonthly: 250, payoffMonth: 'Dec 2030', monthsSooner: null },
        { extraMonthly: 500, payoffMonth: 'Dec 2030', monthsSooner: null },
      ],
    });
  });
});
