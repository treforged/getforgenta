// Slice 2 — the demoted stat chips.
//
// Two things are worth pinning: (1) every figure the three MetricCard grids used to show is
// still present, because the demotion must not quietly delete information; (2) a chip with
// no reading shows '—' and never a formatted zero (DIRECTION.md rule 3).
import { describe, it, expect, vi } from 'vitest';
import { buildDashboardChips, CHIP_WIDGET_IDS, type DashboardChipInput } from '@/lib/dashboard-chips';

const noop = () => {};

const base: DashboardChipInput = {
  rulesLoading: false,
  goalsLoading: false,
  paycheckNet: 2100,
  nextPayday: new Date(2026, 7, 21),
  billsThisWeek: { total: 340, count: 3 },
  billsThisMonth: { total: 1980, count: 11 },
  monthEndCash: 1650,
  liquidCash: 4200,
  income: 5400,
  expenses: 3100,
  debtService: 820,
  netWorth: 18400,
  totalAssets: 26000,
  savingsRate: 27.4,
  cashFlow: 1480,
  utilization: 67.8,
  ccDebt: 6976,
  ccLimit: 10290,
  totalSaved: 9200,
  goalCount: 4,
  openMonthEndCalc: noop,
  openLiquidCashCalc: noop,
  openIncomeCalc: noop,
  openExpenseCalc: noop,
  openNetWorthCalc: noop,
};

const flat = (input: DashboardChipInput) => {
  const groups = buildDashboardChips(input);
  return CHIP_WIDGET_IDS.flatMap(id => groups[id]);
};

const byId = (input: DashboardChipInput, id: string) => {
  const chip = flat(input).find(c => c.id === id);
  if (!chip) throw new Error(`no chip ${id}`);
  return chip;
};

describe('buildDashboardChips — nothing is lost in the demotion', () => {
  it('still carries all twelve figures the three grids showed', () => {
    const chips = flat(base);
    expect(chips).toHaveLength(12);
    expect(chips.map(c => c.id)).toEqual([
      'next_paycheck', 'bills_week', 'bills_month', 'month_end_cash',
      'liquid_cash', 'income', 'expenses', 'debt_service',
      'net_worth', 'savings_rate', 'utilization', 'total_saved',
    ]);
  });

  it('gives every chip a destination — a drawer opener or a route', () => {
    for (const chip of flat(base)) {
      expect(Boolean(chip.onClick || chip.to), `${chip.id} has nowhere to go`).toBe(true);
    }
  });

  it('routes the drawer chips to the openers the MetricCards used', () => {
    const openMonthEndCalc = vi.fn();
    const openExpenseCalc = vi.fn();
    const input = { ...base, openMonthEndCalc, openExpenseCalc };
    byId(input, 'month_end_cash').onClick!();
    byId(input, 'expenses').onClick!();
    byId(input, 'debt_service').onClick!();
    expect(openMonthEndCalc).toHaveBeenCalledTimes(1);
    // Option B: expenses and debt service are halves of one chain and share a drawer.
    expect(openExpenseCalc).toHaveBeenCalledTimes(2);
  });
});

describe('buildDashboardChips — never a confident zero', () => {
  it('shows a dash, not $0, for bills while the rules are still loading', () => {
    const input = { ...base, rulesLoading: true, billsThisWeek: { total: 0, count: 0 }, billsThisMonth: { total: 0, count: 0 } };
    expect(byId(input, 'bills_week').value).toBe('—');
    expect(byId(input, 'bills_month').value).toBe('—');
    expect(byId(input, 'bills_week').sub).toBe('loading…');
  });

  it('shows a dash, not 0.0%, for utilization when no credit limits are on file', () => {
    const input = { ...base, utilization: 0, ccLimit: 0 };
    expect(byId(input, 'utilization').value).toBe('—');
    expect(byId(input, 'utilization').sub).toBe('no credit limits on file');
  });

  it('shows a real ratio when limits ARE on file', () => {
    expect(byId(base, 'utilization').value).toBe('67.8%');
  });

  it('shows a dash for income, expenses and debt service when there is nothing recorded', () => {
    const input = { ...base, income: 0, expenses: 0, debtService: 0 };
    expect(byId(input, 'income').value).toBe('—');
    expect(byId(input, 'expenses').value).toBe('—');
    expect(byId(input, 'debt_service').value).toBe('—');
    expect(byId(input, 'savings_rate').value).toBe('—');
  });

  it('shows a dash, not $0, for total saved while goals are loading', () => {
    const input = { ...base, goalsLoading: true, totalSaved: 0, goalCount: 0 };
    expect(byId(input, 'total_saved').value).toBe('—');
  });

  it('does NOT dash a genuine zero net worth — that is a real reading', () => {
    expect(byId({ ...base, netWorth: 0 }, 'net_worth').value).toBe('$0');
  });
});
