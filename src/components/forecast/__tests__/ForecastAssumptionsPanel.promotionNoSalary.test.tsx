// @vitest-environment jsdom
//
// A PROMOTION WITH NO SALARY SET CHANGES NOTHING, SO THE PANEL MUST SAY SO (2026-09-30).
// The engine scales pay by newSalary / currentSalary and skips that when the current salary is 0
// (forecast-engine.ts, the promotion loop). Since 59c3fb37 an unset salary is 0 rather than a
// phantom $1,875/week, so this state is now reachable by every user who never entered pay.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('@/components/forecast/ForecastYearlySummary', () => ({ default: () => null }));

import ForecastAssumptionsPanel from '../ForecastAssumptionsPanel';

type Props = ComponentProps<typeof ForecastAssumptionsPanel>;

const ASSUMPTIONS = {
  incomeGrowthEnabled: true, incomeGrowth: 3, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 7, savingsInterest: 4.5,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [{ id: 'p1', effectiveDate: '2027-01-01', newAnnualSalary: 90000 }],
} as Props['assumptions'];

function renderPanel(weeklyGross: number, promotions = ASSUMPTIONS.promotions) {
  const payConfig = { weeklyGross, taxRate: 22, paycheckDay: 5, frequency: 'weekly' } as unknown as Props['payConfig'];
  return render(
    <ForecastAssumptionsPanel
      assumptions={{ ...ASSUMPTIONS, promotions }}
      setAssumptions={vi.fn()}
      payConfig={payConfig}
      annualFederalWithheldFromBudget={0}
      onClose={vi.fn()}
    />,
  );
}

const WARNING = /no salary is set, so a promotion cannot change your forecast/i;
const HINT = /snaps your projected salary to the new amount/i;

afterEach(cleanup);

describe('ForecastAssumptionsPanel promotions', () => {
  it('warns, and hides the "snaps your salary" hint, when no salary is set', () => {
    renderPanel(0);
    expect(screen.getByText(WARNING)).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows the usual hint and no warning when a salary is set', () => {
    renderPanel(1000);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('shows neither when there are no promotions', () => {
    renderPanel(0, []);
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
