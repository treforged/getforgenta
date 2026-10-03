// @vitest-environment jsdom
//
// What the overview strip PUTS ON SCREEN.
//
// Two things this file exists for. (1) The strip replaced an eight-tile block on the Accounts
// panel, so every figure that block showed has to still be readable here — a "condense" that
// drops a number is a delete. (2) While the accounts are still loading it must show a shape,
// never a $0.00: a real zero net worth and an unread one are the same pixels.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DashboardOverviewStrip, { type DashboardOverviewStripProps } from '../DashboardOverviewStrip';

const base: DashboardOverviewStripProps = {
  loading: false,
  netWorth: 18400,
  totalAssets: 26000,
  totalLiabilities: 7600,
  liquidCash: 4200,
  investments: 14000,
  retirement: 50000,
  ccDebt: 6976,
  ccLimit: 10290,
};

const renderStrip = (over: Partial<DashboardOverviewStripProps> = {}) =>
  render(<DashboardOverviewStrip {...base} {...over} />);

afterEach(cleanup);

describe('DashboardOverviewStrip — nothing the Accounts tiles showed is lost', () => {
  it('shows all seven figures, with net worth as the headline', () => {
    renderStrip();

    const headline = screen.getByText('$18,400.00');
    expect(headline.className).toContain('text-2xl');
    expect(headline.className).toContain('font-display');

    ['Net Worth', 'Liquid Cash', 'Investments', 'Retirement', 'CC Debt'].forEach(label => {
      expect(screen.getByText(label)).toBeTruthy();
    });
    // Assets and liabilities are demoted to sub-figures, not dropped.
    expect(screen.getByText('$26,000.00')).toBeTruthy();
    expect(screen.getByText('$7,600.00')).toBeTruthy();
    expect(screen.getByText('$4,200.00')).toBeTruthy();
    expect(screen.getByText('$14,000.00')).toBeTruthy();
    expect(screen.getByText('$50,000.00')).toBeTruthy();
    expect(screen.getByText('$6,976.00')).toBeTruthy();
  });

  it('carries credit utilization on the debt tile it is the ratio of', () => {
    renderStrip();
    expect(screen.getByText('67.8% of $10,290')).toBeTruthy();
  });

  it('says there are no limits on file rather than printing 0.0%', () => {
    // A gauge reading 0.0% and a gauge with nothing to read look identical, and only one of
    // them means "you use none of your credit".
    renderStrip({ ccLimit: 0 });
    expect(screen.getByText('no credit limits on file')).toBeTruthy();
    expect(screen.queryByText(/0\.0%/)).toBeNull();
  });

  it('colours a negative net worth as a loss', () => {
    renderStrip({ netWorth: -3200 });
    expect(screen.getByText('-$3,200.00').className).toContain('text-destructive-text');
  });
});

describe('DashboardOverviewStrip — loading is a shape, not a zero', () => {
  it('prints no currency at all while the accounts are still in flight', () => {
    const { container } = renderStrip({ loading: true });
    expect(container.textContent).not.toContain('$');
    expect(screen.queryByText('Net Worth')).toBeNull();
    // Still the strip's own shape: one card, four placeholder tiles beside the headline block.
    expect(container.querySelectorAll('.card-forged')).toHaveLength(1);
  });
});

describe('DashboardOverviewStrip — the drawers the chips used to open', () => {
  it('opens the net worth and liquid cash breakdowns', () => {
    const onNetWorthClick = vi.fn();
    const onLiquidCashClick = vi.fn();
    renderStrip({ onNetWorthClick, onLiquidCashClick });

    fireEvent.click(screen.getByText('Net Worth'));
    fireEvent.click(screen.getByText('Liquid Cash'));

    expect(onNetWorthClick).toHaveBeenCalledTimes(1);
    expect(onLiquidCashClick).toHaveBeenCalledTimes(1);
  });

  it('renders the same figures with no handlers, rather than dead buttons', () => {
    const { container } = renderStrip();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByText('$18,400.00')).toBeTruthy();
    expect(screen.getByText('$4,200.00')).toBeTruthy();
  });
});

// Sam, 2026-10-01: every money figure on the Dashboard must trace to a row the user wrote, or be
// an empty state. With nothing on file the strip used to paint eight confident $0.00 tiles.
describe('DashboardOverviewStrip — nothing on file is an empty state, not $0.00', () => {
  const renderEmpty = (over: Partial<DashboardOverviewStripProps> = {}) => render(
    <MemoryRouter>
      <DashboardOverviewStrip {...base} netWorth={0} totalAssets={0} totalLiabilities={0}
        liquidCash={0} investments={0} retirement={0} ccDebt={0} ccLimit={0} {...over} />
    </MemoryRouter>,
  );

  it('shows no money figure and links to the accounts tab when empty', () => {
    const { container } = renderEmpty({ empty: true });
    expect(container.textContent).not.toMatch(/\$\s?\d/);
    expect(screen.getByText('Nothing on file yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add an account' }).getAttribute('href')).toBe('/dashboard?tab=accounts');
  });

  it('still shows the figures when the same zeros are real (empty is false)', () => {
    const { container } = renderEmpty({ empty: false });
    expect(container.textContent).toMatch(/\$0\.00/);
    expect(screen.queryByText('Nothing on file yet')).toBeNull();
  });

  it('loading wins over empty, so an unread account list never claims "nothing on file"', () => {
    renderEmpty({ empty: true, loading: true });
    expect(screen.queryByText('Nothing on file yet')).toBeNull();
  });
});
