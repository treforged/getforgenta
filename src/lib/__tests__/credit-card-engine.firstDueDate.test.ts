import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';

// A newly opened card's FIRST payment is not on its steady cycle day (Tre, 2026-09-05:
// "maybe make it a feature for cards to set there first due date"). His Robinhood Gold opened in
// September and its first payment is due 10 October; from November it is the 10th every month.
//
// With only `dueDay` to read, the engine placed the first payment by asking whether that bare day
// had passed this month - so a card whose steady day is the 20th put its first payment in month 0,
// a month before it is actually owed. `firstDueDate` names the month outright.
//
// Would-fail check: drop the firstDueDate branch in the dueMonth decision and the first test goes
// red, because the payment reappears in month 0.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 24, creditLimit: 20000,
    minPayment: 25, minPaymentIsManual: true, targetPayment: 25,
    monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

const PAD = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;
const flatEvents = (n: number, income: number, expenses: number) =>
  Array.from({ length: n }, () => ({ income, expenses }));

// Steady due day 20, which has NOT passed on the frozen clock (the 14th) - so without a first due
// date the engine bills this statement in month 0.
const newCard = (overrides: Partial<CardData> = {}) => makeCard({
  id: 'new', name: 'New Card', balance: 1200, apr: 26, minPayment: 30,
  paymentPreference: 'statement', statementBalance: 400, dueDay: 20,
  ...overrides,
});

describe('simulateVariablePayoff - first payment due date', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const run = (cards: CardData[]) =>
    simulateVariablePayoff(cards, 8000, 3000, 'avalanche', 0, 0, 4, flatEvents(4, 3000, 1000), ...PAD);

  it('a first payment due NEXT month is not billed this month', () => {
    const sim = run([newCard({ firstDueDate: '2026-08-10' })]);
    expect(sim.monthlyPayments.get('new')![0]).toBe(0);
    expect(sim.monthlyPayments.get('new')![1]).toBe(400);
  });

  it('without a first due date the same card is billed this month - the behaviour it replaces', () => {
    const sim = run([newCard()]);
    expect(sim.monthlyPayments.get('new')![0]).toBe(400);
  });

  it('a first payment due THIS month is billed this month, even though the steady day has passed', () => {
    const sim = run([newCard({ dueDay: 3, firstDueDate: '2026-07-28' })]);
    expect(sim.monthlyPayments.get('new')![0]).toBe(400);
  });

  it('a first due date whose month is already gone falls back to the steady day', () => {
    const sim = run([newCard({ firstDueDate: '2026-05-10' })]);
    expect(sim.monthlyPayments.get('new')![0]).toBe(400);
  });
});

// A card can be OPEN and owe nothing yet. `cardStartMonths` answers whether the card exists;
// this answers whether it has been billed. A revolving card with no payment preference is used
// here so the only thing under test is the MINIMUM, not the statement pin above.
describe('simulateVariablePayoff - no minimum is owed before the first payment is due', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  // Manual minimum so the assertion is an exact contract figure, not the 2% formula.
  const revolver = (overrides: Partial<CardData> = {}) => makeCard({
    id: 'rev', name: 'Revolver', balance: 2000, apr: 24,
    minPayment: 60, minPaymentIsManual: true, targetPayment: 60, dueDay: 20,
    ...overrides,
  });

  // No spare cash above the floor, so the ONLY thing that can be paid is a required minimum.
  const run = (cards: CardData[]) =>
    simulateVariablePayoff(cards, 3000, 3000, 'avalanche', 0, 0, 4, flatEvents(4, 1000, 1000), ...PAD);

  it('a card first billed in month 2 owes its minimum from month 2, and nothing before it', () => {
    const mins = run([revolver({ firstDueDate: '2026-09-10' })]).perCardMinPayments.get('rev')!;
    expect(mins[0]).toBe(0);
    expect(mins[1]).toBe(0);
    expect(mins[2]).toBe(60);
  });

  it('the same card with no first due date owes its minimum from month 0 - what this replaces', () => {
    const mins = run([revolver()]).perCardMinPayments.get('rev')!;
    expect(mins[0]).toBe(60);
    expect(mins[1]).toBe(60);
  });

  it('suppressing the minimum does not make the debt vanish - the balance still grows', () => {
    const sim = run([revolver({ firstDueDate: '2026-09-10' })]);
    expect(sim.monthlyPayments.get('rev')![0]).toBe(0);
    expect(sim.monthlyBalances.get('rev')![0]).toBeGreaterThan(2000);
  });
});
