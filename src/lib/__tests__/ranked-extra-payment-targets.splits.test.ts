import { describe, it, expect } from 'vitest';
import { buildRankedTargets, carLoanRemainingNeed } from '../ranked-extra-payment-targets';
import type { CardData } from '../credit-card-engine';
import type { CarFund } from '../types';

const card = (id: string, apr: number, balance: number): CardData => ({
  id, name: id, balance, apr, minPayment: 50, creditLimit: 10_000,
  autopayFullBalance: false, statementBalance: null, statementBalancePhase: false,
  installmentBalance: 0, installmentMonthlyPayment: 0, balanceTranches: [],
} as unknown as CardData);

const loanFund = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'c5', user_id: 'u', vehicle_name: '2004 Chevrolet C5', target_price: 0, tax_fees: 0,
  down_payment_goal: 7_700, current_saved: 0, saved_source: 'fixed', saved_percent: 0,
  monthly_insurance: 0, expected_apr: 10.18, loan_term_months: 48, phase: 'loan',
  loan_amount: 16_530, loan_start_date: null, payment_start_date: null, interest_start_date: null,
  insurance_start_date: null, actual_monthly_payment: 422.89, linked_account: null,
  linked_rule_id: null, loan_payment_account: null, linked_loan_account_id: null,
  planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [],
  sort_order: 3, auto_extra: true, created_at: '', ...over,
} as unknown as CarFund);

const base = {
  carFunds: [] as CarFund[], goals: [], strategy: 'avalanche' as const, asOf: '2026-08-21',
};

describe('carLoanRemainingNeed', () => {
  it('prefers the live linked-account balance over the original principal', () => {
    expect(carLoanRemainingNeed(loanFund({ current_balance_override: 16_254.49 }))).toBe(16_254.49);
  });

  it('falls back to loan_amount only when there is no linked balance', () => {
    expect(carLoanRemainingNeed(loanFund())).toBe(16_530);
  });

  it('is zero for a fund that has not been bought yet', () => {
    expect(carLoanRemainingNeed(loanFund({ phase: 'saving' }))).toBe(0);
  });
});

describe('buildRankedTargets — cards ranked on their own', () => {
  const cards = [card('visa', 27.49, 6_000), card('disc', 16.6, 9_000)];

  it('seats every card inside the block by default, as it always has', () => {
    const t = buildRankedTargets({ ...base, cards });
    expect(t.every(x => x.rankedIndividually === undefined)).toBe(true);
    // Fractional, contiguous, and strictly between the block rank and the next integer.
    expect(t.every(x => x.sortOrder >= 0 && x.sortOrder < 1)).toBe(true);
  });

  it('pulls out only the card that carries a rank, and leaves the other in the block', () => {
    const t = buildRankedTargets({
      ...base, cards, cardsSortOrder: 0, cardRanks: { visa: { sortOrder: 2 } },
    });
    const visa = t.find(x => x.id === 'visa')!;
    const disc = t.find(x => x.id === 'disc')!;
    expect(visa.rankedIndividually).toBe(true);
    expect(visa.sortOrder).toBe(2);
    expect(disc.rankedIndividually).toBeUndefined();
    expect(disc.sortOrder).toBeLessThan(1);
  });

  it('gives a blocked card the BLOCK weight, never a weight of its own', () => {
    const t = buildRankedTargets({
      ...base, cards, cardsShare: 40, cardRanks: { visa: { share: 99 } },
    });
    expect(t.find(x => x.id === 'visa')!.share).toBe(40);
  });

  it('gives a pulled-out card its own weight instead', () => {
    const t = buildRankedTargets({
      ...base, cards, cardsShare: 40, cardRanks: { visa: { sortOrder: 2, share: 60 } },
    });
    expect(t.find(x => x.id === 'visa')!.share).toBe(60);
  });

  it('treats zero and nonsense as no weight at all', () => {
    for (const share of [0, -5, Number.NaN, null, undefined]) {
      const t = buildRankedTargets({ ...base, cards, cardsShare: share as number | null });
      expect(t.find(x => x.id === 'visa')!.share).toBeUndefined();
    }
  });
});

describe('buildRankedTargets — loan targets', () => {
  it('emits NO loan target unless the caller opts in', () => {
    const t = buildRankedTargets({ ...base, cards: [], carFunds: [loanFund()] });
    expect(t.filter(x => x.kind === 'loan')).toEqual([]);
  });

  it('emits one when it does, carrying the outstanding principal and a zero minimum', () => {
    const t = buildRankedTargets({
      ...base, cards: [], carFunds: [loanFund({ current_balance_override: 16_254.49 })],
      includeLoanTargets: true,
    });
    const loan = t.find(x => x.kind === 'loan')!;
    expect(loan.capacity).toBe(16_254.49);
    // The scheduled payment is already a bill upstream; charging it again would double-count.
    expect(loan.minimum).toBe(0);
    expect(loan.sortOrder).toBe(3);
  });

  it('never emits a fund as both a car fund and a loan', () => {
    const t = buildRankedTargets({
      ...base, cards: [], carFunds: [loanFund()], includeLoanTargets: true,
    });
    expect(t.filter(x => x.id === 'c5' && x.capacity > 0)).toHaveLength(1);
  });
});
