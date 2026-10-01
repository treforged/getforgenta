import { useMemo } from 'react';
import { FUNDING_ACCOUNT_TYPES } from '@/lib/funding-account';
import { withEffectiveSalary, type Month0RuleLike, type SalaryProfile } from '@/lib/month0-profile-paychecks';

interface AccountLike {
  id: string;
  active: boolean | null;
  account_type: string;
}

/**
 * The profile every projection's pay schedule should be built from: the legacy $1,875 default is dropped for a
 * never-onboarded user with no income rule (see `withEffectiveSalary`). Cash accounts are the funding types, the
 * same set useCardProjection uses for its month-0 income check. Same reference back whenever nothing changes.
 */
export function useEffectiveSalaryProfile<P extends SalaryProfile | null | undefined>(
  profile: P,
  rules: readonly Month0RuleLike[] | null | undefined,
  accounts: readonly AccountLike[] | null | undefined,
): P {
  return useMemo(() => {
    const liquidAccountIds = new Set(
      (accounts ?? []).filter(a => a.active && FUNDING_ACCOUNT_TYPES.includes(a.account_type)).map(a => a.id),
    );
    return withEffectiveSalary(profile, rules ?? [], liquidAccountIds);
  }, [profile, rules, accounts]);
}
