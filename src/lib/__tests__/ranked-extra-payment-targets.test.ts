import { describe, it, expect } from 'vitest';
import {
  buildRankedTargets, carFundRemainingNeed, goalRemainingNeed,
} from '../ranked-extra-payment-targets';
import { allocateRankedSurplus, rankTargets } from '../ranked-surplus-allocation';
import type { CardData } from '../credit-card-engine';
import type { CarFund, SavingsGoal } from '../types';

const makeCard = (o: Partial<CardData> = {}): CardData => ({
  id: 'card-1', name: 'Visa', balance: 5_000, apr: 24, creditLimit: 10_000, minPayment: 100,
  targetPayment: 100, monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
  paymentPreference: null, autopayFullBalance: false, dueDay: 15,
  statementBalancePhase: false, statementBalance: null, ...o,
});

const makeFund = (o: Partial<CarFund> = {}): CarFund => ({
  id: 'car-1', user_id: 'u1', created_at: '2026-01-01', vehicle_name: 'Test Car',
  target_price: 20_000, tax_fees: 0, down_payment_goal: 5_000, current_saved: 1_000,
  saved_source: 'fixed', saved_percent: 0, sort_order: 0, auto_extra: true,
  monthly_insurance: 0, expected_apr: 6, loan_term_months: 60, phase: 'saving',
  loan_amount: 0, loan_start_date: null, payment_start_date: null, interest_start_date: null,
  insurance_start_date: null, actual_monthly_payment: 0, linked_account: null, linked_rule_id: null,
  loan_payment_account: null, linked_loan_account_id: null, planned_purchase_date: null,
  gift_contribution: 0, lump_sum_payments: [], ...o,
});

const makeGoal = (o: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'goal-1', user_id: 'u1', created_at: '2026-01-01', name: 'Vacation',
  target_amount: 3_000, current_amount: 500, monthly_contribution: 100, target_date: '2027-01-01',
  lump_sum_payments: [], sort_order: 0, auto_extra: true, ...o,
});

const base = { strategy: 'avalanche' as const, asOf: '2026-08-19' };

describe('carFundRemainingNeed', () => {
  it('is the down payment less gifts and what is already saved', () => {
    expect(carFundRemainingNeed(makeFund({ down_payment_goal: 5_000, current_saved: 1_000, gift_contribution: 500 }), null, null))
      .toBe(3_500);
  });

  it('is zero for a fund past its saving phase — the down payment is already spent', () => {
    expect(carFundRemainingNeed(makeFund({ phase: 'loan' }), null, null)).toBe(0);
  });

  it('never goes negative when the fund is over-saved', () => {
    expect(carFundRemainingNeed(makeFund({ current_saved: 9_000 }), null, null)).toBe(0);
  });

  it('reads a linked separate account balance, not the typed figure', () => {
    const f = makeFund({ linked_account: 'hys', current_saved: 1_000 });
    expect(carFundRemainingNeed(f, 'chk', 4_200)).toBe(800);
  });
});

describe('goalRemainingNeed', () => {
  it('is target less current', () => {
    expect(goalRemainingNeed(makeGoal())).toBe(2_500);
  });
  it('is zero, never negative, for an over-funded goal', () => {
    expect(goalRemainingNeed(makeGoal({ current_amount: 9_999 }))).toBe(0);
  });
});

describe('buildRankedTargets', () => {
  it('gives cards their minimum and balance, goals and funds a zero minimum', () => {
    const t = buildRankedTargets({
      ...base, cards: [makeCard()], carFunds: [makeFund()], goals: [makeGoal()],
    });
    const card = t.find(x => x.kind === 'card')!;
    expect(card.minimum).toBe(100);
    expect(card.capacity).toBe(5_000);
    // The manual monthly contribution is already a bill upstream — counting it again double-deducts.
    expect(t.filter(x => x.kind !== 'card').every(x => x.minimum === 0)).toBe(true);
  });

  it('ranks the whole card block ahead of goals by default', () => {
    const order = rankTargets(buildRankedTargets({
      ...base,
      cards: [makeCard({ id: 'lo', apr: 12 }), makeCard({ id: 'hi', apr: 29 })],
      carFunds: [], goals: [makeGoal({ id: 'g', sort_order: 1 })],
    })).map(x => x.id);
    // Avalanche within the block: the 29% card first. The goal follows the whole block.
    expect(order).toEqual(['hi', 'lo', 'g']);
  });

  it('lets a goal be ranked above the card block without disturbing the block order', () => {
    const order = rankTargets(buildRankedTargets({
      ...base, cardsSortOrder: 5,
      cards: [makeCard({ id: 'lo', apr: 12 }), makeCard({ id: 'hi', apr: 29 })],
      carFunds: [makeFund({ id: 'car', sort_order: 1 })],
      goals: [makeGoal({ id: 'g', sort_order: 0 })],
    })).map(x => x.id);
    expect(order).toEqual(['g', 'car', 'hi', 'lo']);
  });

  it('an autopay-in-full card takes no ranked surplus but keeps its minimum', () => {
    const t = buildRankedTargets({
      ...base, cards: [makeCard({ autopayFullBalance: true })], carFunds: [], goals: [],
    });
    expect(t[0].autoExtra).toBe(false);
    expect(t[0].minimum).toBe(100);
  });

  it('carries auto_extra through from the rows', () => {
    const t = buildRankedTargets({
      ...base, cards: [],
      carFunds: [makeFund({ auto_extra: false })], goals: [makeGoal({ auto_extra: false })],
    });
    expect(t.every(x => x.autoExtra === false)).toBe(true);
  });
});

describe('end to end — a goal ranked first still cannot starve a card minimum', () => {
  it('pays both card minimums before the top-ranked goal sees a dollar', () => {
    const targets = buildRankedTargets({
      ...base, cardsSortOrder: 9,
      cards: [makeCard({ id: 'hi', apr: 29, minPayment: 120 }), makeCard({ id: 'lo', apr: 12, minPayment: 80 })],
      carFunds: [],
      goals: [makeGoal({ id: 'g', sort_order: 0, target_amount: 100_000, current_amount: 0 })],
    });
    const r = allocateRankedSurplus(400, targets);
    const get = (id: string) => r.allocations.find(a => a.id === id)!;
    expect(get('hi').minimum).toBe(120);
    expect(get('lo').minimum).toBe(80);
    expect(get('g').extra).toBe(200);
    expect(r.minimumShortfall).toBe(0);
  });

  it('a fully funded goal hands its share to the cards in the same month', () => {
    const targets = buildRankedTargets({
      ...base, cardsSortOrder: 9,
      cards: [makeCard({ id: 'hi', minPayment: 100, balance: 5_000 })],
      carFunds: [],
      goals: [makeGoal({ id: 'done', sort_order: 0, target_amount: 3_000, current_amount: 3_000 })],
    });
    const r = allocateRankedSurplus(1_000, targets);
    expect(r.allocations.find(a => a.id === 'done')!.total).toBe(0);
    expect(r.allocations.find(a => a.id === 'hi')!.total).toBe(1_000);
    expect(r.unallocated).toBe(0);
  });
});
