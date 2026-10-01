import { describe, it, expect } from 'vitest';
import {
  isEnteredSalary, month0ProfilePaycheckIncome, withEffectiveSalary, LEGACY_DEFAULT_WEEKLY_GROSS, type Month0RuleLike,
} from '@/lib/month0-profile-paychecks';
import { buildPayConfig, getMonthNetIncome, type PayScheduleConfig } from '@/lib/pay-schedule';

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

describe('withEffectiveSalary (legacy $1,875 in months 1+)', () => {
  // The two real users' shape: never onboarded, the old column default, no income rule.
  const legacy = { weekly_gross_income: 1875, onboarding_completed: false, paycheck_frequency: 'weekly', tax_rate: 22 };
  const cashRule: Month0RuleLike = { active: true, rule_type: 'income', deposit_account: 'chk' };
  // Month 3 from October 2026 = December 2026 (index 11).
  const dec = (p: unknown) => getMonthNetIncome(buildPayConfig(p as Parameters<typeof buildPayConfig>[0]), 2026, 11);

  it('a never-onboarded $1,875 profile with no income rule projects $0 in month 3 (was a phantom salary)', () => {
    expect(dec(legacy)).toBeGreaterThan(0); // the before number: the phantom $1,875/week
    const eff = withEffectiveSalary(legacy, [], liquid);
    expect(eff?.weekly_gross_income).toBe(0);
    expect(dec(eff)).toBe(0);
    expect(legacy.weekly_gross_income).toBe(1875); // input not mutated
  });

  it('a $1,875 profile WITH an active cash income rule (the starter-rule users) is returned unchanged', () => {
    const eff = withEffectiveSalary(legacy, [cashRule], liquid);
    expect(eff).toBe(legacy);
    expect(dec(eff)).toBe(dec(legacy));
    expect(withEffectiveSalary(legacy, [{ ...cashRule, deposit_account: null }], liquid)).toBe(legacy);
  });

  it('an entered salary is never touched', () => {
    const onboarded = { ...legacy, onboarding_completed: true };
    expect(withEffectiveSalary(onboarded, [], liquid)).toBe(onboarded);
    const typed = { ...legacy, weekly_gross_income: '389.5' };
    expect(withEffectiveSalary(typed, [], liquid)).toBe(typed);
    expect(withEffectiveSalary(null, [], liquid)).toBe(null);
    expect(withEffectiveSalary(undefined, [], liquid)).toBe(undefined);
  });

  it('an inactive rule, a savings rule or an expense rule does not carry income, so the legacy salary is still dropped', () => {
    for (const r of [{ ...cashRule, active: false }, { ...cashRule, deposit_account: 'savings-1' }, { ...cashRule, rule_type: 'expense' }]) {
      expect(withEffectiveSalary(legacy, [r], liquid)?.weekly_gross_income).toBe(0);
    }
  });
});
