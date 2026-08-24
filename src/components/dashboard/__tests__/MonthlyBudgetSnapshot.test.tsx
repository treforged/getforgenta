// @vitest-environment jsdom
//
// The two figures the retired stat-chip row used to carry, re-anchored beside the snapshot's
// title (Tre, 2026-08-23): Next Paycheck and Month-End Cash.
//
// Two things this file exists for. (1) Both figures have to be READABLE here, because a
// re-anchor that renders nothing is the same as the delete it was meant to undo, and (2)
// Month-End Cash has to keep its tap-through to the calculator drawer, because a figure the
// user cannot audit is how the old chip row and its drawer drifted apart. The honesty rule gets
// a test each way: no placeholder date, and no fabricated $0.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import MonthlyBudgetSnapshot from '../MonthlyBudgetSnapshot';
import type { Month0Snapshot } from '@/lib/month0-budget-snapshot';

const snapshot: Month0Snapshot = {
  rows: [
    { key: 'balance', label: 'Balance on hand', value: 6200, sign: ' ', tone: 'neutral' },
    { key: 'income', label: 'Income still coming', value: 1875, sign: '+', tone: 'positive' },
    { key: 'expenses', label: 'Bills still coming', value: 2140, sign: '−', tone: 'negative' },
    { key: 'projectedRemaining', label: 'Projected remaining', value: 5935, sign: '=', tone: 'subtotal' },
    { key: 'cashFloor', label: 'Cash floor', value: 3145, sign: '−', tone: 'muted', interactive: true },
    { key: 'availableToDeploy', label: 'Available to deploy', value: 2790, sign: '=', tone: 'positive' },
  ],
  projectedRemaining: 5935,
  availableToDeploy: 2790,
  residual: 0,
  cashFloor: 3145,
  pie: { spentSoFar: 1200, billsAndReserves: 2140, locked: 3145, deployable: 2790, shortfall: 0 },
};

type SnapshotProps = Parameters<typeof MonthlyBudgetSnapshot>[0];

// 2026-09-04 is a Friday, so the format under test reads 'Fri, Sep 4'.
const base: SnapshotProps = {
  snapshot,
  nextPayday: new Date(2026, 8, 4),
  monthEndCash: 4182,
};

const renderSnapshot = (over: Partial<SnapshotProps> = {}) =>
  render(<MonthlyBudgetSnapshot {...base} {...over} />);

afterEach(cleanup);

describe('MonthlyBudgetSnapshot — the two re-anchored chip figures', () => {
  it('shows next paycheck and month-end cash beside the title', () => {
    renderSnapshot();

    expect(screen.getByText('Next Paycheck')).toBeTruthy();
    expect(screen.getByText('Fri, Sep 4')).toBeTruthy();
    expect(screen.getByText('Month-End Cash')).toBeTruthy();
    expect(screen.getByText('$4,182')).toBeTruthy();
    // Sub-figures, not a second headline: the donut centre keeps the card's biggest number.
    expect(screen.getByText('$4,182').className).toContain('text-sm');
  });

  it('colours a month ending short as a loss', () => {
    renderSnapshot({ monthEndCash: -410 });
    expect(screen.getByText('-$410').className).toContain('text-destructive');
  });

  it('leaves the equation and the floor tap-through alone', () => {
    const onFloorClick = vi.fn();
    renderSnapshot({ onFloorClick });

    expect(screen.getByText('Available to deploy')).toBeTruthy();
    fireEvent.click(screen.getByText('Cash floor'));
    expect(onFloorClick).toHaveBeenCalledTimes(1);
  });
});

describe('MonthlyBudgetSnapshot — Month-End Cash stays auditable', () => {
  it('opens the month-end calculator when tapped', () => {
    const onMonthEndClick = vi.fn();
    renderSnapshot({ onMonthEndClick });

    fireEvent.click(screen.getByText('Month-End Cash'));
    expect(onMonthEndClick).toHaveBeenCalledTimes(1);
  });

  it('still prints the figure with no handler, rather than a dead button', () => {
    renderSnapshot();
    expect(screen.getByText('$4,182').closest('button')).toBeNull();
    expect(screen.getByText('$4,182')).toBeTruthy();
  });
});

describe('MonthlyBudgetSnapshot — Next Paycheck taps through', () => {
  it('fires its handler when tapped, the way the retired chip linked to /budget', () => {
    const onPaydayClick = vi.fn();
    renderSnapshot({ onPaydayClick });

    fireEvent.click(screen.getByText('Next Paycheck'));
    expect(onPaydayClick).toHaveBeenCalledTimes(1);
  });

  it('still prints the date with no handler, rather than a dead button', () => {
    renderSnapshot();
    expect(screen.getByText('Fri, Sep 4').closest('button')).toBeNull();
  });
});

describe('MonthlyBudgetSnapshot — absent, never fabricated', () => {
  it('omits Next Paycheck entirely when there is no payday to read', () => {
    renderSnapshot({ nextPayday: null });
    expect(screen.queryByText('Next Paycheck')).toBeNull();
    // The other sub-figure is unaffected.
    expect(screen.getByText('$4,182')).toBeTruthy();
  });

  it('omits Next Paycheck rather than printing an unusable date', () => {
    renderSnapshot({ nextPayday: new Date(NaN) });
    expect(screen.queryByText('Next Paycheck')).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('omits Month-End Cash rather than a confident $0 when there is no reading', () => {
    renderSnapshot({ monthEndCash: null });
    expect(screen.queryByText('Month-End Cash')).toBeNull();
    expect(screen.queryByText('$0')).toBeNull();
    // Still the snapshot: the equation it exists for is untouched.
    expect(screen.getByText('Balance on hand')).toBeTruthy();
  });

  it('renders the header with neither sub-figure when both are absent', () => {
    renderSnapshot({ nextPayday: null, monthEndCash: null });
    expect(screen.getByText('Monthly Budget Snapshot')).toBeTruthy();
    expect(screen.queryByText('Next Paycheck')).toBeNull();
    expect(screen.queryByText('Month-End Cash')).toBeNull();
  });
});
