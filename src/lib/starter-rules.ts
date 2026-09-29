/**
 * The Budget page's sample set, and how to tell a row that is still exactly a sample.
 *
 * Until 2026-09-29 the Budget page inserted these rows into any account that opened it with 0
 * rules, without asking (13 real users carry 291 of them). Since 68550cc2 they are written only by
 * an explicit "Start from a sample set" press. Existing rows were NOT deleted (Sam, 2026-09-29):
 * `isUneditedSampleRule` lets the page mark the ones nobody has changed, so a user can see which
 * amounts are placeholders rather than theirs.
 *
 * `business_user_funnel()` (migration 20260929c) copies the (name, amount) pairs below. If this
 * list changes, change that too.
 */
export interface StarterRule {
  name: string; amount: number; rule_type: 'income' | 'expense'; frequency: string;
  due_day: number; category: string; notes?: string;
}

export const DEFAULT_STARTER_RULES: readonly StarterRule[] = [
  { name: 'Weekly Paycheck', amount: 1875, rule_type: 'income', frequency: 'weekly', due_day: 5, category: 'Other', notes: 'Friday deposits' },
  { name: 'Rent', amount: 1400, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Bills' },
  { name: 'Utilities', amount: 150, rule_type: 'expense', frequency: 'monthly', due_day: 15, category: 'Bills' },
  { name: 'Groceries', amount: 400, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Groceries' },
  { name: 'Gas / Transport', amount: 200, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Gas' },
  { name: 'Dining Out', amount: 150, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Dining' },
  { name: 'Insurance', amount: 280, rule_type: 'expense', frequency: 'monthly', due_day: 14, category: 'Bills' },
  { name: 'Subscriptions', amount: 50, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Subscriptions' },
  { name: 'Miscellaneous', amount: 100, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Other' },
];

/** True only when BOTH the name and the amount are still exactly a sample's. */
export function isUneditedSampleRule(rule: { name: string; amount: number | string | null }): boolean {
  const amount = Number(rule.amount);
  return DEFAULT_STARTER_RULES.some((s) => s.name === rule.name && s.amount === amount);
}
