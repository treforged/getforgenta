// Eligibility for the Sean Ellis survey.
//
// ⚠️ THE DST CASE IS THE ONE THAT EARNS ITS KEEP. The free-tier draft of this helper divided
// elapsed milliseconds by 86,400,000. That is 6.958 days across a spring-forward transition, so an
// account created 2026-03-05 and asked on 2026-03-12 reads as SIX days and is silently skipped -
// in every US timezone, for one week a year, with nothing going red. `npm run test:tz` runs this
// file under America/New_York, which is what makes that case discriminating rather than decorative.
//
// Every case passes an explicit `now`, so nothing here depends on the real clock.
import { describe, it, expect } from 'vitest';
import { isEligibleForPmf, MIN_DAYS } from '../pmf-survey';

const base = { onboardingCompleted: true, alreadySeen: false };

describe('isEligibleForPmf', () => {
  it('refuses an account that has already been asked', () => {
    expect(isEligibleForPmf({
      ...base, alreadySeen: true, accountCreatedAt: '2026-01-01T12:00:00Z', now: new Date(2026, 1, 1),
    })).toBe(false);
  });

  it('refuses an account that has not finished onboarding', () => {
    expect(isEligibleForPmf({
      ...base, onboardingCompleted: false, accountCreatedAt: '2026-01-01T12:00:00Z', now: new Date(2026, 1, 1),
    })).toBe(false);
  });

  it('refuses when the creation date is missing - an unknown age is not a qualifying age', () => {
    expect(isEligibleForPmf({ ...base, accountCreatedAt: null, now: new Date(2026, 1, 1) })).toBe(false);
  });

  it('refuses when the creation date cannot be parsed, rather than treating NaN as old enough', () => {
    expect(isEligibleForPmf({ ...base, accountCreatedAt: 'not-a-date', now: new Date(2026, 1, 1) })).toBe(false);
  });

  it(`refuses at ${MIN_DAYS - 1} days`, () => {
    expect(isEligibleForPmf({
      ...base, accountCreatedAt: new Date(2026, 5, 2, 9).toISOString(), now: new Date(2026, 5, 8, 9),
    })).toBe(false);
  });

  it(`admits at exactly ${MIN_DAYS} days - the boundary is inclusive`, () => {
    expect(isEligibleForPmf({
      ...base, accountCreatedAt: new Date(2026, 5, 1, 9).toISOString(), now: new Date(2026, 5, 8, 9),
    })).toBe(true);
  });

  it('admits a long-standing account', () => {
    expect(isEligibleForPmf({
      ...base, accountCreatedAt: new Date(2026, 0, 1, 9).toISOString(), now: new Date(2026, 1, 1, 9),
    })).toBe(true);
  });

  it('counts 7 whole days ACROSS A DST TRANSITION, where millisecond division reads 6.958', () => {
    // 2026-03-08 is spring-forward in the US. Created the 5th, asked the 12th: seven calendar days.
    expect(isEligibleForPmf({
      ...base, accountCreatedAt: new Date(2026, 2, 5, 9).toISOString(), now: new Date(2026, 2, 12, 9),
    })).toBe(true);
  });
});
