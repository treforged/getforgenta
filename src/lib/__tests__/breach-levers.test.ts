import { describe, it, expect } from 'vitest';
import { rankBreachLevers, shortfallByMonth } from '@/lib/breach-levers';
import type { ForecastInputs, ForecastResult } from '@/lib/forecast-engine';

// A fake engine with known arithmetic: every month's cash is the floor (100) plus 300, minus every
// active goal contribution and every funding-account transfer. Removing the 'Payoff anchor'
// transfer moves card payoff one month LATER, standing in for a lever that adds interest.
const FUND = 'chk';
const MONTH_LABELS = ['Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026'];

function fakeRun(inputs: ForecastInputs): ForecastResult {
  const goals = inputs.goals as Record<string, unknown>[];
  const rules = inputs.rules as unknown as Record<string, unknown>[];
  const out = goals.reduce((s, g) => s + Number(g.monthly_contribution ?? 0), 0)
    + rules.filter(r => r.active !== false && (r.rule_type === 'transfer' || r.rule_type === 'investment'))
      .reduce((s, r) => s + Number(r.amount), 0);
  const anchorGone = !rules.some(r => r.name === 'Payoff anchor');
  return {
    data: MONTH_LABELS.map(month => ({ month, endingCash: 400 - out, monthMinSafe: 100 })),
    milestones: [{ month: anchorGone ? 'Oct 2029' : 'Sep 2029', event: 'CC Debt Free 🎉' }],
  } as unknown as ForecastResult;
}

function inputs(): ForecastInputs {
  return {
    forecastFundingAccountId: FUND,
    accounts: [
      { id: FUND, account_type: 'checking' },
      { id: 'sav', account_type: 'savings' },
      { id: 'k401', account_type: '401k' },
      { id: 'biz', account_type: 'business_checking' },
    ],
    goals: [
      { id: 'g1', name: 'Move fund', monthly_contribution: 50, auto_extra: true, linked_account: 'sav' },
      { id: 'g2', name: '401K Roth', monthly_contribution: 300, linked_account: 'k401' },
      { id: 'g3', name: 'Ruled goal', monthly_contribution: 10, linked_account: 'sav', linked_rule_ids: ['x'] },
      { id: 'g4', name: 'Idle', monthly_contribution: 0, auto_extra: false },
    ],
    rules: [
      { id: 'r1', name: 'Owners Contribution', rule_type: 'transfer', amount: 145, payment_source: FUND, deposit_account: 'biz' },
      { id: 'r2', name: 'Claude', rule_type: 'expense', amount: 100, payment_source: 'biz' },
      { id: 'r3', name: 'Payoff anchor', rule_type: 'transfer', amount: 5, payment_source: FUND, deposit_account: 'sav' },
      { id: 'r4', name: 'IRA push', rule_type: 'investment', amount: 40, payment_source: FUND, deposit_account: 'k401' },
      { id: 'r5', name: 'From savings', rule_type: 'transfer', amount: 30, payment_source: 'sav', deposit_account: 'biz' },
      { id: 'r6', name: 'Stopped', rule_type: 'transfer', amount: 999, active: false, payment_source: FUND },
    ],
  } as unknown as ForecastInputs;
}

describe('rankBreachLevers', () => {
  it('ranks by measured dollars covered and names what each transfer still has to pay', () => {
    // Out = 50+300+10 (goals) + 145+5+40+30 (transfers) = 580 -> each month 280 short (cash 400 - out vs floor 100), 3 months.
    const r = rankBreachLevers(inputs(), fakeRun);
    expect(r.months.map(m => m.shortfall)).toEqual([280, 280, 280]);
    expect(r.totalShortfall).toBe(840);
    expect(r.levers.map(l => [l.name, l.coveredDollars, l.shortfallAfter])).toEqual([
      ['Owners Contribution', 435, 405],
      ['Move fund', 150, 690],
    ]);
    expect(r.levers[0].paysRules).toEqual(['Claude']);
    expect(r.levers[0].kind).toBe('pause_transfer');
    expect(r.levers[1].kind).toBe('pause_goal');
  });

  it('never offers retirement, rule-funded goals, other accounts, or a lever that delays payoff', () => {
    const r = rankBreachLevers(inputs(), fakeRun);
    const offered = r.levers.map(l => l.name);
    for (const name of ['401K Roth', 'IRA push', 'Ruled goal', 'From savings', 'Payoff anchor', 'Stopped', 'Idle']) {
      expect(offered).not.toContain(name);
    }
    expect(r.excluded).toEqual(expect.arrayContaining([
      { name: '401K Roth', reason: 'retirement' },
      { name: 'IRA push', reason: 'retirement' },
      { name: 'Ruled goal', reason: 'funded_by_rule' },
      { name: 'From savings', reason: 'not_from_funding_account' },
      { name: 'Payoff anchor', reason: 'delays_debt_payoff' },
    ]));
  });

  it('reports the months a lever clears, and none when it only narrows the gap', () => {
    const inp = inputs();
    (inp.goals as Record<string, unknown>[])[1].monthly_contribution = 100; // out 380 -> 80 short a month
    const r = rankBreachLevers(inp, fakeRun);
    expect(r.levers.map(l => [l.name, l.coveredDollars, l.shortfallAfter, l.monthsCleared])).toEqual([
      ['Owners Contribution', 240, 0, ['Oct 2026', 'Nov 2026', 'Dec 2026']],
      ['Move fund', 150, 90, []],
    ]);
  });

  it('does not mutate the inputs it was given', () => {
    const inp = inputs();
    const before = JSON.stringify(inp);
    rankBreachLevers(inp, fakeRun);
    expect(JSON.stringify(inp)).toBe(before);
  });

  it('returns an empty report and runs the engine once when nothing is short', () => {
    let calls = 0;
    const flush = (i: ForecastInputs) => { calls++; return { ...fakeRun(i), data: fakeRun(i).data.map(d => ({ ...d, endingCash: 500 })) } as ForecastResult; };
    expect(rankBreachLevers(inputs(), flush)).toEqual({ months: [], totalShortfall: 0, levers: [], excluded: [] });
    expect(calls).toBe(1);
  });

  it('skips month 0 and respects the horizon', () => {
    const res = fakeRun(inputs());
    expect(shortfallByMonth(res, 12).map(m => m.month)).toEqual(['Oct 2026', 'Nov 2026', 'Dec 2026']);
    expect(shortfallByMonth(res, 2).map(m => m.month)).toEqual(['Oct 2026', 'Nov 2026']);
  });
});
