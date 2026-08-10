import { describe, it, expect } from 'vitest';
import { buildCardData } from '../credit-card-engine';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';

// N11: a card whose ONLY spend is a future-dated recurring rule read $0/mo purchases for the
// entire projection horizon, because monthlyNewPurchases counts occurrences strictly in NEXT
// month and countRuleOccurrencesInMonth returns 0 before a rule's start_date. The display-only
// steadyMonthlyPurchases twin counts each rule in the first month it actually fires, so the
// "Purchases/Mo" stat and the debt-free caption show the real steady amount instead of $0.
// The sim still reads monthlyNewPurchases — months before the rule starts are never charged.

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const makeAccount = (over: Partial<AccountRow>): AccountRow => ({
  id: 'card1', user_id: 'u1', name: 'Test Card', account_type: 'credit_card',
  balance: 0, active: true, apr: 20, credit_limit: 10000,
  ...over,
} as AccountRow);

const makeRule = (over: Partial<RuleRow>): RuleRow => ({
  id: 'r1', name: 'Groceries', amount: 300, rule_type: 'expense', frequency: 'monthly',
  active: true, start_date: null, category: 'Groceries', due_day: 3,
  payment_source: 'account:card1',
  ...over,
} as RuleRow);

describe('buildCardData — steadyMonthlyPurchases (N11)', () => {
  it('a future-dated rule reads $0 flat but its real amount at steady state', () => {
    const now = new Date();
    const futureStart = new Date(now.getFullYear(), now.getMonth() + 8, 3);
    const [card] = buildCardData(
      [makeAccount({})], [],
      [makeRule({ start_date: iso(futureStart) })],
      [],
    );
    expect(card.monthlyNewPurchases).toBe(0); // sim input unchanged: nothing charged before start
    expect(card.steadyMonthlyPurchases).toBe(300); // display reads the rule's real monthly amount
  });

  it('an already-active rule gives identical flat and steady estimates', () => {
    const [card] = buildCardData(
      [makeAccount({})], [],
      [makeRule({ start_date: null })],
      [],
    );
    expect(card.monthlyNewPurchases).toBe(300);
    expect(card.steadyMonthlyPurchases).toBe(300);
  });

  it('yearly rules stay excluded from both estimates', () => {
    const now = new Date();
    const futureStart = new Date(now.getFullYear(), now.getMonth() + 8, 3);
    const [card] = buildCardData(
      [makeAccount({})], [],
      [makeRule({ frequency: 'yearly', start_date: iso(futureStart) })],
      [],
    );
    expect(card.monthlyNewPurchases).toBe(0);
    expect(card.steadyMonthlyPurchases).toBe(0);
  });
});
