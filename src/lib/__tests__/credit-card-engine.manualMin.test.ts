import { describe, it, expect } from 'vitest';
import { buildCardData, revolvingMinDue, simulateVariablePayoff, calcMinPayment, type CardData } from '../credit-card-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';

// Manual-minimum flag (accounts.min_payment_is_manual): when a user marks a card's minimum as
// manually set, the engine must honor accounts.min_payment EXACTLY — INCLUDING $0. Real case:
// Prime Visa with the entire balance on 0% Amazon payment plans has a true $0 revolving minimum
// (Plaid reports minimum_payment_amount = 0), but the engine's 2%-formula / $25-floor fallbacks
// invented a minimum that over-reserved the cash floor and forced phantom mandatory payments.
// When the flag is FALSE every existing behavior is preserved bit-for-bit.

function makeAccount(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'card-1', user_id: 'test', name: 'Card', account_type: 'credit_card', balance: 1000,
    credit_limit: 5000, apr: 20, payment_due_day: 1, active: true,
    min_payment: null, payment_preference: null,
    ...overrides,
  } as AccountRow;
}

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('buildCardData — min_payment_is_manual', () => {
  it('honors a manual minimum of 0 exactly (no $25 floor, no formula)', () => {
    const accounts = [makeAccount({ name: 'Prime Visa', min_payment: 0, min_payment_is_manual: true })];
    const cards = buildCardData(accounts, [], [], []);
    expect(cards[0].minPayment).toBe(0);
    expect(cards[0].minPaymentIsManual).toBe(true);
  });

  it('honors a manual minimum below the $25 floor exactly', () => {
    const accounts = [makeAccount({ min_payment: 10, min_payment_is_manual: true })];
    const cards = buildCardData(accounts, [], [], []);
    expect(cards[0].minPayment).toBe(10);
  });

  it('treats a manual card with null min_payment as $0 (manual flag means "trust the stored value")', () => {
    const accounts = [makeAccount({ min_payment: null, min_payment_is_manual: true })];
    const cards = buildCardData(accounts, [], [], []);
    expect(cards[0].minPayment).toBe(0);
  });

  it('flag false: min_payment 0 still floors to $25 (unchanged legacy behavior)', () => {
    const accounts = [makeAccount({ min_payment: 0, min_payment_is_manual: false })];
    const cards = buildCardData(accounts, [], [], []);
    expect(cards[0].minPayment).toBe(25);
    expect(cards[0].minPaymentIsManual).toBe(false);
  });

  it('flag absent (undefined column, pre-migration rows): behaves exactly as false', () => {
    const accounts = [makeAccount({ min_payment: 231.15 })];
    const cards = buildCardData(accounts, [], [], []);
    expect(cards[0].minPayment).toBe(231.15);
    expect(cards[0].minPaymentIsManual).toBe(false);
  });
});

describe('revolvingMinDue — manual cards bypass the formula fallback', () => {
  it('manual min 0 → $0 due regardless of revolving balance', () => {
    const card = makeCard({ minPayment: 0, minPaymentIsManual: true, apr: 25 });
    expect(revolvingMinDue(card, 3000)).toBe(0);
  });

  it('manual min below the formula → exactly the manual amount', () => {
    const card = makeCard({ minPayment: 50, minPaymentIsManual: true, apr: 20 });
    expect(calcMinPayment(5000, 20)).toBeGreaterThan(50); // scenario sanity: formula would win
    expect(revolvingMinDue(card, 5000)).toBe(50);
  });

  it('manual min still capped at the revolving balance (last payment never overshoots)', () => {
    const card = makeCard({ minPayment: 500, minPaymentIsManual: true, apr: 20 });
    expect(revolvingMinDue(card, 200)).toBe(200);
  });

  it('manual min nets out the installment monthly payment like contract mins do', () => {
    const card = makeCard({ minPayment: 100, minPaymentIsManual: true, apr: 20, installmentMonthlyPayment: 80 });
    expect(revolvingMinDue(card, 3000)).toBe(20);
  });

  it('non-manual card: max(contract, formula) unchanged', () => {
    const card = makeCard({ minPayment: 25, apr: 20 });
    expect(revolvingMinDue(card, 5000)).toBe(calcMinPayment(5000, 20));
  });
});

describe('simulateVariablePayoff — perCardMinPayments honors manual minimums', () => {
  // Zero-surplus scenario (income == expenses, cash pinned at the floor) so the only payments
  // the sim can make are mandatory minimums — isolates the min/reservation layer.
  const monthEvents = [
    { income: 1000, expenses: 1000 },
    { income: 1000, expenses: 1000 },
    { income: 1000, expenses: 1000 },
  ];

  it('manual min 0: no phantom minimum reserved and no forced payment', () => {
    const card = makeCard({
      id: 'm0', balance: 3000, apr: 20, minPayment: 0, minPaymentIsManual: true,
      autopayFullBalance: false, paymentPreference: null,
    });
    const sim = simulateVariablePayoff([card], 1000, 1000, 'avalanche', 0, 0, 3, monthEvents);
    expect(sim.perCardMinPayments.get('m0')).toEqual([0, 0, 0]);
    expect(sim.monthlyPayments.get('m0')).toEqual([0, 0, 0]);
  });

  it('manual min below the formula: exactly the manual amount is reserved', () => {
    const card = makeCard({
      id: 'm50', balance: 3000, apr: 20, minPayment: 50, minPaymentIsManual: true,
      autopayFullBalance: false, paymentPreference: null,
    });
    const sim = simulateVariablePayoff([card], 1000, 1000, 'avalanche', 0, 0, 3, monthEvents);
    expect(sim.perCardMinPayments.get('m50')![0]).toBe(50);
  });

  it('flag false: formula minimum reserved, unchanged from today', () => {
    const card = makeCard({
      id: 'f', balance: 3000, apr: 20, minPayment: 0,
      autopayFullBalance: false, paymentPreference: null,
    });
    const sim = simulateVariablePayoff([card], 1000, 1000, 'avalanche', 0, 0, 3, monthEvents);
    expect(sim.perCardMinPayments.get('f')![0]).toBe(calcMinPayment(3000, 20));
  });
});
