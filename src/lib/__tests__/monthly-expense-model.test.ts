import { describe, it, expect } from 'vitest';
import { buildMonthlyExpenseModel } from '../monthly-expense-model';
import type { PaymentPlan } from '../payment-plan-generator';
import type { CarFund } from '../types';
import type { EnrichedTransaction } from '../pay-schedule';

const CC_ID = 'cc-prime-visa';
const CHECKING_ID = 'chk-total-checking';
const ccSources = new Set<string>([CC_ID, `account:${CC_ID}`]);

function txn(over: Partial<EnrichedTransaction> & { amount: number }): EnrichedTransaction {
  return {
    id: Math.random().toString(36).slice(2),
    date: '2026-08-10',
    type: 'expense',
    category: 'Bills',
    ...over,
  };
}

function plan(over: Partial<PaymentPlan> & { payment_amount: number }): PaymentPlan {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'u1',
    name: 'Plan',
    provider: null,
    total_amount: over.payment_amount * 6,
    frequency: 'monthly',
    start_date: '2026-08-01',
    total_payments: 6,
    category: 'Shopping',
    payment_source: `account:${CHECKING_ID}`,
    plan_type: 'monthly_charge',
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function carFund(over: Partial<CarFund>): CarFund {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'u1',
    vehicle_name: 'Test Car',
    target_price: 20000,
    tax_fees: 0,
    down_payment_goal: 3000,
    current_saved: 0,
    monthly_insurance: 0,
    expected_apr: 10.18,
    loan_term_months: 48,
    phase: 'loan',
    loan_amount: 16530,
    loan_start_date: '2026-06-21',
    payment_start_date: '2026-08-07',
    interest_start_date: '2026-08-07',
    insurance_start_date: null,
    actual_monthly_payment: 422.89,
    linked_account: null,
    linked_rule_id: null,
    loan_payment_account: null,
    planned_purchase_date: null,
    gift_contribution: 0,
    lump_sum_payments: [],
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const AUG = new Date(2026, 7, 6); // 2026-08-06

function build(over: {
  monthTxns?: EnrichedTransaction[];
  paymentPlans?: PaymentPlan[];
  carFunds?: CarFund[];
  asOf?: Date;
}) {
  return buildMonthlyExpenseModel({
    monthTxns: over.monthTxns ?? [],
    paymentPlans: over.paymentPlans ?? [],
    carFunds: over.carFunds ?? [],
    creditCardSourceIds: ccSources,
    asOf: over.asOf ?? AUG,
  });
}

describe('buildMonthlyExpenseModel', () => {
  describe('transaction stream', () => {
    it('sums expense rows into living and byCategory, ignoring income', () => {
      const m = build({
        monthTxns: [
          txn({ amount: 1915, category: 'Bills' }),
          txn({ amount: 300, category: 'Groceries' }),
          txn({ amount: 4720, category: 'Other', type: 'income' }),
        ],
      });
      expect(m.living).toBe(2215);
      expect(m.byCategory).toEqual({ Bills: 1915, Groceries: 300 });
    });

    it('excludes card payments (isDebtPayment) from every expense figure', () => {
      const m = build({
        monthTxns: [
          txn({ amount: 100, category: 'Bills' }),
          txn({ amount: 1820, category: 'Debt', isDebtPayment: true }),
        ],
      });
      expect(m.living).toBe(100);
      expect(m.expensesAllIn).toBe(100);
      expect(m.byCategory).toEqual({ Bills: 100 });
    });

    it('does NOT drop a category merely named like debt — classification is structural', () => {
      // expense-filtering.ts matched on the strings 'debt' / 'credit card', so renaming a
      // category silently changed a headline number. Structure (isDebtPayment) decides now.
      const m = build({
        monthTxns: [
          txn({ amount: 40, category: 'Credit Card Rewards' }),
          txn({ amount: 60, category: 'Debt Counselling' }),
        ],
      });
      expect(m.living).toBe(100);
      expect(m.byCategory).toEqual({ 'Credit Card Rewards': 40, 'Debt Counselling': 60 });
    });

    it('ignores plan and car-loan rows already in the stream, since it derives those itself', () => {
      const m = build({
        monthTxns: [
          txn({ amount: 100, category: 'Bills' }),
          txn({ amount: 120, category: 'Travel', isPlanPayment: true }),
          txn({ amount: 423, category: 'Auto Loan', isCarLoanPayment: true }),
        ],
      });
      expect(m.living).toBe(100);
    });
  });

  describe('payment plans', () => {
    it('counts a checking-sourced installment due this month', () => {
      const m = build({
        paymentPlans: [plan({ payment_amount: 120, category: 'Travel', start_date: '2026-08-24' })],
      });
      expect(m.living).toBe(120);
      expect(m.byCategory).toEqual({ Travel: 120 });
    });

    it('excludes a CC-sourced installment — it is already inside the card balance', () => {
      const m = build({
        paymentPlans: [
          plan({ payment_amount: 347, category: 'Car', payment_source: `account:${CC_ID}` }),
          plan({ payment_amount: 163, category: 'Shopping', payment_source: `account:${CC_ID}` }),
          plan({ payment_amount: 120, category: 'Travel', start_date: '2026-08-24' }),
        ],
      });
      expect(m.living).toBe(120);
      expect(m.byCategory.Car).toBeUndefined();
    });

    it('matches a CC source given without the account: prefix', () => {
      const m = build({
        paymentPlans: [plan({ payment_amount: 347, payment_source: CC_ID })],
      });
      expect(m.living).toBe(0);
    });

    it('excludes an inactive plan', () => {
      const m = build({ paymentPlans: [plan({ payment_amount: 120, active: false })] });
      expect(m.living).toBe(0);
    });

    it('excludes an installment falling outside the month', () => {
      const m = build({
        paymentPlans: [
          plan({ payment_amount: 228, start_date: '2026-09-20', total_payments: 5 }),
          plan({ payment_amount: 404.25, start_date: '2027-12-05', total_payments: 4 }),
        ],
      });
      expect(m.living).toBe(0);
    });

    it('counts every installment when a plan bills more than once in the month', () => {
      const m = build({
        paymentPlans: [
          plan({ payment_amount: 50, frequency: 'biweekly', start_date: '2026-08-03', total_payments: 6 }),
        ],
      });
      expect(m.living).toBe(150); // Aug 3, Aug 17, Aug 31
    });
  });

  describe('car loans', () => {
    it('splits the monthly payment into interest and principal', () => {
      const m = build({ carFunds: [carFund({})] });
      // 16530 * 0.1018/12 = 140.23
      expect(m.interest).toBeCloseTo(140.23, 1);
      expect(m.principal).toBeCloseTo(282.66, 1);
      expect(m.interest + m.principal).toBeCloseTo(422.89, 2);
      expect(m.living).toBe(0);
    });

    it('puts the whole payment in byCategory under Auto Loan, matching /transactions', () => {
      const m = build({ carFunds: [carFund({})] });
      expect(m.byCategory['Auto Loan']).toBeCloseTo(422.89, 2);
    });

    it('contributes nothing for a saving-phase (not yet purchased) vehicle', () => {
      const m = build({
        carFunds: [carFund({ phase: 'saving', monthly_insurance: 173.23, insurance_start_date: '2026-06-25' })],
      });
      expect(m.interest).toBe(0);
      expect(m.principal).toBe(0);
      expect(m.living).toBe(0);
    });

    it('contributes nothing for a paid-off vehicle', () => {
      const m = build({
        carFunds: [carFund({ loan_amount: 400, actual_monthly_payment: 422.89, payment_start_date: '2024-01-07', loan_start_date: '2023-12-01', interest_start_date: '2024-01-07' })],
      });
      expect(m.interest + m.principal).toBe(0);
    });

    it('does not count a loan whose payments have not started yet', () => {
      const m = build({
        carFunds: [carFund({ payment_start_date: '2026-11-07', interest_start_date: '2026-11-07' })],
      });
      expect(m.interest + m.principal).toBe(0);
    });
  });

  describe('vehicle insurance', () => {
    it('classifies insurance as living, not debt service', () => {
      const m = build({
        carFunds: [carFund({ monthly_insurance: 173.23, insurance_start_date: '2026-06-25' })],
      });
      expect(m.living).toBeCloseTo(173.23, 2);
      expect(m.byCategory.Insurance).toBeCloseTo(173.23, 2);
    });

    it('does not charge insurance before it starts', () => {
      const m = build({
        carFunds: [carFund({ monthly_insurance: 173.23, insurance_start_date: '2026-12-01' })],
      });
      expect(m.living).toBe(0);
    });
  });

  describe('derived totals', () => {
    it('reproduces Tre real August shape', () => {
      // Stream (recurring rules + actuals) nets to the 3,196 the tile showed before the fix,
      // of which the model keeps every dollar; the fix ADDS the obligations the stream omitted.
      const m = build({
        monthTxns: [txn({ amount: 3196, category: 'Bills' })],
        paymentPlans: [
          plan({ payment_amount: 347.0216666666667, category: 'Car', payment_source: `account:${CC_ID}`, start_date: '2026-07-07', total_payments: 12, plan_type: 'upfront' }),
          plan({ payment_amount: 163.48333333333332, category: 'Shopping', payment_source: `account:${CC_ID}`, start_date: '2026-07-01', plan_type: 'upfront' }),
          plan({ payment_amount: 120, category: 'Travel', start_date: '2026-08-24', total_payments: 9 }),
        ],
        carFunds: [carFund({ vehicle_name: '2004 Chevorlet C5', monthly_insurance: 173.23, insurance_start_date: '2026-06-25' })],
      });

      expect(m.living).toBeCloseTo(3196 + 120 + 173.23, 2);
      expect(m.expensesAllIn).toBeCloseTo(3912.12, 1); // the Phase 1 tile
      expect(m.expenses).toBeCloseTo(3629.46, 1);      // Option B tile, Phase 2
      expect(m.debtService).toBeCloseTo(422.89, 2);
    });

    it('keeps its totals internally consistent', () => {
      const m = build({
        monthTxns: [txn({ amount: 500, category: 'Bills' })],
        paymentPlans: [plan({ payment_amount: 120, start_date: '2026-08-24' })],
        carFunds: [carFund({ monthly_insurance: 100, insurance_start_date: '2026-01-01' })],
      });
      expect(m.expenses).toBeCloseTo(m.living + m.interest, 2);
      expect(m.expensesAllIn).toBeCloseTo(m.living + m.interest + m.principal, 2);
      expect(m.debtService).toBeCloseTo(m.interest + m.principal, 2);
      expect(m.cashOut).toBeCloseTo(m.expensesAllIn + m.transfers, 2);
      const catTotal = Object.values(m.byCategory).reduce((s, v) => s + v, 0);
      expect(catTotal).toBeCloseTo(m.expensesAllIn, 2);
    });
  });
});
