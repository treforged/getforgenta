// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BudgetTotalsCard, { sharedFigureClass } from '../BudgetTotalsCard';

const rule = (id: string, name: string, amount: number) => ({ id, name, amount, active: true });

vi.mock('@/hooks/useBudgetMonthTotals', () => ({
  useBudgetMonthTotals: () => ({
    buckets: {
      incomeRules: [rule('i1', 'Side gig', 100)],
      fixedRules: [rule('f1', 'Rent', 1000), rule('f2', 'Phone', 50)],
      variableRules: [rule('v1', 'Food', 400)],
      debtRules: [rule('d1', 'Card', 25)],
      transferRules: [],
    },
    totals: { income: 3000, fixed: 1050, variable: 400, debt: 25, transfers: 0, expenses: 1475 },
    toCurrentMonthAmount: (r: { amount: number }) => r.amount,
  }),
}));
vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { weekly_gross_income: 1000 } }),
  useRecurringRules: () => ({ data: [] }),
  useAccounts: () => ({ data: [] }),
}));
vi.mock('@/hooks/useEffectiveSalaryProfile', () => ({ useEffectiveSalaryProfile: (p: unknown) => p }));
vi.mock('@/lib/pay-schedule', () => ({
  buildPayConfig: () => ({ frequency: 'weekly', weeklyGross: 1000, taxRate: 10, preTaxDeductions: 0, postTaxDeductions: 0 }),
  getPaycheckNet: () => 900,
  getPaychecksInMonth: () => [1, 2, 3, 4],
}));
vi.mock('@/components/shared/CalcDrawer', () => ({
  default: ({ open, title }: { open: boolean; title: string }) => (open ? <div data-testid="drawer">{title}</div> : null),
}));

const mount = () => render(<MemoryRouter><BudgetTotalsCard /></MemoryRouter>);

describe('BudgetTotalsCard', () => {
  it('keeps all seven tiles, every figure with cents, and the "planned" label', () => {
    mount();
    expect(screen.getAllByRole('button')).toHaveLength(7);
    for (const fig of ['$3,000.00', '$1,050.00', '$400.00', '$25.00', '$0.00', '$1,475.00', '$17,700.00']) {
      expect(screen.getByText(fig)).toBeTruthy();
    }
    expect(screen.getByText('planned (from rules)')).toBeTruthy();
  });

  it('pressing the chart glyph (or anywhere on the tile) opens that tile\'s drawer', () => {
    mount();
    expect(screen.queryByTestId('drawer')).toBeNull();
    const fixed = screen.getByRole('button', { name: /^Fixed Expenses/ });
    fireEvent.click(fixed.querySelector('[data-testid="budget-tile-glyph"]')!);
    expect(screen.getByTestId('drawer').textContent).toBe('Fixed Expenses This Month');
    fireEvent.click(screen.getByRole('button', { name: /^Annual Spend/ }));
    expect(screen.getByTestId('drawer').textContent).toBe('Annual Spend Breakdown (× 12)');
  });

  it('counts the active rows behind each tile', () => {
    mount();
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.getAllByText('1 item')).toHaveLength(2);
    expect(screen.getByText('0 items')).toBeTruthy();
  });

  it('shares one figure size, stepped by the longest value', () => {
    expect(sharedFigureClass(['$1.00', '$55,080.00'])).toBe(sharedFigureClass(['$55,080.00']));
    expect(sharedFigureClass(['$5.00'])).toContain('text-xl');
    expect(sharedFigureClass(['$55,080.00'])).toContain('text-lg');
    expect(sharedFigureClass(['$1,055,080.00'])).toContain('text-base');
  });
});
