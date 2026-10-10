import { describe, it, expect } from 'vitest';
import { isCardEntry, cardAccountFromEntry, planCardAccountWrites, type ExistingCardAccount } from '../wizard-card-accounts';
import { buildCardData, projectCard } from '../credit-card-engine';
import type { DebtEntry } from '@/components/onboarding/types';

const entry = (over: Partial<DebtEntry & { kind: 'card' | 'loan' }> = {}): DebtEntry & { kind?: 'card' | 'loan' } => ({
  name: 'Summit Card', balance: '3200', apr: '24.9', minPayment: '96', creditLimit: '8000', dueDate: '15', kind: 'card', ...over,
});

describe('a card entered at setup yields a payoff date (the point of the fix)', () => {
  it('as a credit_card ACCOUNT, the real engine projects a payoff month', () => {
    const row = cardAccountFromEntry(entry())!;
    const acct = { id: 'a1', user_id: 'u', active: true, created_at: '', updated_at: '', ...row } as never;
    const cards = buildCardData([acct], [], [], []);
    expect(cards).toHaveLength(1);
    const proj = projectCard(cards[0]);
    expect(proj.payoffMonth).not.toBeNull();
    expect(proj.payoffMonth!).toBeGreaterThan(0);
  });

  it('control - the OLD write, a debts row alone, gives the engine no card and so no payoff date', () => {
    const debtsRow = { id: 'd1', user_id: 'u', name: 'Summit Card', balance: 3200, apr: 24.9, min_payment: 96 } as never;
    expect(buildCardData([], [], [], [debtsRow])).toHaveLength(0);
  });
});

describe('isCardEntry', () => {
  it('the toggle decides', () => {
    expect(isCardEntry(entry({ kind: 'card', creditLimit: '' }))).toBe(true);
    expect(isCardEntry(entry({ kind: 'loan', creditLimit: '5000' }))).toBe(false);
  });
  it('an old draft with no toggle is a card only if it has a credit limit', () => {
    expect(isCardEntry({ creditLimit: '5000' })).toBe(true);
    expect(isCardEntry({ creditLimit: '' })).toBe(false);
  });
});

describe('cardAccountFromEntry', () => {
  it('carries every field the step collects, including the due day', () => {
    expect(cardAccountFromEntry(entry())).toEqual({
      name: 'Summit Card', account_type: 'credit_card', balance: 3200, apr: 24.9, credit_limit: 8000, min_payment: 96, payment_due_day: 15,
    });
  });
  it('unknown fields are null (an unknown APR is not 0%)', () => {
    const r = cardAccountFromEntry(entry({ apr: '', minPayment: '', creditLimit: '', dueDate: '40' }))!;
    expect(r.apr).toBeNull(); expect(r.min_payment).toBeNull(); expect(r.credit_limit).toBeNull(); expect(r.payment_due_day).toBeNull();
  });
  it('no name or no positive balance is no card', () => {
    expect(cardAccountFromEntry(entry({ name: '  ' }))).toBeNull();
    expect(cardAccountFromEntry(entry({ balance: '0' }))).toBeNull();
  });
});

describe('planCardAccountWrites: no duplicates', () => {
  const card = cardAccountFromEntry(entry())!;
  const existing = (over: Partial<ExistingCardAccount> = {}): ExistingCardAccount =>
    ({ id: 'x1', name: 'summit card ', apr: null, credit_limit: null, min_payment: null, payment_due_day: null, ...over });

  it('a new card is inserted', () => {
    expect(planCardAccountWrites([card], [])).toEqual({ inserts: [card], updates: [] });
  });
  it('a same-named existing account (case/space-insensitive) is NOT inserted again; only its empty fields are filled, never the balance', () => {
    const plan = planCardAccountWrites([card], [existing({ apr: 19.99 })]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'x1', patch: { credit_limit: 8000, min_payment: 96, payment_due_day: 15 } }]);
    expect(plan.updates[0].patch).not.toHaveProperty('balance');
  });
  it('an existing account with nothing to fill gets no write', () => {
    expect(planCardAccountWrites([card], [existing({ apr: 1, credit_limit: 1, min_payment: 1, payment_due_day: 1 })])).toEqual({ inserts: [], updates: [] });
  });
  it('the same card typed twice is one insert', () => {
    expect(planCardAccountWrites([card, { ...card, name: 'SUMMIT CARD' }], []).inserts).toHaveLength(1);
  });
});
