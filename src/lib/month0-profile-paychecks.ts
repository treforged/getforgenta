/**
 * WHY: month 0 counted only income RULES, onboarding saves salary only on the profile,
 * so those users' month-0 cash read low by their remaining paychecks (ask f16b35ff).
 */
import { getPaychecksInMonth, type PayScheduleConfig } from '@/lib/pay-schedule';
import { toLocalDateStr } from '@/lib/scheduling';

/** The old column default for profiles.weekly_gross_income (removed 2026-09-30, migration 20260930). A stored 1875 cannot be told apart from a typed one. */
export const LEGACY_DEFAULT_WEEKLY_GROSS = 1875;

export interface SalaryProfile {
  weekly_gross_income?: number | string | null;
  onboarding_completed?: boolean | null;
}

export interface Month0RuleLike {
  active: boolean | null;
  rule_type: string;
  deposit_account?: string | null;
}

/** True only when the user ENTERED a salary: a positive number that is not the legacy default, OR any positive number on a profile that completed onboarding (the wizard writes the typed value). */
export function isEnteredSalary(profile: SalaryProfile | null | undefined): boolean {
  const n = Number(profile?.weekly_gross_income);
  if (!(n > 0)) return false;
  if (profile?.onboarding_completed === true) return true;
  return n !== LEGACY_DEFAULT_WEEKLY_GROSS;
}

/** True when an active income rule pays into a cash account (deposit_account null/'' or in liquidAccountIds): the rules then carry the user's income. */
export function hasActiveCashIncomeRule(rules: readonly Month0RuleLike[], liquidAccountIds: ReadonlySet<string>): boolean {
  return rules.some(rule =>
    rule.active === true &&
    rule.rule_type === 'income' &&
    (rule.deposit_account === null ||
     rule.deposit_account === undefined ||
     rule.deposit_account === '' ||
     liquidAccountIds.has(rule.deposit_account)),
  );
}

/**
 * WHY: a never-onboarded profile still holding the legacy $1,875 column default, with no income rule, was projected
 * a $97,500 salary in months 1+ (follow-up to ask f16b35ff). Returns a copy with weekly_gross_income 0 in exactly that
 * case; otherwise the SAME reference (memo deps). A profile with an active cash income rule is unchanged, so the
 * starter-rule users see no difference. Never mutates the input.
 */
export function withEffectiveSalary<P extends SalaryProfile | null | undefined>(
  profile: P,
  rules: readonly Month0RuleLike[],
  liquidAccountIds: ReadonlySet<string>,
): P {
  if (!profile) return profile;
  if (!(Number(profile.weekly_gross_income) > 0)) return profile;
  if (isEnteredSalary(profile)) return profile;
  if (hasActiveCashIncomeRule(rules, liquidAccountIds)) return profile;
  return { ...profile, weekly_gross_income: 0 } as P;
}

/**
 * Net paycheck income from the PROFILE salary still to land in the current month: paychecks dated strictly AFTER `cutoffDate`.
 * Returns 0 unless BOTH: isEnteredSalary(profile), AND no rule is an active income rule into a cash account
 * (rule_type 'income', active true, and deposit_account is null/undefined/'' or in liquidAccountIds).
 * Any such rule means the rules already carry the user's income, so adding the profile salary would count it twice.
 */
export function month0ProfilePaycheckIncome(args: {
  profile: SalaryProfile | null | undefined;
  rules: readonly Month0RuleLike[];
  liquidAccountIds: ReadonlySet<string>;
  payConfig: PayScheduleConfig;
  now: Date;
  cutoffDate: string; // 'YYYY-MM-DD'
}): number {
  const { profile, rules, liquidAccountIds, payConfig, now, cutoffDate } = args;

  if (!isEnteredSalary(profile)) return 0;
  if (hasActiveCashIncomeRule(rules, liquidAccountIds)) return 0;

  const paychecks = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());
  let total = 0;

  for (const p of paychecks) {
    const pDateStr = toLocalDateStr(p.date);
    if (pDateStr > cutoffDate && Number.isFinite(p.net) && p.net > 0) {
      total += p.net;
    }
  }

  return total;
}
