// @vitest-environment jsdom
//
// Slice 2 — what the hero actually PUTS ON SCREEN in each state.
//
// The selector tests pin which state is chosen; this file pins that the chosen state
// renders the right words and, crucially, that the two states with no number render an
// action instead of a $0 or a fabricated date. A green typecheck says the JSX compiled; it
// says nothing about whether the empty state is honest, so that is asserted here.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DashboardHero from '../DashboardHero';
import { selectRevolvingPayoff, type DashboardHeroState } from '@/lib/payoff-summary';

const ASOF = new Date(2026, 7, 14); // 2026-08-14

const renderHero = (state: DashboardHeroState) =>
  render(<MemoryRouter><DashboardHero state={state} /></MemoryRouter>);

afterEach(cleanup);

describe('DashboardHero — debt + data', () => {
  const payoff = selectRevolvingPayoff({
    simRevolvingPayoffMonth: 24, forecastRevolvingPayoffMonth: null,
  }, ASOF)!;

  it('leads with the payoff MONTH at hero scale, with the count as the supporting line', () => {
    renderHero({ kind: 'payoff', payoff, cashAboveFloor: 412 });
    const hero = screen.getByText('Jul 2028');
    expect(hero.className).toContain('text-5xl');
    expect(hero.className).toContain('font-display');
    // Gold is for money-in-motion and primary actions; the hero number is foreground.
    expect(hero.className).toContain('text-foreground');
    expect(hero.className).not.toContain('text-primary');
    expect(screen.getByText(/23 months away/)).toBeTruthy();
    expect(screen.getByText('Debt free')).toBeTruthy();
  });

  it('renders cash above the floor as the second read', () => {
    renderHero({ kind: 'payoff', payoff, cashAboveFloor: 412 });
    expect(screen.getByText('$412 above your floor')).toBeTruthy();
  });

  it('says BELOW the floor when the floor is being dipped into', () => {
    renderHero({ kind: 'payoff', payoff, cashAboveFloor: -310 });
    expect(screen.getByText('$310 below your floor')).toBeTruthy();
  });

  it('omits the second read entirely when there is no floor reading — no $0', () => {
    renderHero({ kind: 'payoff', payoff, cashAboveFloor: null });
    expect(screen.queryByText(/your floor/)).toBeNull();
    expect(screen.queryByText('$0 above your floor')).toBeNull();
  });

  it('says "This month" rather than "0 months away"', () => {
    const now = selectRevolvingPayoff({ simRevolvingPayoffMonth: 1, forecastRevolvingPayoffMonth: null }, ASOF)!;
    renderHero({ kind: 'payoff', payoff: now, cashAboveFloor: 100 });
    expect(screen.getByText(/This month/)).toBeTruthy();
  });
});

describe('DashboardHero — no debt', () => {
  it('makes cash above the floor the hero, labelled "You\'re debt free"', () => {
    renderHero({ kind: 'cash', cashAboveFloor: 1240, carriesCardBalance: false });
    expect(screen.getByText("You're debt free")).toBeTruthy();
    const hero = screen.getByText('$1,240');
    expect(hero.className).toContain('text-5xl');
    expect(screen.getByText('above your cash floor')).toBeTruthy();
    expect(screen.getByText('No credit card balances')).toBeTruthy();
  });

  it('does not claim "debt free" for a card that is merely paid in full each cycle', () => {
    renderHero({ kind: 'cash', cashAboveFloor: 1240, carriesCardBalance: true });
    expect(screen.queryByText("You're debt free")).toBeNull();
    expect(screen.getByText('No interest to pay')).toBeTruthy();
    expect(screen.getByText('Your cards clear each month — nothing revolving')).toBeTruthy();
  });
});

describe('DashboardHero — no data', () => {
  it('names the one action that fills it, and shows no number at all', () => {
    const { container } = renderHero({ kind: 'empty', reason: 'no-accounts' });
    expect(screen.getByText('Nothing to read yet')).toBeTruthy();
    expect(screen.getByText('Connect a bank or add an account and your debt-free date lands here.')).toBeTruthy();
    const action = screen.getByRole('link', { name: /Add an account/ });
    expect(action.getAttribute('href')).toBe('/accounts');
    // Nothing in the empty hero may look like a reading.
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.querySelector('.text-5xl')).toBeNull();
  });

  it('says it is still working rather than showing a placeholder date', () => {
    const { container } = renderHero({ kind: 'empty', reason: 'projecting' });
    expect(screen.getByText('Working it out')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$/);
  });

  it('says plainly when the plan does not clear inside the projection', () => {
    renderHero({ kind: 'empty', reason: 'no-payoff-in-range' });
    expect(screen.getByText('Not within 5 years')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review the plan/ }).getAttribute('href')).toBe('/debt');
  });

  it('asks for a budget when there is no floor to measure against', () => {
    renderHero({ kind: 'empty', reason: 'no-reading' });
    expect(screen.getByText('No reading yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Set up your budget/ }).getAttribute('href')).toBe('/budget');
  });
});
