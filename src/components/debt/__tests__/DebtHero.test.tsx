// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DebtHero, { DEBT_HERO_AT_PLAN_ABSENT } from '../DebtHero';

// The hero is the whole point of the /debt redesign, and its one hard rule is that the "at plan"
// half is ABSENT rather than $0 when there is no converged plan — a gauge reading zero and a gauge
// that failed to read must never look the same. These render the component and read the DOM,
// because "the selector returns null" and "the screen shows no number" are different claims.

afterEach(cleanup);

describe('DebtHero', () => {
  it('leads with this month\'s interest at hero scale', () => {
    const { container } = render(<DebtHero interestThisMonth={142.31} interestAtPlan={98.2} />);
    const hero = container.querySelector('.text-5xl, .sm\\:text-5xl');
    expect(hero).not.toBeNull();
    expect(hero!.textContent).toBe('$142.31');
    expect(hero!.className).toContain('font-display');
    // Gold is for money in motion and primary actions — the hero number is foreground.
    expect(hero!.className).toContain('text-foreground');
    expect(hero!.className).not.toContain('text-gold');
  });

  it('shows the at-plan figure as the second line when there is a reading', () => {
    render(<DebtHero interestThisMonth={142.31} interestAtPlan={98.2} />);
    expect(screen.getByText(/at plan:/).textContent).toContain('$98.20');
    expect(screen.queryByText(DEBT_HERO_AT_PLAN_ABSENT)).toBeNull();
  });

  it('renders the absence — and NO dollar figure — when there is no plan reading', () => {
    render(<DebtHero interestThisMonth={142.31} interestAtPlan={null} />);
    expect(screen.getByText(DEBT_HERO_AT_PLAN_ABSENT)).toBeTruthy();
    expect(screen.queryByText(/at plan: \$/)).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('still prints a true $0 at plan as a number', () => {
    render(<DebtHero interestThisMonth={0} interestAtPlan={0} />);
    expect(screen.getByText(/at plan:/).textContent).toContain('$0.00');
    expect(screen.queryByText(DEBT_HERO_AT_PLAN_ABSENT)).toBeNull();
  });
});
