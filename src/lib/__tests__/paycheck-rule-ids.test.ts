import { describe, it, expect } from 'vitest';
import { resolvePaycheckRuleIds } from '../paycheck-rule-ids';

describe('resolvePaycheckRuleIds', () => {
  const liquidIds = new Set(['chk']);

  it('returns empty set when salary is 0', () => {
    const rules = [
      { id: 'a', active: true, rule_type: 'income', frequency: 'weekly', deposit_account: null },
    ];
    expect(resolvePaycheckRuleIds(rules, { weekly_gross_income: 0 }, liquidIds)).toEqual(new Set());
  });

  it('returns empty set when profile is null or undefined', () => {
    const rules = [
      { id: 'a', active: true, rule_type: 'income', frequency: 'weekly', deposit_account: null },
    ];
    expect(resolvePaycheckRuleIds(rules, null, liquidIds)).toEqual(new Set());
    expect(resolvePaycheckRuleIds(rules, undefined, liquidIds)).toEqual(new Set());
  });

  it('returns empty set when salary is string "0"', () => {
    const rules = [
      { id: 'a', active: true, rule_type: 'income', frequency: 'weekly', deposit_account: null },
    ];
    expect(resolvePaycheckRuleIds(rules, { weekly_gross_income: '0' }, liquidIds)).toEqual(new Set());
  });

  it('returns explicit paycheck_rule_id when provided', () => {
    const rules: Parameters<typeof resolvePaycheckRuleIds>[0] = [];
    const result = resolvePaycheckRuleIds(rules, { weekly_gross_income: 1093, paycheck_rule_id: 'p1' }, liquidIds);
    expect(result).toEqual(new Set(['p1']));
  });

  it('filters rules correctly when no explicit id', () => {
    const rules = [
      { id: 'a', active: true, rule_type: 'income', frequency: 'weekly', deposit_account: null }, // in
      { id: 'b', active: true, rule_type: 'income', frequency: 'biweekly', deposit_account: 'chk' }, // in
      { id: 'c', active: true, rule_type: 'income', frequency: 'monthly', deposit_account: null }, // out (freq)
      { id: 'd', active: true, rule_type: 'income', frequency: 'weekly', deposit_account: 'sav' }, // out (account)
      { id: 'e', active: false, rule_type: 'income', frequency: 'weekly', deposit_account: null }, // out (inactive)
      { id: 'f', active: true, rule_type: 'expense', frequency: 'weekly', deposit_account: null }, // out (type)
    ];
    const result = resolvePaycheckRuleIds(rules, { weekly_gross_income: 1093 }, liquidIds);
    expect(Array.from(result).sort()).toEqual(['a', 'b']);
  });

  it('does not mutate input arrays', () => {
    const rules = Object.freeze([
      { id: 'a', active: true, rule_type: 'income', frequency: 'weekly', deposit_account: null },
    ]);
    expect(() => resolvePaycheckRuleIds(rules, { weekly_gross_income: 1000 }, liquidIds)).not.toThrow();
  });
});
