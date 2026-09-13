// @vitest-environment jsdom
//
// AN ABSENCE MUST SAY WHY, WHEN IT KNOWS WHY.
//
// Measured in a browser 2026-09-13: with an unconditional card overdrawing the month, the
// debt-cash convergence does not settle — five reads over 25 seconds, never a figure. The default
// copy says the plan "hasn't finished calculating", which asks the user to wait for something that
// is never going to arrive.
//
// ⚠️ THE COPY IS THE FIX; THE CONVERGENCE IS NOT FIXED AND NOTHING HERE CLAIMS IT IS. Making the
// fixed point tolerate a deliberate overdraw is real engine work, still open.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DebtHero, { DEBT_HERO_AT_PLAN_ABSENT, DEBT_HERO_AT_PLAN_UNCONDITIONAL } from '../DebtHero';

afterEach(cleanup);

describe('DebtHero — the absent "at plan" reading names its cause when it has one', () => {
  it('names the unconditional payment instead of telling the user to wait', () => {
    render(<DebtHero interestThisMonth={110.78} interestAtPlan={null} unconditionalShortfall />);
    expect(screen.getByText(DEBT_HERO_AT_PLAN_UNCONDITIONAL)).toBeTruthy();
    expect(screen.queryByText(DEBT_HERO_AT_PLAN_ABSENT)).toBeNull();
  });

  it('THE DISCRIMINATING PAIR: the same null reading, no shortfall, keeps the old copy', () => {
    // Without this, copy that always said "a card is set to always pay in full" would pass the
    // test above while being wrong for every ordinary user whose projection is merely still running.
    render(<DebtHero interestThisMonth={110.78} interestAtPlan={null} />);
    expect(screen.getByText(DEBT_HERO_AT_PLAN_ABSENT)).toBeTruthy();
  });

  it('says the payment is still being sent, so the absence does not read as a failure to pay', () => {
    render(<DebtHero interestThisMonth={110.78} interestAtPlan={null} unconditionalShortfall />);
    expect(screen.getByText(/still being sent in full/i)).toBeTruthy();
  });

  it('shows the FIGURE when there is one, shortfall or not — the flag only governs the absence', () => {
    render(<DebtHero interestThisMonth={110.78} interestAtPlan={112.11} unconditionalShortfall />);
    expect(screen.getByText(/112/)).toBeTruthy();
    expect(screen.queryByText(DEBT_HERO_AT_PLAN_UNCONDITIONAL)).toBeNull();
  });

  it('NEVER renders $0 for an absent reading — a zero and a failed read must not look alike', () => {
    render(<DebtHero interestThisMonth={110.78} interestAtPlan={null} unconditionalShortfall />);
    expect(screen.queryByText(/at plan:\s*\$0/i)).toBeNull();
  });
});
