import { describe, it, expect } from 'vitest';
import { getCardStartDateViolation } from '../card-start-date';

// Regression for: transactions/payment plans could be dated before a future credit card's
// card_start_date, contradicting the engine's own cardStartMonths gate (credit-card-engine.ts)
// which excludes that card from simulations until that month. Covers all the payment_source
// shapes that actually reach this check from Transactions.tsx and PhaseBlock.tsx.

const futureCard = { id: 'card-1', account_type: 'credit_card', card_start_date: '2026-09-01', name: 'Venture X' };
const existingCard = { id: 'card-2', account_type: 'credit_card', card_start_date: null, name: 'Discover' };
const checking = { id: 'acct-1', account_type: 'checking', card_start_date: null, name: 'Checking' };
const accounts = [futureCard, existingCard, checking];

describe('getCardStartDateViolation', () => {
  it('blocks a transaction dated before the card\'s future start date', () => {
    const reason = getCardStartDateViolation('2026-06-15', 'account:card-1', accounts);
    expect(reason).toContain('Venture X');
    expect(reason).toContain('September 2026');
  });

  it('allows a transaction dated on the start date itself', () => {
    expect(getCardStartDateViolation('2026-09-01', 'account:card-1', accounts)).toBeNull();
  });

  it('allows a transaction dated after the start date', () => {
    expect(getCardStartDateViolation('2027-01-01', 'account:card-1', accounts)).toBeNull();
  });

  it('allows any date for a card with no card_start_date set (existing card)', () => {
    expect(getCardStartDateViolation('2020-01-01', 'account:card-2', accounts)).toBeNull();
  });

  it('allows any date for a non-credit-card account', () => {
    expect(getCardStartDateViolation('2020-01-01', 'account:acct-1', accounts)).toBeNull();
  });

  it('ignores non-account payment sources (cash, generic placeholders)', () => {
    expect(getCardStartDateViolation('2020-01-01', 'cash', accounts)).toBeNull();
    expect(getCardStartDateViolation('2020-01-01', 'credit_card', accounts)).toBeNull();
    expect(getCardStartDateViolation('2020-01-01', 'bank_account', accounts)).toBeNull();
  });

  it('ignores an empty or missing payment source', () => {
    expect(getCardStartDateViolation('2020-01-01', '', accounts)).toBeNull();
    expect(getCardStartDateViolation('2020-01-01', null, accounts)).toBeNull();
    expect(getCardStartDateViolation('2020-01-01', undefined, accounts)).toBeNull();
  });

  it('handles a raw account id without the "account:" prefix', () => {
    const reason = getCardStartDateViolation('2026-01-01', 'card-1', accounts);
    expect(reason).toContain('Venture X');
  });

  it('allows dates for an account id that does not match any known account', () => {
    expect(getCardStartDateViolation('2020-01-01', 'account:unknown', accounts)).toBeNull();
  });
});
