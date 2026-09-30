/** Which income rules the forecast treats as THE paycheck, and so replaces with profile-derived pay. */
export function resolvePaycheckRuleIds(
  rules: ReadonlyArray<{
    id: string;
    active: boolean | null;
    rule_type: string;
    frequency: string;
    deposit_account?: string | null;
  }>,
  profile: { weekly_gross_income?: number | string | null; paycheck_rule_id?: string | null } | null | undefined,
  liquidAccountIds: ReadonlySet<string>
): Set<string> {
  // Months 1+ of the forecast REPLACE paycheck rules with income derived from the profile
  // salary (forecast-engine fallbackTakeHome, and the card sim's mirror of it). With no salary
  // set, that replacement is $0, so the user's own paycheck rules must flow through as ordinary
  // income instead of being dropped. Ask 9f385515: the salary used to default to $1,875/week.
  const income = Number(profile?.weekly_gross_income);
  if (!(income > 0)) {
    return new Set();
  }

  if (profile?.paycheck_rule_id) {
    return new Set([profile.paycheck_rule_id]);
  }

  const allowedFreq = new Set(['weekly', 'biweekly', 'semi_monthly']);
  const result = new Set<string>();
  for (const r of rules) {
    if (
      r.active &&
      r.rule_type === 'income' &&
      allowedFreq.has(r.frequency) &&
      (!r.deposit_account || liquidAccountIds.has(r.deposit_account))
    ) {
      result.add(r.id);
    }
  }
  return result;
}
