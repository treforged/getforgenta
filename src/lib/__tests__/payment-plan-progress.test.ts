import { describe, it, expect } from 'vitest';
import { getPlanProgress, isPlanInProgress, type PaymentPlan } from '@/lib/payment-plan-generator';

/** Finding §3.5: a plan whose installments have all been paid still carries `active: true`,
 *  because nothing writes that flag back when the last payment date passes. */
function plan(overrides: Partial<PaymentPlan> = {}): PaymentPlan {
  return {
    id: 'p1',
    user_id: 'u1',
    name: 'AirPods Pro',
    provider: 'PayPal',
    total_amount: 200,
    payment_amount: 50,
    frequency: 'biweekly',
    start_date: '2026-05-18',
    total_payments: 4,
    category: 'Shopping',
    payment_source: null,
    plan_type: 'monthly_charge',
    notes: null,
    active: true,
    created_at: '2026-05-18',
    ...overrides,
  };
}

describe('getPlanProgress asOf', () => {
  it('counts only installments whose date has passed', () => {
    // Dates: 05-18, 06-01, 06-15, 06-29.
    expect(getPlanProgress(plan(), '2026-06-15')).toMatchObject({ paid: 2, remaining: 2 });
  });

  it('reports every installment paid once the schedule is behind the cutoff', () => {
    expect(getPlanProgress(plan(), '2026-08-05')).toMatchObject({
      paid: 4,
      remaining: 0,
      endDate: '2026-06-29',
    });
  });
});

describe('isPlanInProgress', () => {
  it('excludes a finished plan even though its stored active flag is still true', () => {
    const finished = plan();
    expect(finished.active).toBe(true);
    expect(isPlanInProgress(finished, '2026-08-05')).toBe(false);
  });

  it('includes a plan that still owes installments', () => {
    expect(isPlanInProgress(plan(), '2026-06-15')).toBe(true);
  });

  it('excludes a plan the user switched off, regardless of remaining installments', () => {
    expect(isPlanInProgress(plan({ active: false }), '2026-06-15')).toBe(false);
  });
});
