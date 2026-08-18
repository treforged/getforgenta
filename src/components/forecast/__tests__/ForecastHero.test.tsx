// @vitest-environment jsdom
//
// Slice 5 — what the Forecast hero actually PUTS ON SCREEN.
//
// The selector tests pin which milestone is chosen; this file pins that the chosen one
// renders at hero scale in the right voice, that bad news is not quietly softened, and that
// an empty list renders an action instead of a fabricated month.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ForecastHero from '../ForecastHero';
import type { ForecastMilestone } from '@/lib/next-milestone';

const CC_FREE: ForecastMilestone = { month: 'Jul 2028', event: 'CC Debt Free! 🎉' };
const GOAL: ForecastMilestone = { month: 'Mar 2027', event: 'Emergency Fund Complete! 🎯' };
const NEGATIVE: ForecastMilestone = { month: 'Sep 2026', event: '⚠️ Cash below safe minimum' };

const renderHero = (milestones: ForecastMilestone[] | undefined, emptyReason: 'no-inputs' | 'no-milestones' = 'no-inputs') =>
  render(<MemoryRouter><ForecastHero milestones={milestones} emptyReason={emptyReason} /></MemoryRouter>);

afterEach(cleanup);

describe('ForecastHero — a positive next milestone', () => {
  it('leads with the milestone MONTH at hero scale, event as the label line', () => {
    renderHero([GOAL, CC_FREE]);
    const hero = screen.getByText('Mar 2027');
    expect(hero.className).toContain('text-5xl');
    expect(hero.className).toContain('font-display');
    expect(hero.className).toContain('text-foreground');
    // Gold is money-in-motion and primary actions only.
    expect(hero.className).not.toContain('text-primary');
    expect(screen.getByText('Emergency Fund Complete! 🎯')).toBeTruthy();
    expect(screen.getByText('Next milestone')).toBeTruthy();
  });

  it('gives good news the success voice', () => {
    renderHero([GOAL, CC_FREE]);
    expect(screen.getByText('Emergency Fund Complete! 🎯').parentElement?.className).toContain('text-success');
  });

  it('keeps every remaining milestone reachable under the hero', () => {
    renderHero([GOAL, CC_FREE, NEGATIVE]);
    expect(screen.getByText('Then (2)')).toBeTruthy();
    expect(screen.getByText('Jul 2028: CC Debt Free! 🎉')).toBeTruthy();
    expect(screen.getByText('Sep 2026: ⚠️ Cash below safe minimum')).toBeTruthy();
  });
});

describe('ForecastHero — a negative next milestone', () => {
  it('says the bad news at the SAME prominence, never skipping to a later win', () => {
    renderHero([NEGATIVE, GOAL, CC_FREE]);
    const hero = screen.getByText('Sep 2026');
    expect(hero.className).toContain('text-5xl');
    expect(hero.className).toContain('font-display');
    expect(hero.className).toContain('text-destructive');
    expect(screen.getByText('⚠️ Cash below safe minimum')).toBeTruthy();
    // The later, happier milestone is present but demoted to the strip, not the hero.
    expect(screen.queryByText('Mar 2027')).toBeNull();
    expect(screen.getByText('Mar 2027: Emergency Fund Complete! 🎯')).toBeTruthy();
  });

  it('gives bad news the destructive voice on the supporting line too', () => {
    renderHero([NEGATIVE, GOAL]);
    expect(screen.getByText('⚠️ Cash below safe minimum').parentElement?.className).toContain('text-destructive');
  });
});

describe('ForecastHero — no milestones', () => {
  it('names the one action rather than drawing a blank or fabricated month', () => {
    renderHero([], 'no-inputs');
    expect(screen.getByText('Nothing to project yet')).toBeTruthy();
    expect(screen.getByText(/Add your income and expense rules/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Add income & expenses/ }).getAttribute('href')).toBe('/budget');
    expect(screen.queryByText('Then (0)')).toBeNull();
  });

  it('does not tell a set-up user to add data when the projection simply crosses no line', () => {
    renderHero([], 'no-milestones');
    expect(screen.getByText('No milestones in 60 months')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('handles a missing milestones array the same way — no crash, no fake date', () => {
    renderHero(undefined, 'no-inputs');
    expect(screen.getByText('Nothing to project yet')).toBeTruthy();
  });
});
