import { describe, it, expect } from 'vitest';
import { buildCardData } from '../credit-card-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';

// Regression for a real data-integrity gap: a credit card with no accounts.min_payment set fell
// back to a same-named row in the legacy `debts` table, which could carry a stale or simply
// different value than what the user actually sees/edits on the Accounts page — Venture X had no
// debts row at all and silently used a hardcoded $25, while Prime Visa's debts row ($250) used to
// be readable too even though its accounts.min_payment ($231.15) already took precedence. Tre
// asked for the Accounts page to be the SOLE source of truth for a card's minimum payment, with
// the debts table no longer consulted at all for this field (it remains the source for
// target_payment, a separate feature with no Accounts-page equivalent, and for mortgage/auto/
// student debts entirely, which aren't touched by this change).

function makeAccount(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'card-1', user_id: 'test', name: 'Card', account_type: 'credit_card', balance: 1000,
    credit_limit: 5000, apr: 20, payment_due_day: 1, active: true,
    min_payment: null, payment_preference: null,
    ...overrides,
  };
}

describe('buildCardData — min_payment sourcing', () => {
  it('uses accounts.min_payment when set, ignoring a same-named debts row entirely', () => {
    const accounts = [makeAccount({ name: 'Prime Visa', min_payment: 231.15 })];
    const debts = [{ id: 'd1', name: 'Prime Visa', balance: 1000, apr: 20, min_payment: 250, target_payment: 500, credit_limit: 5000 }];
    const cards = buildCardData(accounts, [], [], debts);
    expect(cards[0].minPayment).toBe(231.15);
  });

  it('falls back to $25 when accounts.min_payment is null, even with a debts row present', () => {
    const accounts = [makeAccount({ name: 'Venture X', min_payment: null })];
    const debts = [{ id: 'd2', name: 'Venture X', balance: 0, apr: 15, min_payment: 99, target_payment: 99, credit_limit: 5000 }];
    const cards = buildCardData(accounts, [], [], debts);
    expect(cards[0].minPayment).toBe(25);
  });

  it('falls back to $25 when accounts.min_payment is null and no debts row exists at all', () => {
    const accounts = [makeAccount({ name: 'Venture X', min_payment: null })];
    const cards = buildCardData(accounts, [], [], []);
    expect(cards[0].minPayment).toBe(25);
  });

  it('still reads target_payment from a matching debts row (unaffected by this change)', () => {
    const accounts = [makeAccount({ name: 'Prime Visa', min_payment: 231.15 })];
    const debts = [{ id: 'd1', name: 'Prime Visa', balance: 1000, apr: 20, min_payment: 250, target_payment: 500, credit_limit: 5000 }];
    const cards = buildCardData(accounts, [], [], debts);
    expect(cards[0].targetPayment).toBe(500);
  });
});
