import { describe, it, expect } from 'vitest';
import {
  isEnteredSalary, month0ProfilePaycheckIncome, LEGACY_DEFAULT_WEEKLY_GROSS, type Month0RuleLike,
} from '@/lib/month0-profile-paychecks';
import type { PayScheduleConfig } from '@/lib/pay-schedule';

// Weekly on Fridays, $1,000 gross, 20% tax => $800 net. October 2026 has five Fridays: 2, 9, 16, 23, 30.
const payConfig: PayScheduleConfig = { weeklyGross: 1000, taxRate: 20, paycheckDay: 5, frequency: 'weekly' };
const now = new Date(2026, 9, 1, 12);
const liquid = new Set(['chk']);
const run = (over: Partial<Parameters<typeof month0ProfilePaycheckIncome>[0]> = {}) =>
  month0ProfilePaycheckIncome({
    profile: { weekly_gross_income: 1000, onboarding_completed: false },
    rules: [], liquidAccountIds: liquid, payConfig, now, cutoffDate: '2026-10-01', ...over,
  });

describe('month0ProfilePaycheckIncome (ask f16b35ff)', () => {
  it("the 4 real users' shape - entered salary, no income rule - fills month 0 with the remaining paychecks", () => {
    expect(run()).toBe(4000);                              // all five Fridays after Oct 1
    expect(run({ cutoffDate: '2026-10-09' })).toBe(2400);  // the 9th is already in the balance
    expect(run({ cutoffDate: '2026-10-30' })).toBe(0);     // nothing left this month
  });

  it('never double counts: ANY active income rule into cash means the rules carry the income', () => {
    const rule = (over: Partial<Month0RuleLike> = {}): Month0RuleLike => ({ active: true, rule_type: 'income', deposit_account: 'chk', ...over });
    expect(run({ rules: [rule()] })).toBe(0);
    expect(run({ rules: [rule({ deposit_account: null })] })).toBe(0);
    // An inactive rule, or one paying into savings, does not carry checking income.
    expect(run({ rules: [rule({ active: false })] })).toBe(4000);
    expect(run({ rules: [rule({ deposit_account: 'savings-1' })] })).toBe(4000);
    expect(run({ rules: [rule({ rule_type: 'expense' })] })).toBe(4000);
  });

  it('only an ENTERED salary counts: the legacy $1,875 default stays low unless onboarding wrote it', () => {
    expect(isEnteredSalary({ weekly_gross_income: LEGACY_DEFAULT_WEEKLY_GROSS, onboarding_completed: false })).toBe(false);
    expect(isEnteredSalary({ weekly_gross_income: '1875', onboarding_completed: null })).toBe(false);
    expect(isEnteredSalary({ weekly_gross_income: 1875, onboarding_completed: true })).toBe(true);
    expect(isEnteredSalary({ weekly_gross_income: '389.5', onboarding_completed: false })).toBe(true);
    expect(isEnteredSalary({ weekly_gross_income: 0, onboarding_completed: true })).toBe(false);
    expect(isEnteredSalary(null)).toBe(false);
    expect(run({ profile: { weekly_gross_income: 1875, onboarding_completed: false } })).toBe(0);
  });
});
